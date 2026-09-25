// Full testnet rehearsal: runs every BountyAgent flow for real on Arc testnet
// and records each transaction as evidence (deployments/arc-testnet-rehearsal.json).
//
//   CREATOR_KEY=0x… WORKER_PRIVATE_KEY=0x… node rehearsal.js
//
// Uses throwaway testnet wallets only.
import { readFileSync, writeFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  formatEther,
  getContractAddress,
  http,
  keccak256,
  parseEther,
  parseEventLogs,
  stringToHex,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { BOUNTY_ENGINE_ABI } from "./abi.js";
import { COMMERCE_ABI, EVALUATOR_ABI, POPCOUNT_FAST_BYTECODE } from "./artifacts.js";

const dep = JSON.parse(readFileSync(new URL("../deployments/arc-testnet.json", import.meta.url)));
const C = dep.contracts;
const COMMERCE = "0x0747EEf0706327138c69792bF28Cd525089e4583";
const IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const REPUTATION = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
const USDC = "0x3600000000000000000000000000000000000000";
const EXPLORER = "https://explorer.testnet.arc.io";

const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
});

const identityAbi = [
  { type: "function", name: "register", stateMutability: "nonpayable", inputs: [{ name: "agentURI", type: "string" }], outputs: [{ type: "uint256" }] },
  { type: "event", name: "Registered", inputs: [{ name: "agentId", type: "uint256", indexed: true }, { name: "agentURI", type: "string", indexed: false }, { name: "owner", type: "address", indexed: true }] },
];
const reputationAbi = [
  { type: "function", name: "getSummary", stateMutability: "view", inputs: [{ name: "agentId", type: "uint256" }, { name: "clientAddresses", type: "address[]" }, { name: "tag1", type: "string" }, { name: "tag2", type: "string" }], outputs: [{ type: "uint64" }, { type: "int128" }, { type: "uint8" }] },
];
const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
];

const pub = createPublicClient({ chain: arcTestnet, transport: http() });
const wallet = (key) => {
  const account = privateKeyToAccount(key);
  return { account, client: createWalletClient({ account, chain: arcTestnet, transport: http() }) };
};
const creator = wallet(process.env.CREATOR_KEY);
const worker = wallet(process.env.WORKER_PRIVATE_KEY);

const evidence = { network: "arc-testnet", ranAt: new Date().toISOString(), flows: [] };
let flow;
const begin = (name) => {
  flow = { name, steps: [] };
  evidence.flows.push(flow);
  console.log(`\n■ ${name}`);
};

async function send(who, label, params) {
  const hash = await who.client.writeContract(params);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted (${hash})`);
  const fee = r.gasUsed * r.effectiveGasPrice;
  flow.steps.push({ label, tx: hash, block: Number(r.blockNumber), feeUsdc: formatEther(fee), url: `${EXPLORER}/tx/${hash}` });
  console.log(`  ✓ ${label.padEnd(44)} block ${r.blockNumber}  fee $${Number(formatEther(fee)).toFixed(4)}  ${hash.slice(0, 12)}…`);
  return r;
}
const engine = (who, label, functionName, args, value) =>
  send(who, label, { address: C.BountyEngine, abi: BOUNTY_ENGINE_ABI, functionName, args, value });

async function waitBlocks(after, n = 1) {
  for (;;) {
    if ((await pub.getBlockNumber()) >= after + BigInt(n)) return;
    await new Promise((r) => setTimeout(r, 400));
  }
}
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 3600);
const taskIdOf = (r) => parseEventLogs({ abi: BOUNTY_ENGINE_ABI, eventName: "TaskCreated", logs: r.logs })[0].args.taskId;
const check = (cond, msg) => {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  console.log(`  ✔ ${msg}`);
  flow.checks = [...(flow.checks ?? []), msg];
};
const commitment = (answer, salt, who) =>
  keccak256(encodeAbiParameters([{ type: "bytes" }, { type: "bytes32" }, { type: "address" }], [answer, salt, who]));

async function main() {
  console.log(`creator ${creator.account.address}  ${formatEther(await pub.getBalance({ address: creator.account.address }))} USDC`);
  console.log(`worker  ${worker.account.address}  ${formatEther(await pub.getBalance({ address: worker.account.address }))} USDC`);

  // 1 ── worker profile (ERC-8004 identity) linked to the engine ───────────
  begin("ERC-8004 profile for the reference agent");
  const reg = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "BountyAgent reference worker",
    description: "The reference agent: solves code-checked bounties and does curated work.",
    services: [{ name: "github", endpoint: "https://github.com/I-frenzy/bountyagent" }],
    active: true,
    supportedTrust: ["reputation"],
    bountyagent: { kind: "agent" },
  };
  const uri = `data:application/json;base64,${Buffer.from(JSON.stringify(reg)).toString("base64")}`;
  const r1 = await send(worker, "register ERC-8004 identity", { address: IDENTITY, abi: identityAbi, functionName: "register", args: [uri] });
  const agentId = parseEventLogs({ abi: identityAbi, eventName: "Registered", logs: r1.logs })[0].args.agentId;
  await engine(worker, `linkAgent(${agentId})`, "linkAgent", [agentId]);
  evidence.agentId = agentId.toString();

  // 2 ── curated: poster decides ─────────────────────────────────────────
  begin("Curated bounty (poster decides)");
  let r = await engine(creator, "createTask 0.10 USDC", "createTask", ["Translate 'Work judged and paid by code' into French.", "0x0000000000000000000000000000000000000000", deadline(), 1], parseEther("0.10"));
  let id = taskIdOf(r);
  await engine(worker, `submitResult #${id}`, "submitResult", [id, "Du travail jugé et payé par le code."]);
  let before = await pub.getBalance({ address: worker.account.address });
  await engine(creator, `completeTask #${id} → worker`, "completeTask", [id, worker.account.address]);
  check((await pub.getBalance({ address: worker.account.address })) > before, "worker received the 0.10 USDC");

  // 3 ── verified: backdoor CTF, commit → reveal, reputation recorded ─────
  begin("Verified bounty: backdoor CTF (commit → reveal, auto-pay)");
  const td = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [C.VulnerableTarget, 1_000_000n]);
  r = await engine(creator, "createVerifiedTask 0.10 USDC", "createVerifiedTask", ["solver:backdoor\nFind a small input that passes VulnerableTarget.check().", C.BackdoorVerifier, td, deadline(), 1], parseEther("0.10"));
  id = taskIdOf(r);
  const answer = encodeAbiParameters([{ type: "uint256" }], [1337n]);
  const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
  r = await engine(worker, `commitAnswer #${id}`, "commitAnswer", [id, commitment(answer, salt, worker.account.address)]);
  await waitBlocks(r.blockNumber);
  before = await pub.getBalance({ address: worker.account.address });
  r = await engine(worker, `revealAndClaim #${id} (1337)`, "revealAndClaim", [id, answer, salt]);
  check((await pub.getBalance({ address: worker.account.address })) > before, "paid automatically in the reveal transaction");
  const rec = parseEventLogs({ abi: BOUNTY_ENGINE_ABI, eventName: "ReputationRecorded", logs: r.logs })[0];
  check(rec?.args.ok === true, "win recorded on ERC-8004 reputation");
  const [count] = await pub.readContract({ address: REPUTATION, abi: reputationAbi, functionName: "getSummary", args: [agentId, [C.BountyEngine], "bountyagent", "verified"] });
  check(count >= 1n, `getSummary(verified) from the engine = ${count}`);

  // 4 ── multi-claim: 3 winners, 2 paid, finish early ────────────────────
  begin("Multi-winner bounty: 3 × 0.03, two paid, finish early");
  const third = wallet(generatePrivateKey());
  {
    const hash = await creator.client.sendTransaction({ to: third.account.address, value: parseEther("0.02") });
    const rr = await pub.waitForTransactionReceipt({ hash });
    flow.steps.push({ label: "fund a third test wallet 0.02", tx: hash, block: Number(rr.blockNumber), url: `${EXPLORER}/tx/${hash}` });
    console.log(`  ✓ fund a third test wallet 0.02                 ${hash.slice(0, 12)}…`);
  }
  r = await engine(creator, "createTask 3 × 0.03 USDC", "createTask", ["audience:people\nShare one thing you'd improve on bountyagent.vercel.app.", "0x0000000000000000000000000000000000000000", deadline(), 3], parseEther("0.09"));
  id = taskIdOf(r);
  await engine(worker, `submitResult #${id} (worker)`, "submitResult", [id, "Explain escrow in one line next to the amount."]);
  await engine(third, `submitResult #${id} (third)`, "submitResult", [id, "Show the fee in dollars on every receipt."]);
  await engine(creator, `completeTask #${id} → worker`, "completeTask", [id, worker.account.address]);
  await engine(creator, `completeTask #${id} → third`, "completeTask", [id, third.account.address]);
  before = await pub.getBalance({ address: creator.account.address });
  r = await engine(creator, `finalizeTask #${id} (refund 1 share)`, "finalizeTask", [id]);
  const closed = parseEventLogs({ abi: BOUNTY_ENGINE_ABI, eventName: "TaskClosed", logs: r.logs })[0];
  check(closed.args.refunded === parseEther("0.03"), "unpaid share (0.03) refunded to the creator");

  // 5 ── F3: implementation bounty (TestVectorVerifier) ──────────────────
  begin("Implementation bounty: deploy popcount that passes fresh random tests");
  const spec = {
    referenceImpl: C.PopcountReference,
    selector: "0x" + keccak256(stringToHex("popcount(uint256)")).slice(2, 10),
    maxCodeSize: 2000,
    gasPerCall: 3000,
    randomVectors: 16,
    inputBound: 0n,
    fixedInputs: [0n, 1n, 2n ** 256n - 1n],
  };
  const specData = encodeAbiParameters(
    [{ type: "tuple", components: [
      { name: "referenceImpl", type: "address" }, { name: "selector", type: "bytes4" }, { name: "maxCodeSize", type: "uint32" },
      { name: "gasPerCall", type: "uint32" }, { name: "randomVectors", type: "uint8" }, { name: "inputBound", type: "uint256" },
      { name: "fixedInputs", type: "uint256[]" },
    ] }],
    [spec],
  );
  r = await engine(creator, "createVerifiedTask popcount 0.10 USDC", "createVerifiedTask", ["solver:testvector\nImplement popcount(uint256) in under 3000 gas per call.", C.TestVectorVerifier, specData, deadline(), 1], parseEther("0.10"));
  id = taskIdOf(r);
  // Commit to the address the implementation WILL have (next nonce + 1), then deploy.
  const nonce = await pub.getTransactionCount({ address: worker.account.address });
  const predicted = getContractAddress({ from: worker.account.address, nonce: BigInt(nonce + 1) });
  const implAnswer = encodeAbiParameters([{ type: "address" }], [predicted]);
  const implSalt = toHex(crypto.getRandomValues(new Uint8Array(32)));
  r = await engine(worker, `commitAnswer #${id} (predicted ${predicted.slice(0, 8)}…)`, "commitAnswer", [id, commitment(implAnswer, implSalt, worker.account.address)]);
  const commitBlock = r.blockNumber;
  const dh = await worker.client.sendTransaction({ data: POPCOUNT_FAST_BYTECODE });
  const dr = await pub.waitForTransactionReceipt({ hash: dh });
  flow.steps.push({ label: "deploy popcount implementation", tx: dh, block: Number(dr.blockNumber), url: `${EXPLORER}/tx/${dh}` });
  console.log(`  ✓ deploy popcount implementation              ${dr.contractAddress}`);
  check(dr.contractAddress?.toLowerCase() === predicted.toLowerCase(), "deployed exactly at the committed address");
  await waitBlocks(commitBlock, 2); // fresh inputs come from blockhash(commitBlock + 1)
  before = await pub.getBalance({ address: worker.account.address });
  await engine(worker, `revealAndClaim #${id} (tests run on-chain)`, "revealAndClaim", [id, implAnswer, implSalt]);
  check((await pub.getBalance({ address: worker.account.address })) > before, "implementation passed 19 on-chain tests and was paid");

  // 6 ── F1: an ERC-8183 job on Arc's own AgenticCommerce ───────────────
  begin("ERC-8183 job on Arc's own contract, settled by VerifierEvaluator");
  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 3600);
  r = await send(creator, "commerce.createJob (evaluator = ours)", { address: COMMERCE, abi: COMMERCE_ABI, functionName: "createJob", args: [worker.account.address, C.VerifierEvaluator, expiredAt, "Find the word with this keccak256 hash.", "0x0000000000000000000000000000000000000000"] });
  const created = parseEventLogs({ abi: COMMERCE_ABI, eventName: "JobCreated", logs: r.logs })[0];
  const jobId = created ? created.args.jobId : await pub.readContract({ address: COMMERCE, abi: COMMERCE_ABI, functionName: "jobCounter" });
  const word = stringToHex("orbit");
  await send(creator, `evaluator.configure(#${jobId}, preimage)`, { address: C.VerifierEvaluator, abi: EVALUATOR_ABI, functionName: "configure", args: [jobId, C.PreimageVerifier, encodeAbiParameters([{ type: "bytes32" }], [keccak256(word)])] });
  const BUDGET = 50_000n; // 0.05 USDC (ERC-20 view, 6 decimals)
  await send(worker, `commerce.setBudget(#${jobId}, 0.05)`, { address: COMMERCE, abi: COMMERCE_ABI, functionName: "setBudget", args: [jobId, BUDGET, "0x"] });
  await send(creator, "USDC.approve(exact budget)", { address: USDC, abi: erc20Abi, functionName: "approve", args: [COMMERCE, BUDGET] });
  await send(creator, `commerce.fund(#${jobId})`, { address: COMMERCE, abi: COMMERCE_ABI, functionName: "fund", args: [jobId, "0x"] });
  const jSalt = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const jCommit = commitment(word, jSalt, worker.account.address);
  r = await send(worker, `evaluator.commit(#${jobId})`, { address: C.VerifierEvaluator, abi: EVALUATOR_ABI, functionName: "commit", args: [jobId, jCommit] });
  await send(worker, `commerce.submit(#${jobId})`, { address: COMMERCE, abi: COMMERCE_ABI, functionName: "submit", args: [jobId, jCommit, "0x"] });
  await waitBlocks(r.blockNumber);
  const usdcBefore = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [worker.account.address] });
  await send(worker, `evaluator.settle(#${jobId}, "orbit")`, { address: C.VerifierEvaluator, abi: EVALUATOR_ABI, functionName: "settle", args: [jobId, word, jSalt] });
  const job = await pub.readContract({ address: COMMERCE, abi: COMMERCE_ABI, functionName: "getJob", args: [jobId] });
  check(Number(job.status) === 3, "Arc's ERC-8183 job is Completed — no person evaluated it");
  const usdcAfter = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [worker.account.address] });
  check(usdcAfter > usdcBefore, "provider received the job budget in USDC");
  evidence.erc8183JobId = jobId.toString();

  // 7 ── cancel before anyone engages ────────────────────────────────────
  begin("Cancel before anyone engages (full refund)");
  r = await engine(creator, "createTask 0.01 USDC", "createTask", ["Placeholder to cancel.", "0x0000000000000000000000000000000000000000", deadline(), 1], parseEther("0.01"));
  id = taskIdOf(r);
  await engine(creator, `cancelTask #${id}`, "cancelTask", [id]);

  const all = evidence.flows.flatMap((f) => f.steps);
  const fees = all.reduce((s, x) => s + Number(x.feeUsdc ?? 0), 0);
  evidence.summary = { transactions: all.length, totalFeesUsdc: fees.toFixed(4) };
  writeFileSync(new URL("../deployments/arc-testnet-rehearsal.json", import.meta.url), JSON.stringify(evidence, null, 2));
  console.log(`\nAll flows passed: ${all.length} transactions, $${fees.toFixed(4)} in total fees. Evidence saved.`);
}

main().catch((e) => {
  console.error(`\n✗ ${e.shortMessage ?? e.message}`);
  process.exit(1);
});
