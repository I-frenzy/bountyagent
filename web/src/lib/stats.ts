import type { TaskWithSubs } from "./useTasks";
import { MODE } from "./bountyAbi";

export type Earner = {
  address: `0x${string}`;
  earned: bigint;
  wins: number;
  verifiedWins: number;
  /** Distinct posters who paid them — one poster paying themselves via alts can't inflate this. */
  posters: number;
  lastWinAt: bigint;
};

/** Everyone who has been paid, aggregated from the engine's own records. */
export function earners(tasks: TaskWithSubs[]): Earner[] {
  const by = new Map<string, Earner & { posterSet: Set<string> }>();
  for (const { task, winners } of tasks) {
    const share = task.reward / BigInt(task.maxWinners || 1);
    for (const w of winners) {
      const k = w.toLowerCase();
      const e =
        by.get(k) ??
        { address: w, earned: 0n, wins: 0, verifiedWins: 0, posters: 0, lastWinAt: 0n, posterSet: new Set<string>() };
      e.earned += share;
      e.wins += 1;
      if (task.mode === MODE.Verified) e.verifiedWins += 1;
      e.posterSet.add(task.creator.toLowerCase());
      if (task.createdAt > e.lastWinAt) e.lastWinAt = task.createdAt;
      by.set(k, e);
    }
  }
  return [...by.values()]
    .map(({ posterSet, ...e }) => ({ ...e, posters: posterSet.size }))
    .sort((a, b) => (b.earned === a.earned ? b.verifiedWins - a.verifiedWins : b.earned > a.earned ? 1 : -1));
}

/** Totals for the home page proof band. */
export function totals(tasks: TaskWithSubs[]) {
  let paid = 0n;
  let settled = 0;
  let open = 0n;
  for (const { task } of tasks) {
    const share = task.reward / BigInt(task.maxWinners || 1);
    paid += share * BigInt(task.paidCount);
    if (task.status === 0) open += task.reward - share * BigInt(task.paidCount);
    else if (task.paidCount > 0) settled += 1;
  }
  return { paid, settled, open, solvers: earners(tasks).length };
}
