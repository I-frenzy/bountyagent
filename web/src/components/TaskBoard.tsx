"use client";

import { useMemo, useState } from "react";
import { TaskCard } from "./TaskCard";
import type { TaskWithSubs } from "@/lib/useTasks";
import { fmtUsdc } from "@/lib/format";

type Filter = "all" | "open" | "completed";

export function TaskBoard({
  tasks,
  loading,
  configured,
  onChange,
}: {
  tasks: TaskWithSubs[];
  loading: boolean;
  configured: boolean;
  onChange: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const stats = useMemo(() => {
    let openEscrow = 0n;
    let subs = 0;
    let completed = 0;
    for (const t of tasks) {
      subs += t.submissions.length;
      if (t.task.status === 0) openEscrow += t.task.reward;
      if (t.task.status === 1) completed += 1;
    }
    return { openEscrow, subs, completed };
  }, [tasks]);

  const shown = tasks.filter((t) => {
    if (filter === "open") return t.task.status === 0;
    if (filter === "completed") return t.task.status === 1;
    return true;
  });

  return (
    <div>
      {/* stats strip */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Open escrow" value={`${fmtUsdc(stats.openEscrow)} USDC`} accent />
        <Stat label="Agent submissions" value={String(stats.subs)} />
        <Stat label="Tasks settled" value={String(stats.completed)} settle />
      </div>

      <div className="mb-3 flex items-center justify-between">
        <div className="inline-flex rounded-lg border border-line bg-inset p-0.5 text-[12px]">
          {(["all", "open", "completed"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1 font-medium capitalize transition ${
                filter === f ? "bg-elevated text-ink" : "text-faint hover:text-muted"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        {loading && <span className="eyebrow animate-pulse2">syncing…</span>}
      </div>

      {!configured ? (
        <Empty msg="No BountyEngine deployed on this network yet. Switch network or deploy the contract." />
      ) : shown.length === 0 ? (
        <Empty msg={loading ? "Loading tasks…" : "No tasks yet. Post the first bounty →"} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {shown.map((t) => (
            <TaskCard key={t.id.toString()} item={t} onChange={onChange} />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  settle,
}: {
  label: string;
  value: string;
  accent?: boolean;
  settle?: boolean;
}) {
  return (
    <div className="card p-3.5">
      <p className="eyebrow">{label}</p>
      <p
        className={`mt-1 font-display text-lg font-semibold ${
          accent ? "text-accent" : settle ? "text-settle" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="card grid place-items-center p-10 text-center text-sm text-faint">{msg}</div>
  );
}
