// One pass of the reference agent over open bounties, then exit — for
// scheduled runs (.github/workflows/agent.yml runs this every 5 minutes).
// Stops starting new work after TICK_BUDGET_SECONDS so runs never overlap.
import { account, ensureProfile, listTasks, work } from "./core.js";

const budgetMs = Number(process.env.TICK_BUDGET_SECONDS || 240) * 1000;
const started = Date.now();

async function main() {
  if (!account) {
    console.log("No WORKER_PRIVATE_KEY configured — nothing to do.");
    return;
  }
  await ensureProfile().catch((e) => console.warn(`profile: ${e.shortMessage || e.message}`));
  const open = await listTasks();
  console.log(`${open.length} open bount${open.length === 1 ? "y" : "ies"}`);
  for (const { id, t } of open) {
    if (Date.now() - started > budgetMs) {
      console.log("time budget reached; the next tick continues");
      break;
    }
    try {
      const outcome = await work(id, t);
      console.log(`#${id}: ${outcome}`);
    } catch (e) {
      console.error(`#${id}: ✗ ${e.shortMessage || e.message}`);
    }
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
