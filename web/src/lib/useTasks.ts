"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "./wallet";
import { useNetwork } from "./network";
import { bountyEngineAbi, type ChainSubmission, type ChainTask } from "./bountyAbi";

export type TaskWithSubs = {
  id: bigint;
  task: ChainTask;
  submissions: ChainSubmission[];
};

type State = {
  tasks: TaskWithSubs[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

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

      const out = await Promise.all(
        ids.map(async (id) => {
          const [task, submissions] = await Promise.all([
            publicClient.readContract({
              address: contract,
              abi: bountyEngineAbi,
              functionName: "getTask",
              args: [id],
            }) as Promise<ChainTask>,
            publicClient.readContract({
              address: contract,
              abi: bountyEngineAbi,
              functionName: "getSubmissions",
              args: [id],
            }) as Promise<ChainSubmission[]>,
          ]);
          return { id, task, submissions };
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
