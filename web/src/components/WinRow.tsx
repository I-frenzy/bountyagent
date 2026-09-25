"use client";

import { useState } from "react";
import Link from "next/link";
import type { TaskWithSubs } from "@/lib/useTasks";
import { useTaskReceipt } from "@/lib/useTaskReceipt";
import { MODE } from "@/lib/bountyAbi";
import { fmtAmount, fmtDuration, fmtFee, parseSpec, timeAgo } from "@/lib/format";
import { LinkedText } from "./LinkedText";
import { WorkShowcase } from "./WorkShowcase";

/**
 * One win on a profile. Collapsed: the bounty, the payout, when. Expanded: the
 * brief, the work this person did (their submission, or the answer the contract
 * checked), and the key receipt numbers — with a link to the full receipt.
 */
export function WinRow({ item, address, you }: { item: TaskWithSubs; address: `0x${string}`; you?: boolean }) {
  const [open, setOpen] = useState(false);
  const { id, task, submissions } = item;
  const verified = task.mode === MODE.Verified;
  const share = task.reward / BigInt(task.maxWinners || 1);
  const { body, tags } = parseSpec(task.spec);
  const sub = submissions.find((s) => s.agent.toLowerCase() === address.toLowerCase());
  // The on-chain receipt (answers, fees, timing) is only fetched once opened.
  const { data: receipt } = useTaskReceipt(id, open);
  const idPad = String(id).padStart(3, "0");

  return (
    <div className={`flex flex-col border ${open ? "border-edge" : "border-rule"} bg-ground`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-panel"
      >
        <span className="font-mono text-xs text-muted">#{idPad}</span>
        {verified ? <span className="stamp">Verified</span> : <span className="stamp-outline">Poster decides</span>}
        <span className="min-w-0 flex-1 truncate text-[14px] text-sub">{body}</span>
        <span className="tnum text-verdict">+{fmtAmount(share)} USDC</span>
        <span className="font-mono text-[11.5px] text-muted">{timeAgo(task.createdAt)}</span>
        <i className={`ph ph-caret-down text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-hair px-4 pb-5 pt-4">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] font-medium uppercase tracking-wide3 text-muted">The brief</span>
            <LinkedText text={body} previews className="text-[14.5px] leading-relaxed text-body" />
          </div>

          <WorkShowcase
            winner={address}
            share={share}
            verified={verified}
            verifier={task.verifier}
            solverTag={tags.solver}
            submission={sub?.resultURI}
            submittedAt={sub?.submittedAt}
            answer={receipt?.answers[address.toLowerCase()]}
            you={you}
          />

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11.5px] text-muted">
            {receipt ? (
              <>
                {receipt.timeToFirstPayout !== undefined && (
                  <span>
                    POSTED → PAID <span className="text-verdict">{fmtDuration(receipt.timeToFirstPayout)}</span>
                  </span>
                )}
                <span>
                  FEES <span className="text-verdict">{fmtFee(receipt.totalFees)}</span>
                </span>
                <span>
                  {receipt.steps.length} ON-CHAIN STEPS
                </span>
              </>
            ) : (
              <span>Loading receipt…</span>
            )}
            <Link href={`/task/${id}`} className="ml-auto text-ink no-underline hover:text-verdict">
              VIEW FULL RECEIPT →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
