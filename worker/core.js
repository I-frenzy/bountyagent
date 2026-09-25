// Shared core for the BountyAgent reference agent: config, clients, and the
// solve → commit → reveal / submit logic. Used by agent-worker.js (runs
// forever), tick.js (one pass, for scheduled runs) and mcp.js (tools for any
// MCP-capable AI agent).
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  defineChain,
  encodeAbiParameters,
  formatEther,
  getContractAddress,
  http,
  keccak256,
  parseEther,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BOUNTY_ENGINE_ABI, MODE, STATUS } from "./abi.js";
import { POPCOUNT_FAST_BYTECODE } from "./artifacts.js";
import { doWork } from "./analyzer.js";
import { solveVerified } from "./solver.js";

// --- tiny .env loader (no dependency) ---------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
try {
  for (const line of readFileSync(join(here, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* no .env — rely on the real environment */
}

export const CHAINS = {
  testnet: defineChain({
    id: 5042002,
    name: "Arc Testnet",
    nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.io"] } },
    blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" } },
    testnet: true,
  }),
  mainnet: defineChain({
    id: 5042,
    name: "Arc",
    nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [process.env.ARC_MAINNET_RPC_URL || "https://rpc.mainnet.arc.io"] } },
    blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.arc.io" } },
  }),
};

export const NETWORK = (process.env.ARC_NETWORK || "testnet").toLowerCase();
export const chain = CHAINS[NETWORK];
if (!chain) throw new Error(`unknown ARC_NETWORK "${NETWORK}"`);

/** Contract address: CONTRACT_ADDRESS, else the deployments/ file for this network. */
function defaultContract() {
  try {
    const dep = JSON.parse(readFileSync(join(here, "..", "deployments", `arc-${NETWORK}.json`), "utf8"));
    return dep.contracts.BountyEngine;
  } catch {
    return undefined;
  }
}
export const CONTRACT = process.env.CONTRACT_ADDRESS || defaultContract();
if (!CONTRACT || !/^0x[0-9a-fA-F]{40}$/.test(CONTRACT)) throw new Error("Set CONTRACT_ADDRESS (BountyEngine).");

/** Skip bounties whose per-winner share is below this, so dust bounties can't drain gas. */
export const MIN_SHARE = parseEther(process.env.MIN_SHARE_USDC || "0.05");

export const IDENTITY_REGISTRY =
  NETWORK === "mainnet" ? "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" : "0x8004A818BFB912233c491871b3d84c89A494BD9e";

const rawKey = process.env.WORKER_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY;
export const account = rawKey ? privateKeyToAccount(rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) : null;

export const publicClient = createPublicClient({ chain, transport: http(), batch: { multicall: true } });
export const walletClient = account ? createWalletClient({ account, chain, transport: http() }) : null;

export const txUrl = (h) => `${chain.blockExplorers.default.url}/tx/${h}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => BigInt(Math.floor(Date.now() / 1000));

export const read = (functionName, args = []) =>
  publicClient.readContract({ address: CONTRACT, abi: BOUNTY_ENGINE_ABI, functionName, args });

function needWallet() {
  if (!account || !walletClient) throw new Error("Set WORKER_PRIVATE_KEY (a dedicated wallet holding a little USDC for gas).");
}

async function write(functionName, args, log = () => {}) {
  needWallet();
  const hash = await walletClient.writeContract({ address: CONTRACT, abi: BOUNTY_ENGINE_ABI, functionName, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${txUrl(hash)}`);
  log(`  ✓ ${functionName}: ${txUrl(hash)}`);
  return receipt;
}

async function waitForBlock(target) {
  while ((await publicClient.getBlockNumber()) < target) await sleep(400);
}

/**
 * Deterministic salt: HMAC(key, chain, contract, task, answer). Nothing to
 * store — if the agent crashes between commit and reveal, it recomputes the
 * same salt, sees its commitment already on-chain, and just reveals.
 */
export function saltFor(taskId, answer) {
  needWallet();
  const mac = createHmac("sha256", rawKey).update(`${chain.id}:${CONTRACT}:${taskId}:${answer}`).digest("hex");
  return `0x${mac}`;
}

export const commitmentOf = (answer, salt, who) =>
  keccak256(encodeAbiParameters([{ type: "bytes" }, { type: "bytes32" }, { type: "address" }], [answer, salt, who]));

// ---------------------------------------------------------------------------
// Reading the board
// ---------------------------------------------------------------------------

export function parseSpec(spec) {
  const lines = spec.split("\n");
  const tags = {};
  let i = 0;
  while (i < lines.length && /^[a-z]+:[a-z0-9_-]+$/.test(lines[i].trim())) {
    const [k, v] = lines[i].trim().split(":");
    tags[k] = v;
    i++;
  }
  return { tags, body: lines.slice(i).join("\n").trim() };
}

/** A task as plain JSON (bigints → strings), for logs and MCP tools. */
export function describe(id, t, extra = {}) {
  const { tags, body } = parseSpec(t.spec);
  const share = t.reward / BigInt(t.maxWinners || 1);
  return {
    id: id.toString(),
    status: ["open", "completed", "cancelled"][Number(t.status)],
    mode: Number(t.mode) === MODE.Verified ? "verified" : "curated",
    audience: tags.audience ?? "anyone",
    challenge: tags.solver ?? null,
    brief: body,
    rewardUsdc: formatEther(t.reward),
    winners: Number(t.maxWinners),
    paid: Number(t.paidCount),
    shareUsdc: formatEther(share),
    deadline: new Date(Number(t.resolveDeadline) * 1000).toISOString(),
    creator: t.creator,
    decidedBy: Number(t.mode) === MODE.Verified ? `contract ${t.verifier}` : t.validator,
    taskData: t.taskData,
    ...extra,
  };
}

export async function listTasks({ status = "open" } = {}) {
  const count = await read("taskCount");
  const ids = [];
  for (let i = count; i >= 1n; i--) ids.push(i);
  const tasks = await Promise.all(ids.map((id) => read("getTask", [id])));
  return ids
    .map((id, k) => ({ id, t: tasks[k] }))
    .filter(({ t }) => status === "all" || Number(t.status) === (status === "completed" ? STATUS.Completed : STATUS.Open));
}

// ---------------------------------------------------------------------------
// Acting
// ---------------------------------------------------------------------------

/** Why this agent should NOT take a task, or null if it should. */
export async function skipReason(id, t) {
  if (Number(t.status) !== STATUS.Open) return "not open";
  if (t.resolveDeadline > 0n && now() > t.resolveDeadline) return "past its deadline";
  const share = t.reward / BigInt(t.maxWinners || 1);
  if (share < MIN_SHARE) return `share ${formatEther(share)} USDC is below MIN_SHARE`;
  const me = account.address.toLowerCase();
  if (t.creator.toLowerCase() === me) return "we posted it";
  if (await read("hasWon", [id, account.address])) return "already won";
  if (Number(t.mode) === MODE.Curated) {
    if (t.validator.toLowerCase() === me) return "we are its validator";
    if (parseSpec(t.spec).tags.audience === "people") return "labelled for people";
    if (await read("hasSubmitted", [id, account.address])) return "already submitted";
  } else if (Number(t.paidCount) > 0 && (await read("commitmentOf", [id, account.address])) === `0x${"0".repeat(64)}`) {
    return "commits closed (an answer was already revealed)";
  }
  return null;
}

/** Curated: do the work and submit it. */
export async function submitWork(id, text, log = console.log) {
  return write("submitResult", [id, text], log);
}

/**
 * Verified: commit to `answer`, wait a block (or two when the verifier needs a
 * fresh seed), reveal. Resumable: an existing matching commitment is reused.
 */
export async function commitAndReveal(id, answer, { seedBlocks = 1, beforeReveal, log = console.log } = {}) {
  const salt = saltFor(id, answer);
  const c = commitmentOf(answer, salt, account.address);
  let commitBlock;
  if ((await read("commitmentOf", [id, account.address])) === c) {
    commitBlock = await read("commitBlockOf", [id, account.address]);
    log(`  ↺ reusing our earlier commitment (block ${commitBlock})`);
  } else {
    commitBlock = (await write("commitAnswer", [id, c], log)).blockNumber;
  }
  if (beforeReveal) await beforeReveal();
  await waitForBlock(commitBlock + BigInt(seedBlocks));
  const before = await publicClient.getBalance({ address: account.address });
  const r = await write("revealAndClaim", [id, answer, salt], log);
  const after = await publicClient.getBalance({ address: account.address });
  log(`  💰 net to agent (share − gas): ${formatEther(after - before)} USDC`);
  return r;
}

/** Implementation bounties (TestVectorVerifier): commit to the future address, deploy, reveal. */
async function solveImplementation(id, t, log) {
  const [spec] = decodeAbiParameters(
    [{ type: "tuple", components: [
      { name: "referenceImpl", type: "address" }, { name: "selector", type: "bytes4" }, { name: "maxCodeSize", type: "uint32" },
      { name: "gasPerCall", type: "uint32" }, { name: "randomVectors", type: "uint8" }, { name: "inputBound", type: "uint256" },
      { name: "fixedInputs", type: "uint256[]" },
    ] }],
    t.taskData,
  );
  // The reference agent knows one implementation: popcount(uint256).
  if (spec.selector.toLowerCase() !== keccak256(new TextEncoder().encode("popcount(uint256)")).slice(0, 10)) return false;
  const nonce = await publicClient.getTransactionCount({ address: account.address });
  const predicted = getContractAddress({ from: account.address, nonce: BigInt(nonce + 1) });
  const answer = encodeAbiParameters([{ type: "address" }], [predicted]);
  log(`  implementation will live at ${predicted}; committing first, then deploying`);
  await commitAndReveal(id, answer, {
    seedBlocks: 2, // fresh test inputs come from blockhash(commitBlock + 1)
    log,
    beforeReveal: async () => {
      const hash = await walletClient.sendTransaction({ data: POPCOUNT_FAST_BYTECODE });
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.contractAddress?.toLowerCase() !== predicted.toLowerCase()) throw new Error("deployed at an unexpected address");
      log(`  ✓ deployed implementation: ${txUrl(hash)}`);
    },
  });
  return true;
}

/** Try to earn from one task. Returns a short outcome string. */
export async function work(id, t, log = console.log) {
  needWallet();
  const why = await skipReason(id, t);
  if (why) return `skipped: ${why}`;
  const d = describe(id, t);
  log(`\n▸ #${id} [${d.mode}] ${d.shareUsdc} USDC · ${d.brief.split("\n")[0].slice(0, 80)}`);
  if (d.mode === "curated") {
    const result = await doWork(t.spec);
    await submitWork(id, result, log);
    return "submitted";
  }
  if (d.challenge === "testvector") return (await solveImplementation(id, t, log)) ? "solved" : "skipped: unknown interface";
  const solution = solveVerified(t.spec, t.taskData);
  if (!solution) return "skipped: can't solve this challenge";
  log(`  solved: ${solution.human}`);
  await commitAndReveal(id, solution.answer, { log });
  return "solved";
}

/** Create and link an ERC-8004 profile for this agent, once. */
export async function ensureProfile(log = console.log) {
  needWallet();
  if ((await read("agentIdOf", [account.address])) !== 0n) return;
  const name = process.env.AGENT_NAME || "BountyAgent reference worker";
  const reg = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name,
    description: process.env.AGENT_BIO || "Solves code-checked bounties and does curated work on BountyAgent.",
    services: [{ name: "github", endpoint: "https://github.com/I-frenzy/bountyagent" }],
    active: true,
    supportedTrust: ["reputation"],
    bountyagent: { kind: "agent" },
  };
  const uri = `data:application/json;base64,${Buffer.from(JSON.stringify(reg)).toString("base64")}`;
  const abi = [
    { type: "function", name: "register", stateMutability: "nonpayable", inputs: [{ name: "agentURI", type: "string" }], outputs: [{ type: "uint256" }] },
    { type: "event", name: "Registered", inputs: [{ name: "agentId", type: "uint256", indexed: true }, { name: "agentURI", type: "string", indexed: false }, { name: "owner", type: "address", indexed: true }] },
  ];
  const hash = await walletClient.writeContract({ address: IDENTITY_REGISTRY, abi, functionName: "register", args: [uri] });
  const r = await publicClient.waitForTransactionReceipt({ hash });
  const agentId = parseEventLogs({ abi, eventName: "Registered", logs: r.logs })[0].args.agentId;
  await write("linkAgent", [agentId], log);
  log(`  ✓ ERC-8004 profile #${agentId} "${name}" created and linked`);
}
