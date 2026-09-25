"use client";

import { useState } from "react";
import Link from "next/link";
import { Header } from "@/components/Header";
import { LinkedText } from "@/components/LinkedText";
import { ProfileName } from "@/components/ProfileName";
import { WorkShowcase } from "@/components/WorkShowcase";
import { useWallet } from "@/lib/wallet";
import { useNetwork } from "@/lib/network";
import { useTaskReceipt, type ReceiptStep } from "@/lib/useTaskReceipt";
import { MODE, TASK_STATUS } from "@/lib/bountyAbi";
import {
  challengeLabel,
  fmtAmount,
  fmtDateTime,
  fmtDuration,
  fmtFee,
  parseSpec,
  shortAddr,
  timeUntil,
} from "@/lib/format";

export default function TaskReceiptPage({ params }: { params: { id: string } }) {
  const id = /^\d+$/.test(params.id) ? BigInt(params.id) : null;
  const { data, loading, error } = useTaskReceipt(id);
  const me = useWallet().address?.toLowerCase();
  const { addressUrl, txUrl, network } = useNetwork();

  const idPad = id !== null ? String(id).padStart(3, "0") : "—";
  const kicker = "font-mono text-[11px] font-medium uppercase tracking-wide3 text-muted";

  if (id === null || error) {
    return (
      <Shell>
        <div className="border border-dashed border-edge p-8 text-sub">
          {id === null ? "That isn't a bounty number." : error}
        </div>
      </Shell>
    );
  }
  if (loading || !data) {
    return (
      <Shell>
        <div className="flex flex-col gap-3">
          <span className="h-3 w-40 animate-shimmer bg-rule" />
          <span className="h-10 w-2/3 animate-shimmer bg-rule" />
          <span className="h-40 animate-shimmer bg-hair" />
        </div>
      </Shell>
    );
  }

  const { task, submissions, winners, steps, answers, totalFees, timeToFirstPayout } = data;
  const verified = task.mode === MODE.Verified;
  const status = TASK_STATUS[task.status];
  const { audience, body, tags } = parseSpec(task.spec);
  const maxWinners = Number(task.maxWinners);
  const share = task.reward / BigInt(maxWinners || 1);
  const won = new Set(winners.map((w) => w.toLowerCase()));
  const others = submissions.filter((s) => !won.has(s.agent.toLowerCase()));
  const feePct = task.reward > 0n ? (Number(totalFees) / Number(task.reward)) * 100 : 0;
  const now = BigInt(Math.floor(Date.now() / 1000));

  return (
    <Shell>
      {/* ── title block ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-5 border-b border-hair pb-8">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className={kicker}>Bounty #{idPad} · Receipt</span>
          {status === "Open" && (
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-wide3 text-verdict">
              <span className="h-[7px] w-[7px] animate-pulseRing rounded-full bg-verdict" /> Open
            </span>
          )}
          {status === "Completed" && <span className="stamp"><i className="ph-bold ph-check" /> Completed</span>}
          {status === "Cancelled" && <span className="stamp-outline">Cancelled</span>}
          {verified ? <span className="stamp">Verified by code</span> : <span className="stamp-outline">Poster decides</span>}
          {audience !== "anyone" && (
            <span className="inline-flex items-center gap-1 text-[12.5px] text-sub">
              <i className={`ph ${audience === "people" ? "ph-user" : "ph-robot"}`} /> For {audience}
            </span>
          )}
          {verified && challengeLabel(task.spec) && <span className="text-[12.5px] text-muted">{challengeLabel(task.spec)}</span>}
        </div>

        <div className="grid grid-cols-1 items-end gap-6 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex max-w-[760px] flex-col gap-3">
            <LinkedText text={body} previews className="text-xl leading-relaxed text-ink md:text-2xl" />
          </div>
          <div className="flex flex-col items-start gap-1 md:items-end">
            <span className="flex items-baseline gap-2">
              <span className="tnum text-6xl font-light leading-none tracking-tighter text-verdict">{fmtAmount(task.reward)}</span>
              <span className="font-mono text-xs text-muted">USDC</span>
            </span>
            {maxWinners > 1 && (
              <span className="font-mono text-[12px] text-sub">
                {maxWinners} winners × {fmtAmount(share)} · {Number(task.paidCount)} paid
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">POSTED BY <ProfileName address={task.creator} links={false} you={task.creator.toLowerCase() === me} /></span>
          <span className="inline-flex items-center gap-1.5">
            {verified ? "CHECKED BY" : "DECIDED BY"}{" "}
            {verified ? (
              <a href={addressUrl(task.verifier)} target="_blank" rel="noreferrer" className="text-ink no-underline">
                {shortAddr(task.verifier)} (contract)
              </a>
            ) : (
              <ProfileName address={task.validator} links={false} />
            )}
          </span>
          {status === "Open" && task.resolveDeadline > now && <span>CLOSES {timeUntil(task.resolveDeadline).toUpperCase()}</span>}
          <ShareButtons id={idPad} amount={fmtAmount(task.reward)} network={network} />
        </div>
      </div>

      {/* ── body: work + receipt ───────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-10 pt-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-8">
          <section className="flex flex-col gap-3">
            <span className={kicker}>{winners.length > 1 ? "The winning work" : "The work that won"}</span>
            {winners.length === 0 ? (
              <div className="border border-dashed border-edge p-6 text-[14px] text-sub">
                {status === "Open"
                  ? verified
                    ? "No valid answer yet. The first one to pass the contract's check is paid automatically."
                    : `Nobody has been chosen yet. ${submissions.length} submission${submissions.length === 1 ? "" : "s"} so far.`
                  : "Nobody won this bounty; the creator was refunded."}
                {status === "Open" && (
                  <>
                    {" "}
                    <Link href="/" className="text-verdict">Take it on from the board →</Link>
                  </>
                )}
              </div>
            ) : (
              winners.map((w, i) => {
                const sub = submissions.find((s) => s.agent.toLowerCase() === w.toLowerCase());
                return (
                  <WorkShowcase
                    key={w}
                    rank={winners.length > 1 ? i + 1 : undefined}
                    winner={w}
                    share={share}
                    verified={verified}
                    verifier={task.verifier}
                    solverTag={tags.solver}
                    submission={sub?.resultURI}
                    submittedAt={sub?.submittedAt}
                    answer={answers[w.toLowerCase()]}
                    you={w.toLowerCase() === me}
                  />
                );
              })
            )}
          </section>

          {!verified && others.length > 0 && (
            <section className="flex flex-col gap-3">
              <span className={kicker}>Other submissions · {others.length}</span>
              {others.map((s) => (
                <div key={s.agent} className="flex flex-col gap-2.5 border border-rule p-4">
                  <ProfileName address={s.agent} you={s.agent.toLowerCase() === me} />
                  <LinkedText text={s.resultURI} previews className="text-[14px] leading-relaxed text-sub" />
                </div>
              ))}
            </section>
          )}
        </div>

        {/* receipt */}
        <aside className="flex flex-col self-start border border-rule bg-[#0F0F0F] lg:sticky lg:top-24">
          <div className="flex items-center gap-2.5 border-b border-rule px-4 py-3">
            <span className={kicker}>Settlement receipt</span>
            <span className="ml-auto font-mono text-[11px] font-medium uppercase tracking-wide3 text-verdict">On-chain</span>
          </div>
          {groupByTx(steps).map((g, i) => (
            <TxGroup key={g[0].tx} n={i + 1} steps={g} verified={verified} txUrl={txUrl} />
          ))}
          <div className="flex flex-col gap-2 px-4 py-4 font-mono text-[12px] text-sub">
            <Row k="Fees for the whole bounty" v={`${fmtFee(totalFees)}${feePct > 0 ? ` · ${feePct < 0.01 ? "<0.01" : feePct.toFixed(2)}% of it` : ""}`} />
            {timeToFirstPayout !== undefined && <Row k="Posted → first payout" v={fmtDuration(timeToFirstPayout)} />}
            {verified && winners.length > 0 && <Row k="Check + payout" v="same transaction" />}
            <Row k="Final after" v="1 block" />
          </div>
        </aside>
      </div>
    </Shell>
  );
}

/** Consecutive steps from the same transaction, in order. */
function groupByTx(steps: ReceiptStep[]): ReceiptStep[][] {
  const out: ReceiptStep[][] = [];
  for (const s of steps) {
    const last = out[out.length - 1];
    if (last && last[0].tx === s.tx) last.push(s);
    else out.push([s]);
  }
  return out;
}

/** One transaction on the receipt: what happened in it, then its time, block and fee once. */
function TxGroup({
  n,
  steps,
  verified,
  txUrl,
}: {
  n: number;
  steps: ReceiptStep[];
  verified: boolean;
  txUrl: (h: string) => string;
}) {
  const s0 = steps[0];
  return (
    <div className="grid grid-cols-[26px_minmax(0,1fr)] gap-x-2.5 border-b border-hair px-4 py-3">
      <span className="pt-px font-mono text-xs font-medium text-verdict">{String(n).padStart(2, "0")}</span>
      <div className="flex min-w-0 flex-col gap-2">
        {steps.map((s, i) => (
          <StepLine key={i} step={s} verified={verified} />
        ))}
        {steps.length > 1 && (
          <span className="font-mono text-[10.5px] uppercase tracking-wide2 text-muted">
            ↳ {steps.length} steps · one transaction · all or nothing
          </span>
        )}
        <span className="flex flex-wrap gap-x-3 font-mono text-[11px] text-muted">
          <span>{fmtDateTime(s0.timestamp)}</span>
          <span>block {s0.block.toLocaleString()}</span>
          <span>fee {fmtFee(s0.fee)}</span>
          <a href={txUrl(s0.tx)} target="_blank" rel="noreferrer" className="text-ink no-underline hover:text-verdict">
            tx {s0.tx.slice(0, 8)}… ↗
          </a>
        </span>
      </div>
    </div>
  );
}

function StepLine({ step, verified }: { step: ReceiptStep; verified: boolean }) {
  const label: Record<ReceiptStep["kind"], string> = {
    posted: "POSTED",
    revealed: "REVEALED",
    paid: "PAID",
    reputation: "RECORDED",
    closed: step.refunded && step.refunded > 0n ? "REFUNDED" : "CLOSED",
  };
  let text: React.ReactNode;
  switch (step.kind) {
    case "posted":
      text = <>{fmtAmount(step.amount ?? 0n)} USDC locked in escrow by <ProfileName address={step.who!} links={false} /></>;
      break;
    case "revealed":
      text = <>Answer revealed by <ProfileName address={step.who!} links={false} /> — checked by the contract</>;
      break;
    case "paid":
      text = <>{fmtAmount(step.amount ?? 0n)} USDC to <ProfileName address={step.who!} links={false} />{verified ? ", automatically" : ""}</>;
      break;
    case "reputation":
      text = step.ok ? <>Win written to the winner&apos;s ERC-8004 reputation</> : <>Winner&apos;s profile couldn&apos;t be credited</>;
      break;
    case "closed":
      text = step.refunded && step.refunded > 0n ? <>{fmtAmount(step.refunded)} USDC unpaid, returned to the creator</> : <>All shares paid; bounty closed</>;
      break;
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-xs font-medium uppercase tracking-wide2 text-verdict">{label[step.kind]}</span>
      <span className="text-[13px] leading-snug text-sub">{text}</span>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <span className="flex items-baseline justify-between gap-3">
      <span className="text-muted">{k}</span>
      <span className="text-right text-verdict">{v}</span>
    </span>
  );
}

function ShareButtons({ id, amount, network }: { id: string; amount: string; network: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? window.location.href : "";
  const text = `Bounty #${id} on BountyAgent: ${amount} USDC, settled on Arc${network === "mainnet" ? "" : ` (${network})`}.`;
  return (
    <span className="ml-auto inline-flex items-center gap-2">
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard blocked */
          }
        }}
        className="inline-flex items-center gap-1.5 border border-rule px-2.5 py-1.5 font-mono text-[11px] font-medium uppercase text-ink hover:border-edge"
      >
        <i className={copied ? "ph ph-check" : "ph ph-link-simple"} /> {copied ? "Copied" : "Copy link"}
      </button>
      <a
        href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 border border-rule px-2.5 py-1.5 font-mono text-[11px] font-medium uppercase text-ink no-underline hover:border-edge"
      >
        <i className="ph ph-x-logo" /> Share
      </a>
    </span>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto flex max-w-6xl flex-col px-4 py-10 md:px-10">
        <Link href="/" className="mb-6 font-mono text-[11.5px] uppercase tracking-wide3 text-muted no-underline hover:text-ink">
          ← Board
        </Link>
        {children}
      </main>
    </div>
  );
}
