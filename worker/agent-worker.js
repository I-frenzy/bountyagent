// BountyAgent reference agent — runs forever, earning from open bounties.
//
//   VERIFIED — solves the challenge (preimage / backdoor / implementation),
//              commits, waits, reveals; the contract checks and pays it in the
//              same transaction. No person in the loop.
//   CURATED  — does the work (Gemini, or a deterministic analyzer) and submits
//              it for the poster to choose. Skips bounties labelled for people.
//
//   node agent-worker.js          # watch forever
//   node agent-worker.js --once   # one pass over open bounties, then exit
//
// Env (see .env.example): WORKER_PRIVATE_KEY, ARC_NETWORK, optional
// CONTRACT_ADDRESS, MIN_SHARE_USDC, AGENT_NAME, GEMINI_API_KEY.
import { formatEther } from "viem";
import { BOUNTY_ENGINE_ABI } from "./abi.js";
import { CONTRACT, account, chain, ensureProfile, listTasks, publicClient, read, work } from "./core.js";

const ONCE = process.argv.includes("--once");
const busy = new Set();

async function handle(id) {
  const key = id.toString();
  if (busy.has(key)) return;
  busy.add(key);
  try {
    const outcome = await work(id, await read("getTask", [id]));
    if (!outcome.startsWith("skipped")) console.log(`  → ${outcome}`);
  } catch (e) {
    console.error(`  ✗ #${key}: ${e.shortMessage || e.message}`);
  } finally {
    busy.delete(key);
  }
}

async function main() {
  if (!account) throw new Error("Set WORKER_PRIVATE_KEY (a dedicated wallet holding a little USDC for gas).");
  console.log("BountyAgent reference agent online");
  console.log(`  network : ${chain.name} (${chain.id})`);
  console.log(`  contract: ${CONTRACT}`);
  console.log(`  agent   : ${account.address}`);
  console.log(`  balance : ${formatEther(await publicClient.getBalance({ address: account.address }))} USDC`);
  console.log(`  brain   : ${process.env.GEMINI_API_KEY ? "Gemini" : "deterministic analyzer (offline)"}`);
  await ensureProfile().catch((e) => console.warn(`  ! profile: ${e.shortMessage || e.message}`));

  for (const { id } of await listTasks()) await handle(id);
  if (ONCE) return console.log("\n--once: done.");

  console.log("\nWatching for new bounties… (Ctrl-C to stop)");
  publicClient.watchContractEvent({
    address: CONTRACT,
    abi: BOUNTY_ENGINE_ABI,
    eventName: "TaskCreated",
    onLogs: (logs) => logs.forEach((l) => void handle(l.args.taskId)),
    onError: (e) => console.error("watch error:", e.message),
  });
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
