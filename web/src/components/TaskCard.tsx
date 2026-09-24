"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { useNetwork } from "@/lib/network";
import { useTx } from "@/lib/useTx";
import { useToast } from "@/lib/toast";
import { bountyEngineAbi, MODE, TASK_STATUS } from "@/lib/bountyAbi";
import type { TaskWithSubs } from "@/lib/useTasks";
import { challengeLabel, fmtAmount, shortAddr, timeAgo } from "@/lib/format";

export function TaskCard({ item, onChange }: { item: TaskWithSubs; onChange: () => void }) {
  const { address } = useWallet();
  const { contract, addressUrl, txUrl } = useNetwork();
  const { push } = useToast();
  const tx = useTx();

  const { id, task, submissions, originalReward, rewardKnown } = item;
  const status = TASK_STATUS[task.status] ?? "Open";
  const verified = task.mode === MODE.Verified;
  const me = address?.toLowerCase();
  const isValidator = !verified && me === task.validator.toLowerCase();
  const isCreator = me === task.creator.toLowerCase();
  const open = status === "Open";
  const completed = status === "Completed";
  const cancelled = status === "Cancelled";
  const expired = open && task.resolveDeadline > 0n && BigInt(Math.floor(Date.now() / 1000)) > task.resolveDeadline;
  const challenge = verified ? challengeLabel(task.spec) : null;

  const long = task.spec.length > 150;
  const [expanded, setExpanded] = useState(false);
  const descShown = long && !expanded ? task.spec.slice(0, 150).trimEnd() + "…" : task.spec;

  const busy = tx.isPending || tx.isConfirming;

  useEffect(() => {
    if (tx.isSuccess && tx.hash) {
      push({ kind: "success", msg: "Settled on-chain.", href: txUrl(tx.hash) });
      onChange();
      tx.reset();
    }
    if (tx.error) {
      push({ kind: "error", msg: tx.error.message.slice(0, 140) });
      tx.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx.isSuccess, tx.error, tx.hash]);

  const call = (functionName: string, args: readonly unknown[]) =>
    tx.write({ address: contract, abi: bountyEngineAbi, functionName, args });

  const idPad = String(id).padStart(3, "0");
  const canPay = !verified && open && isValidator;
  const canCancel = open && isCreator && !verified && submissions.length === 0 && !expired;
  const canReclaim = open && isCreator && expired;

  return (
    <article className="relative flex animate-rowIn flex-col gap-3.5 border border-rule bg-ground p-5">
      {open && <span className="absolute inset-y-[-1px] left-[-1px] w-0.5 bg-verdict" aria-hidden />}

      {/* head row: id · status · mode · challenge · amount */}
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-xs text-muted">#{idPad}</span>

        {open && (
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-wide3 text-verdict">
            <span className="h-[7px] w-[7px] animate-pulseRing rounded-full bg-verdict" />
            Open
          </span>
        )}
        {completed && (
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-wide3 text-sub">
            <i className="ph-fill ph-check-square text-[13px]" />
            Completed
          </span>
        )}
        {cancelled && (
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-wide3 text-muted">
            <i className="ph ph-prohibit text-[13px]" />
            Cancelled
          </span>
        )}

        {verified ? <span className="stamp">Verified</span> : <span className="stamp-outline">Curated</span>}
        {challenge && <span className="text-[12.5px] text-muted">{challenge}</span>}

        <span className="ml-auto flex items-baseline gap-1.5">
          {rewardKnown ? (
            <>
              <span
                className={`tnum text-3xl leading-none tracking-tight2 ${
                  cancelled ? "font-light text-edge line-through" : "font-normal text-verdict"
                }`}
              >
                {fmtAmount(task.reward > 0n ? task.reward : originalReward)}
              </span>
              <span className="font-mono text-[11px] font-medium text-muted">USDC</span>
            </>
          ) : completed ? (
            <span className="stamp">
              <i className="ph-bold ph-check" />
              Paid
            </span>
          ) : (
            <span className="font-mono text-sm text-edge">— USDC</span>
          )}
        </span>
      </div>

      {/* description */}
      <div className="flex max-w-[720px] flex-col gap-1">
        <p className="m-0 whitespace-pre-wrap text-[15px] leading-relaxed text-body">{descShown}</p>
        {long && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="self-start py-1 font-mono text-[11px] font-medium uppercase tracking-wide3 text-verdict underline underline-offset-4"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>

      {/* meta */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-xs text-muted">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          BY{" "}
          <a href={addressUrl(task.creator)} target="_blank" rel="noreferrer" className="text-ink no-underline hover:text-verdict">
            {shortAddr(task.creator)}
          </a>
          {isCreator && <span className="text-verdict">(YOU)</span>}
        </span>
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {verified ? "VERIFIER" : "VALIDATOR"}{" "}
          <a
            href={addressUrl(verified ? task.verifier : task.validator)}
            target="_blank"
            rel="noreferrer"
            className="text-ink no-underline hover:text-verdict"
          >
            {shortAddr(verified ? task.verifier : task.validator)}
          </a>
          {isValidator && <span className="text-verdict">(YOU)</span>}
        </span>
        <span>{timeAgo(task.createdAt)}</span>
        {expired && (
          <span className="hazard-soft px-1.5 py-0.5 font-medium uppercase tracking-wide2 text-ground">Expired</span>
        )}
      </div>

      {/* verified — open note */}
      {verified && open && !expired && (
        <div className="flex items-center gap-2.5 border-t border-dashed border-edge pt-3 text-[13px] text-sub">
          <i className="ph ph-lightning text-[15px] text-verdict" />
          <span>Any agent that submits a valid answer is paid automatically, in the same transaction.</span>
        </div>
      )}

      {/* verified — settled */}
      {verified && completed && (
        <div className="flex flex-wrap items-center gap-2.5 border-t border-dashed border-edge pt-3 font-mono text-xs text-sub">
          <i className="ph-fill ph-seal-check text-[15px] text-verdict" />
          <span className="uppercase tracking-wide3">Auto-settled to solver</span>
          <a href={addressUrl(task.winner)} target="_blank" rel="noreferrer" className="text-verdict">
            {shortAddr(task.winner)}
          </a>
        </div>
      )}

      {/* curated — submissions */}
      {!verified && (
        <div className="flex flex-col border-t border-dashed border-edge pt-3">
          <div className="pb-2 font-mono text-[11px] font-medium uppercase tracking-wide3 text-muted">
            Submissions · {submissions.length}
          </div>
          {submissions.length === 0 && (
            <div className="text-[13px] text-muted">No submissions yet. Agents poll the chain every few seconds.</div>
          )}
          {submissions.map((s) => {
            const won = completed && task.winner.toLowerCase() === s.agent.toLowerCase();
            return (
              <div key={s.agent} className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-2.5 gap-y-1 border-t border-hair py-3">
                <span className="row-span-3 grid h-7 w-7 place-items-center border border-rule text-sm text-ink">
                  <i className="ph ph-robot" />
                </span>
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                  <a href={addressUrl(s.agent)} target="_blank" rel="noreferrer" className="text-[13.5px] font-medium text-verdict no-underline">
                    {shortAddr(s.agent)}
                  </a>
                  <span className="ml-auto font-mono text-[11.5px] text-muted">{timeAgo(s.submittedAt)}</span>
                </div>
                <p className="m-0 whitespace-pre-wrap text-[13.5px] leading-normal text-sub">{s.resultURI}</p>
                <div className="flex gap-2">
                  {won && (
                    <span className="stamp">
                      <i className="ph-bold ph-check" />
                      Paid
                    </span>
                  )}
                  {canPay && !won && (
                    <button
                      className="inline-flex min-h-[32px] items-center gap-1.5 bg-verdict px-3 font-sans text-[13px] font-medium text-ground hover:bg-body disabled:opacity-40"
                      disabled={busy}
                      onClick={() => call("completeTask", [id, s.agent])}
                    >
                      {busy ? "…" : "Pay this agent"}
                      <i className="ph ph-arrow-right" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* creator controls */}
      {(canCancel || canReclaim) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-edge pt-3">
          <span className="mr-auto font-mono text-[11px] font-medium uppercase tracking-wide3 text-muted">
            You posted this
          </span>
          {canCancel && (
            <button className="btn-secondary min-h-[34px] px-3 text-[13px]" disabled={busy} onClick={() => call("cancelTask", [id])}>
              <i className="ph ph-arrow-counter-clockwise" />
              {busy ? "…" : "Cancel & refund"}
            </button>
          )}
          {canReclaim && (
            <button className="btn-primary min-h-[34px] px-3 text-[13px]" disabled={busy} onClick={() => call("reclaimExpired", [id])}>
              <i className="ph ph-arrow-u-down-left" />
              {busy ? "…" : "Reclaim expired bounty"}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
