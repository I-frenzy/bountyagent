// BountyAgent autonomous worker.
//
// A machine that earns: it watches Arc for TaskCreated events, does the
// requested work off-chain (Gemini or a deterministic fallback), and submits
// its result on-chain. When the task's validator approves it, the escrowed
// native USDC settles straight to this wallet — no human in the loop.
//
//   node agent-worker.js          # run forever, watching for new tasks
//   node agent-worker.js --once   # process any currently-open tasks, then exit
//
// Env (see .env.example):
//   WORKER_PRIVATE_KEY   0x-prefixed key of a burner agent wallet (needs a
//                        little USDC for gas on Arc)
//   ARC_NETWORK          "testnet" (default) or "mainnet"
//   CONTRACT_ADDRESS     BountyEngine address (overrides the built-in default)
//   GEMINI_API_KEY       optional — enables real LLM work

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BOUNTY_ENGINE_ABI } from "./abi.js";
import { doWork } from "./analyzer.js";

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

// --- chains -----------------------------------------------------------------
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

const DEFAULT_CONTRACT = {
  testnet: process.env.CONTRACT_ADDRESS || "0x0000000000000000000000000000000000000000",
  mainnet: process.env.CONTRACT_ADDRESS || "0x0000000000000000000000000000000000000000",
};

// --- config -----------------------------------------------------------------
const NETWORK = (process.env.ARC_NETWORK || "testnet").toLowerCase();
const chain = CHAINS[NETWORK];
if (!chain) throw new Error(`unknown ARC_NETWORK "${NETWORK}"`);

const CONTRACT = (process.env.CONTRACT_ADDRESS || DEFAULT_CONTRACT[NETWORK]);
if (!/^0x[0-9a-fA-F]{40}$/.test(CONTRACT) || /^0x0+$/.test(CONTRACT)) {
  throw new Error("Set CONTRACT_ADDRESS to the deployed BountyEngine address.");
}

const pk = process.env.WORKER_PRIVATE_KEY;
if (!pk) throw new Error("Set WORKER_PRIVATE_KEY (a burner agent wallet).");
const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

const ONCE = process.argv.includes("--once");

const publicClient = createPublicClient({ chain, transport: http() });
const walletClient = createWalletClient({ account, chain, transport: http() });

const seen = new Set(); // taskIds we've already handled this run

// --- work loop --------------------------------------------------------------
async function handleTask(taskId, spec, validator, reward) {
  const id = taskId.toString();
  if (seen.has(id)) return;
  seen.add(id);

  // don't work tasks we validate or that are already ours
  if (validator?.toLowerCase() === account.address.toLowerCase()) return;

  // skip if already submitted (e.g. on a restart)
  const already = await publicClient.readContract({
    address: CONTRACT,
    abi: BOUNTY_ENGINE_ABI,
    functionName: "hasSubmitted",
    args: [taskId, account.address],
  });
  if (already) return;

  console.log(`\n▸ Task #${id}  reward ${formatEther(reward)} USDC`);
  console.log(`  spec: ${clip(spec, 120)}`);

  const result = await doWork(spec);
  console.log(`  work done (${result.length} chars). Submitting on-chain…`);

  try {
    const hash = await walletClient.writeContract({
      address: CONTRACT,
      abi: BOUNTY_ENGINE_ABI,
      functionName: "submitResult",
      args: [taskId, result],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    const url = `${chain.blockExplorers.default.url}/tx/${hash}`;
    console.log(`  ✓ submitted: ${url}`);
    console.log(`  awaiting validator approval → payout of ${formatEther(reward)} USDC`);
  } catch (err) {
    console.error(`  ✗ submit failed: ${err.shortMessage || err.message}`);
    seen.delete(id); // allow a retry next tick
  }
}

async function sweepOpenTasks() {
  // On startup, process any tasks that are already open (Status.Open == 0).
  const count = await publicClient.readContract({
    address: CONTRACT,
    abi: BOUNTY_ENGINE_ABI,
    functionName: "taskCount",
  });
  for (let i = 1n; i <= count; i++) {
    const t = await publicClient.readContract({
      address: CONTRACT,
      abi: BOUNTY_ENGINE_ABI,
      functionName: "getTask",
      args: [i],
    });
    if (Number(t.status) === 0) {
      await handleTask(i, t.spec, t.validator, t.reward);
    }
  }
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
        const { taskId, spec, validator, reward } = log.args;
        handleTask(taskId, spec, validator, reward).catch((e) =>
          console.error("handleTask error:", e.message)
        );
      }
    },
    onError: (e) => console.error("watch error:", e.message),
  });
}

function clip(str, n) {
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
