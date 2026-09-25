"use client";

import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { useWallet } from "./wallet";
import { useNetwork } from "./network";
import { bountyEngineAbi, type ChainSubmission, type ChainTask } from "./bountyAbi";

export type ReceiptStep = {
  kind: "posted" | "revealed" | "paid" | "reputation" | "closed";
  tx: Hex;
  block: bigint;
  timestamp: bigint;
  /** USDC fee for the whole transaction (native 18-decimal units). */
  fee: bigint;
  who?: `0x${string}`;
  amount?: bigint;
  answer?: Hex;
  ok?: boolean; // reputation recorded?
  refunded?: bigint;
};

export type TaskReceipt = {
  task: ChainTask;
  submissions: ChainSubmission[];
  winners: `0x${string}`[];
  steps: ReceiptStep[];
  /** Revealed answers by solver (verified bounties). */
  answers: Record<string, Hex>;
  /** Total USDC fees across the distinct transactions above. */
  totalFees: bigint;
  /** Seconds from posting to the first payout. */
  timeToFirstPayout?: bigint;
};

// Arc's public RPC caps eth_getLogs ranges; payouts between the first and the
// last one are scanned in chunks of this many blocks.
const CHUNK = 2_000n;
const MAX_SCAN = 200_000n;

/**
 * A bounty's full on-chain history, read from the exact blocks the engine
 * recorded (createdBlock, firstPaidBlock, settledBlock) — no indexer needed —
 * plus each transaction's receipt for the fee actually paid.
 */
export function useTaskReceipt(id: bigint | null, enabled = true) {
  const { publicClient } = useWallet();
  const { contract, isContractConfigured } = useNetwork();
  const [state, setState] = useState<{ loading: boolean; data: TaskReceipt | null; error: string | null }>({
    loading: true,
    data: null,
    error: null,
  });

  useEffect(() => {
    if (id === null || !enabled || !isContractConfigured) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      const read = <T,>(functionName: "getTask" | "getSubmissions" | "getWinners") =>
        publicClient.readContract({ address: contract, abi: bountyEngineAbi, functionName, args: [id] }) as Promise<T>;
      const [task, submissions, winners] = await Promise.all([
        read<ChainTask>("getTask"),
        read<ChainSubmission[]>("getSubmissions"),
        read<`0x${string}`[]>("getWinners"),
      ]);
      if (task.creator === "0x0000000000000000000000000000000000000000") throw new Error("No bounty with this number.");

      const logsIn = async (from: bigint, to: bigint) => {
        const out = [];
        for (let a = from; a <= to; a += CHUNK) {
          const b = a + CHUNK - 1n < to ? a + CHUNK - 1n : to;
          const logs = await publicClient.getContractEvents({
            address: contract,
            abi: bountyEngineAbi,
            fromBlock: a,
            toBlock: b,
          });
          // filter by bounty here: viem only filters indexed args for a single named event
          out.push(...logs.filter((l) => (l as unknown as { args?: { taskId?: bigint } }).args?.taskId === id));
        }
        return out;
      };

      const ranges: [bigint, bigint][] = [[task.createdBlock, task.createdBlock]];
      if (task.firstPaidBlock > 0n) {
        const end = task.settledBlock > 0n ? task.settledBlock : await publicClient.getBlockNumber();
        const to = end - task.firstPaidBlock > MAX_SCAN ? task.firstPaidBlock + MAX_SCAN : end;
        ranges.push([task.firstPaidBlock, to]);
      } else if (task.settledBlock > 0n) {
        ranges.push([task.settledBlock, task.settledBlock]);
      }
      const logs = (await Promise.all(ranges.map(([a, b]) => logsIn(a, b)))).flat();

      // One receipt + block per distinct transaction.
      const txs = [...new Set(logs.map((l) => l.transactionHash!))];
      const receipts = await Promise.all(txs.map((hash) => publicClient.getTransactionReceipt({ hash })));
      const blocks = await Promise.all(
        [...new Set(receipts.map((r) => r.blockNumber))].map((n) => publicClient.getBlock({ blockNumber: n })),
      );
      const feeOf = new Map(receipts.map((r) => [r.transactionHash, r.gasUsed * r.effectiveGasPrice]));
      const timeOf = new Map(blocks.map((b) => [b.number, b.timestamp]));

      const steps: ReceiptStep[] = [];
      const answers: Record<string, Hex> = {};
      for (const l of logs) {
        const base = {
          tx: l.transactionHash!,
          block: l.blockNumber!,
          timestamp: timeOf.get(l.blockNumber!) ?? 0n,
          fee: feeOf.get(l.transactionHash!) ?? 0n,
        };
        const a = (l as unknown as { args: Record<string, unknown> }).args;
        switch (l.eventName) {
          case "TaskCreated":
            steps.push({ ...base, kind: "posted", who: a.creator as `0x${string}`, amount: a.reward as bigint });
            break;
          case "AnswerRevealed":
            answers[(a.agent as string).toLowerCase()] = a.answer as Hex;
            steps.push({ ...base, kind: "revealed", who: a.agent as `0x${string}`, answer: a.answer as Hex });
            break;
          case "WinnerPaid":
            steps.push({ ...base, kind: "paid", who: a.winner as `0x${string}`, amount: a.amount as bigint });
            break;
          case "ReputationRecorded":
            steps.push({ ...base, kind: "reputation", who: a.winner as `0x${string}`, ok: a.ok as boolean });
            break;
          case "TaskClosed":
            steps.push({ ...base, kind: "closed", refunded: a.refunded as bigint });
            break;
        }
      }
      steps.sort((x, y) => (x.block === y.block ? 0 : x.block < y.block ? -1 : 1));

      const totalFees = txs.reduce((s, h) => s + (feeOf.get(h) ?? 0n), 0n);
      const posted = steps.find((s) => s.kind === "posted");
      const firstPaid = steps.find((s) => s.kind === "paid");
      return {
        task,
        submissions,
        winners,
        steps,
        answers,
        totalFees,
        timeToFirstPayout: posted && firstPaid ? firstPaid.timestamp - posted.timestamp : undefined,
      } satisfies TaskReceipt;
    })()
      .then((data) => alive && setState({ loading: false, data, error: null }))
      .catch((e: Error) => alive && setState({ loading: false, data: null, error: e.message }));

    return () => {
      alive = false;
    };
  }, [id, enabled, publicClient, contract, isContractConfigured]);

  return state;
}
