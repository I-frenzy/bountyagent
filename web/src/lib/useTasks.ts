"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "./wallet";
import { useNetwork } from "./network";
import { bountyEngineAbi, type ChainSubmission, type ChainTask } from "./bountyAbi";

export type TaskWithSubs = {
  id: bigint;
  task: ChainTask;
  submissions: ChainSubmission[];
  /** Best-effort original bounty (reward is zeroed on settle). 0n if unknown. */
  originalReward: bigint;
  /** Whether we actually know the original amount (live or cached/event). */
  rewardKnown: boolean;
};

type State = {
  tasks: TaskWithSubs[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

// The Arc RPC caps getLogs to a small block range, so we can't scan history in
// one call. Instead we (a) cache every reward we observe while a task is open,
// and (b) do a cheap recent-window event scan each load. Cache is per network.
function cacheKey(chainId: number, contract: string) {
  return `ba-rewards-${chainId}-${contract.toLowerCase()}`;
}
function loadCache(chainId: number, contract: string): Map<string, bigint> {
  try {
    const raw = window.localStorage.getItem(cacheKey(chainId, contract));
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, string>;
    return new Map(Object.entries(obj).map(([k, v]) => [k, BigInt(v)]));
  } catch {
    return new Map();
  }
}
function saveCache(chainId: number, contract: string, map: Map<string, bigint>) {
  try {
    const obj: Record<string, string> = {};
    for (const [k, v] of map) obj[k] = v.toString();
    window.localStorage.setItem(cacheKey(chainId, contract), JSON.stringify(obj));
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}

export function useTasks(pollMs = 10_000): State {
  const { publicClient } = useWallet();
  const { contract, chain, isContractConfigured } = useNetwork();
  const [tasks, setTasks] = useState<TaskWithSubs[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (!isContractConfigured || busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const rewards = loadCache(chain.id, contract);

      // Cheap recent-window event scan (last ~900 blocks) to catch fresh posts.
      try {
        const latest = await publicClient.getBlockNumber();
        const from = latest > 900n ? latest - 900n : 0n;
        const logs = await publicClient.getContractEvents({
          address: contract,
          abi: bountyEngineAbi,
          eventName: "TaskCreated",
          fromBlock: from,
          toBlock: "latest",
        });
        for (const log of logs) {
          const args = (log as { args?: { taskId?: bigint; reward?: bigint } }).args;
          if (args?.taskId !== undefined && args?.reward !== undefined) {
            rewards.set(args.taskId.toString(), args.reward);
          }
        }
      } catch {
        /* range too wide / RPC hiccup — rely on cache + live reward */
      }

      const count = (await publicClient.readContract({
        address: contract,
        abi: bountyEngineAbi,
        functionName: "taskCount",
      })) as unknown as bigint;

      const ids: bigint[] = [];
      for (let i = count; i >= 1n; i--) ids.push(i); // newest first

      const out = await Promise.all(
        ids.map(async (id) => {
          const [task, submissions] = await Promise.all([
            publicClient.readContract({
              address: contract,
              abi: bountyEngineAbi,
              functionName: "getTask",
              args: [id],
            }) as unknown as Promise<ChainTask>,
            publicClient.readContract({
              address: contract,
              abi: bountyEngineAbi,
              functionName: "getSubmissions",
              args: [id],
            }) as unknown as Promise<ChainSubmission[]>,
          ]);

          // If the task is still holding escrow, that IS the original — cache it.
          if (task.reward > 0n) rewards.set(id.toString(), task.reward);
          const cached = rewards.get(id.toString());
          const originalReward = task.reward > 0n ? task.reward : cached ?? 0n;
          const rewardKnown = task.reward > 0n || cached !== undefined;

          return { id, task, submissions, originalReward, rewardKnown };
        }),
      );

      saveCache(chain.id, contract, rewards);
      setTasks(out);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      busy.current = false;
    }
  }, [publicClient, contract, chain.id, isContractConfigured]);

  useEffect(() => {
    setTasks([]);
    void load();
    if (!isContractConfigured) return;
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs, isContractConfigured]);

  return { tasks, loading, error, refresh: load };
}
