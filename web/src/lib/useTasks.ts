"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "./wallet";
import { useNetwork } from "./network";
import { bountyEngineAbi, type ChainSubmission, type ChainTask } from "./bountyAbi";

export type TaskWithSubs = {
  id: bigint;
  task: ChainTask;
  submissions: ChainSubmission[];
  /** Paid winners, in payout order (multi-claim bounties can have several). */
  winners: `0x${string}`[];
};

type State = {
  tasks: TaskWithSubs[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

/**
 * Reads the whole board from the contract. The engine keeps each task's full
 * reward and its winners on-chain, so no event scanning (Arc's RPC caps
 * getLogs ranges) and no local cache are needed. The public client batches
 * these reads through Multicall3, so a board of N tasks costs a handful of RPC
 * calls instead of 3N — the public Arc RPC rate-limits hard.
 */
export function useTasks(pollMs = 10_000): State {
  const { publicClient } = useWallet();
  const { contract, isContractConfigured } = useNetwork();
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
      const count = (await publicClient.readContract({
        address: contract,
        abi: bountyEngineAbi,
        functionName: "taskCount",
      })) as bigint;

      const ids: bigint[] = [];
      for (let i = count; i >= 1n; i--) ids.push(i); // newest first

      const read = <T,>(functionName: "getTask" | "getSubmissions" | "getWinners", id: bigint) =>
        publicClient.readContract({ address: contract, abi: bountyEngineAbi, functionName, args: [id] }) as Promise<T>;

      const out = await Promise.all(
        ids.map(async (id) => {
          const [task, submissions, winners] = await Promise.all([
            read<ChainTask>("getTask", id),
            read<ChainSubmission[]>("getSubmissions", id),
            read<`0x${string}`[]>("getWinners", id),
          ]);
          return { id, task, submissions, winners };
        }),
      );
      setTasks(out);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      busy.current = false;
    }
  }, [publicClient, contract, isContractConfigured]);

  useEffect(() => {
    setTasks([]);
    void load();
    if (!isContractConfigured) return;
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs, isContractConfigured]);

  return { tasks, loading, error, refresh: load };
}
