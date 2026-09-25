// BountyAgent autonomous worker.
//
// A machine that earns. It watches Arc for new tasks and handles both modes:
//
//   VERIFIED — solves the task (preimage / backdoor), commits an answer, waits
//              a block, then reveals. If the on-chain verifier accepts it, the
//              escrow settles to this wallet atomically. No human in the loop.
//   CURATED  — does the work (Gemini / heuristic) and submits a result for a
//              human/agent validator to approve.
//
//   node agent-worker.js          # run forever, watching for new tasks
//   node agent-worker.js --once   # process currently-open tasks, then exit
//
// Env (see .env.example): WORKER_PRIVATE_KEY, ARC_NETWORK, CONTRACT_ADDRESS,
// optional GEMINI_API_KEY.

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, formatEther, http, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BOUNTY_ENGINE_ABI, MODE, STATUS } from "./abi.js";
import { doWork } from "./analyzer.js";
import { solveVerified } from "./solver.js";

// --- tiny .env loader (no dependency) ---------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const env = readFileSync(join(__dirname, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* no .env file — rely on real env */
}

const CHAINS = {
  testnet: defineChain({
    id: 5042002,
    name: "Arc Testnet",
    nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
    blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" } },
    testnet: true,
  }),
  mainnet: defineChain({
    id: 5042,
    name: "Arc",
    nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
    blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.arc.io" } },
  }),
};

const NETWORK = (process.env.ARC_NETWORK || "testnet").toLowerCase();
const chain = CHAINS[NETWORK];
if (!chain) throw new Error(`unknown ARC_NETWORK "${NETWORK}"`);

const CONTRACT = process.env.CONTRACT_ADDRESS;
if (!CONTRACT || !/^0x[0-9a-fA-F]{40}$/.test(CONTRACT) || /^0x0+$/.test(CONTRACT)) {
  throw new Error("Set CONTRACT_ADDRESS to the deployed BountyEngine address.");
}

const pk = process.env.WORKER_PRIVATE_KEY;
if (!pk) throw new Error("Set WORKER_PRIVATE_KEY (a burner agent wallet).");
const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

const ONCE = process.argv.includes("--once");
const publicClient = createPublicClient({ chain, transport: http() });
const walletClient = createWalletClient({ account, chain, transport: http() });
const seen = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const txUrl = (h) => `${chain.blockExplorers.default.url}/tx/${h}`;
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

async function handleTask(taskId) {
  const id = taskId.toString();
  if (seen.has(id)) return;
  seen.add(id);

  const t = await publicClient.readContract({
    address: CONTRACT,
    abi: BOUNTY_ENGINE_ABI,
    functionName: "getTask",
    args: [taskId],
  });
  if (Number(t.status) !== STATUS.Open) return;
  // Submissions/commits close at the deadline; engaging after it just reverts.
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (t.resolveDeadline > 0n && now > t.resolveDeadline) return;

  try {
    if (Number(t.mode) === MODE.Verified) {
      await handleVerified(taskId, t);
    } else {
      await handleCurated(taskId, t);
    }
  } catch (err) {
    console.error(`  ✗ task #${id}: ${err.shortMessage || err.message}`);
    seen.delete(id); // allow retry
  }
}

async function handleCurated(taskId, t) {
  if (t.validator.toLowerCase() === account.address.toLowerCase()) return;
  const already = await publicClient.readContract({
    address: CONTRACT,
    abi: BOUNTY_ENGINE_ABI,
    functionName: "hasSubmitted",
    args: [taskId, account.address],
  });
  if (already) return;

  console.log(`\n▸ Task #${taskId} [curated]  reward ${formatEther(t.reward)} USDC`);
  const result = await doWork(t.spec);
  console.log(`  work done (${result.length} chars) — submitting…`);
  const hash = await walletClient.writeContract({
    address: CONTRACT,
    abi: BOUNTY_ENGINE_ABI,
    functionName: "submitResult",
    args: [taskId, result],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  ✓ submitted: ${txUrl(hash)} (awaiting validator)`);
}

async function handleVerified(taskId, t) {
  console.log(`\n▸ Task #${taskId} [verified]  reward ${formatEther(t.reward)} USDC`);
  console.log(`  spec: ${clip(t.spec.replace(/\s+/g, " "), 100)}`);

  const solution = solveVerified(t.spec, t.taskData);
  if (!solution) {
    console.log("  – can't solve this task type; skipping.");
    return;
  }
  console.log(`  solved: ${solution.human}. Committing…`);

  const salt = toHex(randomBytes(32));
  const commitment = await publicClient.readContract({
    address: CONTRACT,
    abi: BOUNTY_ENGINE_ABI,
    functionName: "computeCommitment",
    args: [solution.answer, salt, account.address],
  });

  const commitHash = await walletClient.writeContract({
    address: CONTRACT,
    abi: BOUNTY_ENGINE_ABI,
    functionName: "commitAnswer",
    args: [taskId, commitment],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: commitHash });
  console.log(`  ✓ committed (block ${receipt.blockNumber}): ${txUrl(commitHash)}`);

  // reveal must land in a strictly later block (front-run protection)
  while ((await publicClient.getBlockNumber()) <= receipt.blockNumber) await sleep(300);

  const before = await publicClient.getBalance({ address: account.address });
  const revealHash = await walletClient.writeContract({
    address: CONTRACT,
    abi: BOUNTY_ENGINE_ABI,
    functionName: "revealAndClaim",
    args: [taskId, solution.answer, salt],
  });
  await publicClient.waitForTransactionReceipt({ hash: revealHash });
  const after = await publicClient.getBalance({ address: account.address });
  console.log(`  ✓ revealed & CLAIMED: ${txUrl(revealHash)}`);
  console.log(`  💰 net to agent (reward − gas): ${formatEther(after - before)} USDC`);
}

async function sweepOpenTasks() {
  const count = await publicClient.readContract({
    address: CONTRACT,
    abi: BOUNTY_ENGINE_ABI,
    functionName: "taskCount",
  });
  for (let i = 1n; i <= count; i++) await handleTask(i);
}

async function main() {
  const bal = await publicClient.getBalance({ address: account.address });
  console.log("BountyAgent worker online");
  console.log(`  network : ${chain.name} (${chain.id})`);
  console.log(`  contract: ${CONTRACT}`);
  console.log(`  agent   : ${account.address}`);
  console.log(`  balance : ${formatEther(bal)} USDC`);
  console.log(`  brain   : ${process.env.GEMINI_API_KEY ? "Gemini" : "heuristic (offline)"}`);

  await sweepOpenTasks();
  if (ONCE) {
    console.log("\n--once: done.");
    return;
  }

  console.log("\nWatching for new tasks… (Ctrl-C to stop)");
  publicClient.watchContractEvent({
    address: CONTRACT,
    abi: BOUNTY_ENGINE_ABI,
    eventName: "TaskCreated",
    onLogs: (logs) => {
      for (const log of logs) {
        handleTask(log.args.taskId).catch((e) => console.error("handleTask:", e.message));
      }
    },
    onError: (e) => console.error("watch error:", e.message),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
