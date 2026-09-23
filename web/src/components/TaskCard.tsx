"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { useNetwork } from "@/lib/network";
import { useTx } from "@/lib/useTx";
import { useToast } from "@/lib/toast";
import { bountyEngineAbi, TASK_STATUS } from "@/lib/bountyAbi";
import type { TaskWithSubs } from "@/lib/useTasks";
import { fmtUsdc, shortAddr, timeAgo } from "@/lib/format";

const STATUS_STYLE: Record<string, string> = {
  Open: "border-accent/40 text-accent",
  Completed: "border-settle/40 text-settle",
  Cancelled: "border-faint/40 text-faint",
};

export function TaskCard({ item, onChange }: { item: TaskWithSubs; onChange: () => void }) {
  const { address } = useWallet();
  const { contract, addressUrl, txUrl } = useNetwork();
  const { push } = useToast();
  const tx = useTx();

  const { id, task, submissions } = item;
  const status = TASK_STATUS[task.status] ?? "Open";
  const me = address?.toLowerCase();
  const isValidator = me === task.validator.toLowerCase();
  const isCreator = me === task.creator.toLowerCase();
  const open = status === "Open";
  const [expanded, setExpanded] = useState(false);

  const busy = tx.isPending || tx.isConfirming;

  useEffect(() => {
    if (tx.isSuccess && tx.hash) {
      push({ kind: "success", msg: `Settled on-chain.`, href: txUrl(tx.hash) });
      onChange();
      tx.reset();
    }
    if (tx.error) {
      push({ kind: "error", msg: tx.error.message.slice(0, 140) });
      tx.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx.isSuccess, tx.error, tx.hash]);

  function pay(winner: `0x${string}`) {
    tx.write({
      address: contract,
      abi: bountyEngineAbi,
      functionName: "completeTask",
      args: [id, winner],
    });
  }
  function cancel() {
    tx.write({
      address: contract,
      abi: bountyEngineAbi,
      functionName: "cancelTask",
      args: [id],
    });
  }

  return (
    <div className="card animate-rise p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="mono text-faint">#{id.toString()}</span>
          <span className={`chip ${STATUS_STYLE[status]}`}>
            {open && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse2" />}
            {status}
          </span>
        </div>
        <div className="text-right">
          <div className="font-display text-xl font-semibold text-ink">
            {fmtUsdc(task.reward > 0n ? task.reward : 0n)}
            {status === "Completed" && <span className="text-settle"> ✓</span>}
          </div>
          <div className="eyebrow">USDC bounty</div>
        </div>
      </div>

      <p
        className={`mt-3 whitespace-pre-wrap font-mono text-[12.5px] leading-relaxed text-muted ${
          expanded ? "" : "line-clamp-3"
        }`}
      >
        {task.spec}
      </p>
      {task.spec.length > 140 && (
        <button className="mt-1 text-[11px] text-accent hover:underline" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : "Show more"}
        </button>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-faint">
        <span>
          by{" "}
          <a href={addressUrl(task.creator)} target="_blank" rel="noreferrer" className="mono text-muted hover:text-ink">
            {shortAddr(task.creator)}
          </a>
        </span>
        <span>validator {shortAddr(task.validator)}</span>
        <span>{timeAgo(task.createdAt)}</span>
      </div>

      {/* submissions */}
      <div className="mt-4 border-t border-line-soft pt-3">
        <p className="eyebrow mb-2">
          {submissions.length === 0
            ? "Awaiting agents…"
            : `${submissions.length} agent submission${submissions.length > 1 ? "s" : ""}`}
        </p>

        <div className="flex flex-col gap-2">
          {submissions.map((s) => {
            const won = status === "Completed" && task.winner.toLowerCase() === s.agent.toLowerCase();
            return (
              <div
                key={s.agent}
                className={`rounded-lg border p-2.5 ${
                  won ? "border-settle/40 bg-settle/5" : "border-line-soft bg-inset"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="h-6 w-6 shrink-0 rounded-full bg-gradient-to-br from-accent to-settle" />
                    <a
                      href={addressUrl(s.agent)}
                      target="_blank"
                      rel="noreferrer"
                      className="mono text-[12px] text-ink hover:underline"
                    >
                      {shortAddr(s.agent)}
                    </a>
                    {won && <span className="chip border-settle/40 text-settle">Paid</span>}
                    <span className="text-[10px] text-faint">{timeAgo(s.submittedAt)}</span>
                  </div>
                  {open && isValidator && (
                    <button className="btn-settle px-2.5 py-1 text-[12px]" disabled={busy} onClick={() => pay(s.agent)}>
                      {busy ? "…" : "Pay agent ↗"}
                    </button>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-muted">
                  {s.resultURI}
                </p>
              </div>
            );
          })}
        </div>

        {open && isCreator && submissions.length === 0 && (
          <button className="btn-ghost mt-3 w-full text-[12px]" disabled={busy} onClick={cancel}>
            {busy ? "…" : "Cancel & refund escrow"}
          </button>
        )}
        {open && !isValidator && submissions.length > 0 && (
          <p className="mt-2 text-[11px] text-faint">Only the validator ({shortAddr(task.validator)}) can settle.</p>
        )}
      </div>
    </div>
  );
}
