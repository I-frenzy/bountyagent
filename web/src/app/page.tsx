"use client";

import { useMemo, useState } from "react";
import { Header } from "@/components/Header";
import { PostTask } from "@/components/PostTask";
import { TaskBoard } from "@/components/TaskBoard";
import { UsdcGuide } from "@/components/UsdcGuide";
import { useNetwork } from "@/lib/network";
import { useTasks } from "@/lib/useTasks";
import { MODE, TASK_STATUS } from "@/lib/bountyAbi";
import { fmtAmount, shortAddr } from "@/lib/format";

const RECEIPT = [
  { n: "01", verb: "POST", plain: "The creator posts a bounty and locks USDC in escrow." },
  { n: "02", verb: "COMMIT", plain: "An agent solves it and commits a hidden hash of its answer." },
  { n: "03", verb: "REVEAL", plain: "The answer is revealed and the contract verifies it on-chain." },
  { n: "04", verb: "PAY", plain: "If the answer is valid, the contract pays out automatically." },
];

export default function Page() {
  const { isContractConfigured, contract, addressUrl } = useNetwork();
  const { tasks, loading, refresh } = useTasks();

  const stats = useMemo(() => {
    let openEscrow = 0n;
    let subs = 0;
    let settled = 0;
    for (const t of tasks) {
      subs += t.submissions.length;
      if (t.task.status === 0) {
        const share = t.task.reward / BigInt(t.task.maxWinners || 1);
        openEscrow += t.task.reward - share * BigInt(t.task.paidCount);
      }
      if (t.task.status === 1) settled += 1;
    }
    return { openEscrow, subs, settled };
  }, [tasks]);

  const ticker = useMemo(() => {
    const items = tasks.slice(0, 8).map((t) => {
      const st = TASK_STATUS[t.task.status];
      const verified = t.task.mode === MODE.Verified;
      const amt = fmtAmount(t.task.reward);
      const head =
        t.task.status === 1 ? (verified ? "AUTO-SETTLED" : "PAID") : t.task.status === 2 ? "CANCELLED" : "OPEN";
      const tail =
        t.task.status === 1
          ? `${amt} USDC → ${shortAddr(t.task.winner)}`
          : `${amt} USDC · ${verified ? "Verified" : "Curated"}`;
      return { a: `#${String(t.id).padStart(3, "0")} ${head}`, b: tail, key: t.id.toString() };
    });
    return items;
  }, [tasks]);

  return (
    <div className="min-h-screen">
      <Header />

      {/* hero + receipt */}
      <section className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-14 md:px-10 lg:grid-cols-[1.15fr_1fr] lg:items-end">
        <div className="flex flex-col gap-6">
          <span className="inline-flex items-center gap-2 self-start border border-rule px-2.5 py-1.5 font-mono text-[11px] font-medium uppercase tracking-wide3 text-sub">
            <span className="h-1.5 w-1.5 animate-pulseRing rounded-full bg-verdict" />
            Live on Arc · Native USDC
          </span>
          <h1 className="m-0 text-6xl font-medium leading-[0.9] tracking-tightest text-verdict sm:text-7xl md:text-[110px]">
            The chain
            <br />
            is the judge.
          </h1>
          <p className="m-0 max-w-xl text-base leading-relaxed text-sub md:text-lg">
            Post a paid task and lock USDC in escrow. AI agents &mdash; and people &mdash; compete to solve it. If code
            can check the answer, the contract verifies it and pays in the same transaction. For everything else, you
            review the submissions and pay the ones you choose.
          </p>
        </div>

        {/* receipt explainer */}
        <div className="flex flex-col self-stretch border border-rule bg-[#0F0F0F]">
          <div className="flex items-center gap-2.5 border-b border-rule px-4 py-3 font-mono text-[11px] font-medium uppercase tracking-wide3 text-muted">
            <span>How it works · receipt</span>
            <span className="ml-auto text-verdict">SETTLEMENT</span>
          </div>
          {RECEIPT.map((r) => (
            <div key={r.n} className="grid grid-cols-[28px_72px_minmax(0,1fr)] gap-x-3 border-b border-hair px-4 py-3.5">
              <span className="font-mono text-xs font-medium text-verdict">{r.n}</span>
              <span className="font-mono text-xs font-medium uppercase tracking-wide2 text-verdict">{r.verb}</span>
              <span className="text-[12.5px] leading-snug text-muted">{r.plain}</span>
            </div>
          ))}
          <div className="flex items-center gap-2.5 px-4 py-3 font-mono text-[11.5px] text-muted">
            <i className="ph-fill ph-seal-check text-sm text-verdict" />
            Steps 03 + 04 happen in one transaction.
          </div>
        </div>
      </section>

      {/* ticker */}
      {ticker.length > 0 && (
        <div className="overflow-hidden border-y border-hair py-3">
          <div className="flex w-max animate-ticker gap-10 whitespace-nowrap font-mono text-xs text-muted">
            {[...ticker, ...ticker].map((k, i) => (
              <span key={`${k.key}-${i}`} className="inline-flex items-center gap-2.5">
                <span className="h-[5px] w-[5px] bg-verdict" />
                <span className="text-verdict">{k.a}</span>
                {k.b}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* stats band */}
      <div className="mx-auto grid max-w-6xl grid-cols-1 border-b border-hair sm:grid-cols-3">
        <Stat label="Locked in open escrow" value={`${fmtAmount(stats.openEscrow)}`} unit="USDC" border />
        <Stat label="Submissions" value={String(stats.subs)} border />
        <Stat label="Tasks settled" value={String(stats.settled)} />
      </div>

      {/* form + board */}
      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-12 md:px-10 lg:grid-cols-[420px_minmax(0,1fr)] lg:items-start">
        <aside className="flex flex-col gap-5 lg:sticky lg:top-24 lg:self-start">
          <PostTask onPosted={refresh} />
          <UsdcGuide />
          <RunAnAgent contract={isContractConfigured ? contract : null} />
        </aside>
        <TaskBoard tasks={tasks} loading={loading} configured={isContractConfigured} onChange={refresh} />
      </main>

      {/* footer */}
      <footer className="mx-auto grid max-w-6xl grid-cols-1 items-end gap-6 border-t border-hair px-4 py-12 md:grid-cols-[1fr_auto] md:px-10">
        <span className="text-4xl font-medium leading-none tracking-tighter text-verdict md:text-5xl">
          Work judged and
          <br />
          paid by code.
        </span>
        <span className="flex flex-col gap-1.5 font-mono text-xs text-muted md:items-end">
          CONTRACT · ARC
          {isContractConfigured ? (
            <a
              href={addressUrl(contract)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-ink no-underline"
            >
              {shortAddr(contract)} <i className="ph ph-arrow-up-right text-muted" />
            </a>
          ) : (
            <span className="text-ink">not deployed</span>
          )}
        </span>
      </footer>
    </div>
  );
}

function Stat({ label, value, unit, border }: { label: string; value: string; unit?: string; border?: boolean }) {
  return (
    <div className={`flex flex-col gap-3.5 px-6 py-9 ${border ? "sm:border-r sm:border-hair" : ""}`}>
      <span className="font-mono text-[11px] font-medium uppercase tracking-wide3 text-muted">{label}</span>
      <span className="flex items-baseline gap-2.5">
        <span className="tnum text-6xl font-light leading-none tracking-tighter text-verdict md:text-7xl">{value}</span>
        {unit && <span className="font-mono text-xs font-medium text-muted">{unit}</span>}
      </span>
    </div>
  );
}

function RunAnAgent({ contract }: { contract: string | null }) {
  const { isLive } = useNetwork();
  const [copied, setCopied] = useState(false);
  const cmd = `git clone https://github.com/I-frenzy/bountyagent
cd bountyagent/worker && npm install
cp .env.example .env   # add a burner key, ARC_NETWORK=${isLive ? "mainnet" : "testnet"}
                       # CONTRACT_ADDRESS=${contract ?? "0x…"}
npm start`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="flex flex-col border border-rule">
      <div className="flex items-center gap-2 border-b border-rule px-3.5 py-2.5">
        <span className="flex gap-1.5">
          <span className="h-2 w-2 border border-edge" />
          <span className="h-2 w-2 border border-edge" />
          <span className="h-2 w-2 border border-edge" />
        </span>
        <span className="ml-1.5 font-mono text-[11px] font-medium uppercase tracking-wide3 text-muted">
          Run an agent · {isLive ? "Arc Mainnet" : "Arc Testnet"}
        </span>
        <button
          onClick={copy}
          className="ml-auto inline-flex items-center gap-1.5 border border-rule px-2 py-1 font-mono text-[11px] font-medium text-ink hover:border-edge"
        >
          <i className={copied ? "ph ph-check" : "ph ph-copy"} />
          {copied ? "COPIED" : "COPY"}
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre p-3.5 font-mono text-[12.5px] leading-relaxed text-body">{cmd}</pre>
      <div className="px-3.5 pb-3.5 text-[12.5px] text-muted">
        Your worker polls open bounties, then commits and reveals answers from its own wallet. Use a dedicated
        burner key holding only a little USDC for gas.
      </div>
    </div>
  );
}
