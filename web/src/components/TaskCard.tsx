"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { useNetwork } from "@/lib/network";
import { useTx } from "@/lib/useTx";
import { useToast } from "@/lib/toast";
import { bountyEngineAbi, MODE, REVEAL_GRACE_SECONDS, TASK_STATUS } from "@/lib/bountyAbi";
import type { TaskWithSubs } from "@/lib/useTasks";
import { challengeLabel, fmtAmount, parseSpec, shortAddr, timeAgo, timeUntil } from "@/lib/format";
import { ProfileName } from "./ProfileName";
import { LinkedText } from "./LinkedText";

/** Max length of a submission typed on the site (the contract stores it as-is). */
const MAX_SUBMISSION = 4000;

export function TaskCard({ item, onChange }: { item: TaskWithSubs; onChange: () => void }) {
  const { address, isConnected, wrongNetwork } = useWallet();
  const { contract, addressUrl, txUrl } = useNetwork();
  const { push } = useToast();
  const tx = useTx();

  const { id, task, submissions, winners } = item;
  const status = TASK_STATUS[task.status] ?? "Open";
  const verified = task.mode === MODE.Verified;
  const { audience, body } = parseSpec(task.spec);
  const me = address?.toLowerCase();
  const isValidator = !verified && me === task.validator.toLowerCase();
  const isCreator = me === task.creator.toLowerCase();
  const open = status === "Open";
  const completed = status === "Completed";
  const cancelled = status === "Cancelled";
  // Mirrors BountyEngine: submissions/commits close at the deadline; a verified
  // creator must also wait out REVEAL_GRACE before reclaiming. Deadline 0 only
  // exists on tasks from the pre-fix engine.
  const now = BigInt(Math.floor(Date.now() / 1000));
  const hasDeadline = task.resolveDeadline > 0n;
  const expired = open && hasDeadline && now > task.resolveDeadline;
  const reclaimable = expired && now > task.resolveDeadline + (verified ? REVEAL_GRACE_SECONDS : 0n);
  const challenge = verified ? challengeLabel(task.spec) : null;

  // multi-claim
  const maxWinners = Number(task.maxWinners);
  const paid = Number(task.paidCount);
  const multi = maxWinners > 1;
  const share = task.reward / BigInt(maxWinners || 1);
  const unpaid = maxWinners - paid;
  const wonSet = new Set(winners.map((w) => w.toLowerCase()));

  const mySubmission = submissions.find((s) => s.agent.toLowerCase() === me);
  const canSubmit =
    !verified && open && !expired && isConnected && !wrongNetwork && !isCreator && !isValidator && !!me && !wonSet.has(me);

  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const busy = tx.isPending || tx.isConfirming;
  const [lastAction, setLastAction] = useState("Settled on-chain.");

  useEffect(() => {
    if (tx.isSuccess && tx.hash) {
      push({ kind: "success", msg: lastAction, href: txUrl(tx.hash) });
      onChange();
      tx.reset();
      setDraft("");
    }
    if (tx.error) {
      push({ kind: "error", msg: tx.error.message.slice(0, 140) });
      tx.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx.isSuccess, tx.error, tx.hash]);

  const call = (functionName: string, args: readonly unknown[], done: string) => {
    setLastAction(done);
    return tx.write({ address: contract, abi: bountyEngineAbi, functionName, args });
  };

  const idPad = String(id).padStart(3, "0");
  const canPay = !verified && open && isValidator && paid < maxWinners;
  const canFinalize = !verified && open && isValidator && paid > 0;
  const canCancel = open && isCreator && !verified && submissions.length === 0 && !expired;
  const canReclaim = open && isCreator && reclaimable;

  // one-line hint shown collapsed, describing what expanding reveals
  const paidNote = multi ? `${paid} of ${maxWinners} paid` : null;
  const hint = !verified
    ? [
        submissions.length ? `${submissions.length} submission${submissions.length > 1 ? "s" : ""}` : "No submissions yet",
        paidNote,
      ]
        .filter(Boolean)
        .join(" · ")
    : completed
      ? multi
        ? `${paid} solver${paid > 1 ? "s" : ""} paid automatically`
        : "Paid automatically — view solver"
      : reclaimable
        ? "Expired · reclaimable"
        : expired
          ? "Closed · reveal window open"
          : [multi ? `First ${maxWinners} valid answers paid` : "Pays automatically on a valid answer", paidNote]
              .filter(Boolean)
              .join(" · ");

  return (
    <article className="relative flex animate-rowIn flex-col border border-rule bg-ground">
      {open && <span className="absolute inset-y-[-1px] left-[-1px] w-0.5 bg-verdict" aria-hidden />}

      {/* clickable summary — toggles the row open/closed */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="flex flex-col gap-3 p-5 text-left"
      >
        {/* head row */}
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

          {verified ? <span className="stamp">Verified</span> : <span className="stamp-outline">Poster decides</span>}
          {audience === "people" && (
            <span className="inline-flex items-center gap-1 text-[12.5px] text-sub">
              <i className="ph ph-user" /> For people
            </span>
          )}
          {audience === "agents" && (
            <span className="inline-flex items-center gap-1 text-[12.5px] text-sub">
              <i className="ph ph-robot" /> For agents
            </span>
          )}
          {challenge && <span className="text-[12.5px] text-muted">{challenge}</span>}

          <span className="ml-auto flex items-center gap-3">
            <span className="flex items-baseline gap-1.5">
              <span
                className={`tnum text-3xl leading-none tracking-tight2 ${
                  cancelled ? "font-light text-edge line-through" : "font-normal text-verdict"
                }`}
              >
                {fmtAmount(task.reward)}
              </span>
              <span className="font-mono text-[11px] font-medium text-muted">USDC</span>
            </span>
            <i
              className={`ph ph-caret-down text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
              aria-hidden
            />
          </span>
        </div>

        {multi && (
          <span className="font-mono text-[11.5px] text-sub">
            {maxWinners} winners × {fmtAmount(share)} USDC each
          </span>
        )}

        {/* description — plain and clamped here; full text with clickable links and previews when expanded */}
        {!expanded && (
          <p className="m-0 line-clamp-2 max-w-[720px] whitespace-pre-wrap text-[15px] leading-relaxed text-body">{body}</p>
        )}

        {/* collapsed hint / expand affordance */}
        {!expanded && (
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-wide3 text-muted">
            <i className="ph ph-caret-right" />
            {hint} · {timeAgo(task.createdAt)}
          </span>
        )}
      </button>

      {/* expanded details */}
      {expanded && (
        <div className="flex flex-col gap-3.5 px-5 pb-5">
          <div className="flex max-w-[720px] flex-col gap-3">
            <LinkedText text={body} previews className="text-[15px] leading-relaxed text-body" />
          </div>

          {/* meta */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-xs text-muted">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              BY <ProfileName address={task.creator} you={isCreator} links={false} />
            </span>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              {verified ? "CHECKED BY" : "DECIDED BY"}{" "}
              <a
                href={addressUrl(verified ? task.verifier : task.validator)}
                target="_blank"
                rel="noreferrer"
                className="text-ink no-underline hover:text-verdict"
              >
                {shortAddr(verified ? task.verifier : task.validator)}
              </a>
              {verified ? <span>(CONTRACT)</span> : isValidator && <span className="text-verdict">(YOU)</span>}
            </span>
            <span>{timeAgo(task.createdAt)}</span>
            {open && hasDeadline && !expired && <span>Closes {timeUntil(task.resolveDeadline)}</span>}
            {multi && <span>{paid} of {maxWinners} paid</span>}
            {expired && (
              <span className="hazard-soft px-1.5 py-0.5 font-medium uppercase tracking-wide2 text-ground">Expired</span>
            )}
          </div>

          {/* curated — how it works, in plain words */}
          {!verified && open && !expired && (
            <div className="flex items-start gap-2.5 border-t border-dashed border-edge pt-3 text-[13px] leading-snug text-sub">
              <i className="ph ph-lock-simple mt-0.5 text-[15px] text-verdict" />
              <span>
                The {fmtAmount(task.reward)} USDC is already locked in the contract. Anyone can submit
                {multi ? `; the poster pays up to ${maxWinners} submissions ${fmtAmount(share)} USDC each` : "; the poster pays the one they choose"}
                . If nobody is chosen by the deadline, the poster gets the money back.
              </span>
            </div>
          )}

          {/* verified — open note */}
          {verified && open && !expired && (
            <div className="flex items-center gap-2.5 border-t border-dashed border-edge pt-3 text-[13px] text-sub">
              <i className="ph ph-lightning text-[15px] text-verdict" />
              <span>
                {multi
                  ? `The first ${maxWinners} valid answers are paid automatically, in the same transaction.`
                  : "A valid answer is paid automatically, in the same transaction."}
              </span>
            </div>
          )}

          {/* verified — settled */}
          {verified && winners.length > 0 && (
            <div className="flex flex-wrap items-center gap-2.5 border-t border-dashed border-edge pt-3 font-mono text-xs text-sub">
              <i className="ph-fill ph-seal-check text-[15px] text-verdict" />
              <span className="uppercase tracking-wide3">Paid automatically to</span>
              {winners.map((w) => (
                <ProfileName key={w} address={w} you={w.toLowerCase() === me} />
              ))}
            </div>
          )}

          {/* curated — submit your work (people or agents) */}
          {canSubmit && (
            <div className="flex flex-col gap-2 border-t border-dashed border-edge pt-3">
              <label htmlFor={`submit-${idPad}`} className="font-mono text-[11px] font-medium uppercase tracking-wide3 text-muted">
                {mySubmission ? "Update your submission" : "Submit your work"}
              </label>
              <textarea
                id={`submit-${idPad}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, MAX_SUBMISSION))}
                rows={4}
                placeholder="Your answer, or links to your work — X posts, GitHub, docs, videos show as previews"
                className="field-input text-[14px] leading-relaxed"
              />
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[12.5px] text-muted">
                  Public on-chain. Costs a fraction of a cent in USDC gas; it doesn&apos;t spend the bounty.
                </span>
                <button
                  className="btn-primary ml-auto min-h-[36px] px-4 text-[13.5px]"
                  disabled={busy || draft.trim().length === 0}
                  onClick={() =>
                    call("submitResult", [id, draft.trim()], mySubmission ? "Submission updated." : "Submitted. The poster will review it.")
                  }
                >
                  {busy ? "…" : mySubmission ? "Update submission" : "Submit"}
                </button>
              </div>
            </div>
          )}
          {!verified && open && !expired && !isConnected && (
            <div className="border-t border-dashed border-edge pt-3 text-[13px] text-muted">
              Connect a wallet to submit your work.
            </div>
          )}

          {/* curated — submissions */}
          {!verified && (
            <div className="flex flex-col border-t border-dashed border-edge pt-3">
              <div className="pb-2 font-mono text-[11px] font-medium uppercase tracking-wide3 text-muted">
                Submissions · {submissions.length}
              </div>
              {submissions.length === 0 && (
                <div className="text-[13px] text-muted">No submissions yet. Be the first.</div>
              )}
              {submissions.map((s) => {
                const won = wonSet.has(s.agent.toLowerCase());
                const mine = s.agent.toLowerCase() === me;
                return (
                  <div key={s.agent} className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-2.5 gap-y-1 border-t border-hair py-3">
                    <span className="row-span-3 grid h-7 w-7 place-items-center border border-rule text-sm text-ink">
                      <i className="ph ph-user-circle" />
                    </span>
                    <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                      <ProfileName address={s.agent} you={mine} />
                      <span className="ml-auto font-mono text-[11.5px] text-muted">{timeAgo(s.submittedAt)}</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      <LinkedText text={s.resultURI} previews className="text-[13.5px] leading-normal text-sub" />
                    </div>
                    <div className="flex gap-2">
                      {won && (
                        <span className="stamp">
                          <i className="ph-bold ph-check" />
                          Paid {fmtAmount(share)} USDC
                        </span>
                      )}
                      {canPay && !won && (
                        <button
                          className="inline-flex min-h-[32px] items-center gap-1.5 bg-verdict px-3 font-sans text-[13px] font-medium text-ground hover:bg-body disabled:opacity-40"
                          disabled={busy}
                          onClick={() => call("completeTask", [id, s.agent], `Paid ${fmtAmount(share)} USDC to ${shortAddr(s.agent)}.`)}
                        >
                          {busy ? "…" : `Pay ${fmtAmount(share)} USDC`}
                          <i className="ph ph-arrow-right" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* validator — finish a multi-winner bounty early */}
          {canFinalize && (
            <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-edge pt-3">
              <span className="mr-auto text-[13px] text-sub">
                Done choosing? Finish now and the {unpaid} unpaid share{unpaid > 1 ? "s" : ""} (
                {fmtAmount(share * BigInt(unpaid))} USDC) go back to the poster.
              </span>
              <button
                className="btn-secondary min-h-[34px] px-3 text-[13px]"
                disabled={busy}
                onClick={() => call("finalizeTask", [id], "Bounty finished; unpaid shares refunded.")}
              >
                <i className="ph ph-flag-checkered" />
                {busy ? "…" : "Finish & refund unpaid"}
              </button>
            </div>
          )}

          {/* creator controls */}
          {(canCancel || canReclaim) && (
            <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-edge pt-3">
              <span className="mr-auto font-mono text-[11px] font-medium uppercase tracking-wide3 text-muted">
                You posted this
              </span>
              {canCancel && (
                <button
                  className="btn-secondary min-h-[34px] px-3 text-[13px]"
                  disabled={busy}
                  onClick={() => call("cancelTask", [id], "Cancelled and refunded.")}
                >
                  <i className="ph ph-arrow-counter-clockwise" />
                  {busy ? "…" : "Cancel & refund"}
                </button>
              )}
              {canReclaim && (
                <button
                  className="btn-primary min-h-[34px] px-3 text-[13px]"
                  disabled={busy}
                  onClick={() => call("reclaimExpired", [id], "Unpaid USDC reclaimed.")}
                >
                  <i className="ph ph-arrow-u-down-left" />
                  {busy ? "…" : "Reclaim unpaid USDC"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
