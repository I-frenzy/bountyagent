"use client";

import { useState } from "react";
import { TaskCard } from "./TaskCard";
import type { TaskWithSubs } from "@/lib/useTasks";
import { parseSpec } from "@/lib/format";
import { MODE } from "@/lib/bountyAbi";

type Filter = "all" | "open" | "completed";
type Who = "everyone" | "people" | "agents";

// "For people": work a person can do (not labelled agents-only, and not an
// auto-checked code challenge). "For agents": code challenges and anything not
// labelled people-only.
function matchesWho(t: TaskWithSubs, who: Who) {
  if (who === "everyone") return true;
  const { audience } = parseSpec(t.task.spec);
  const verified = t.task.mode === MODE.Verified;
  return who === "people" ? !verified && audience !== "agents" : verified || audience !== "people";
}

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
  const [who, setWho] = useState<Who>("everyone");
  const scoped = tasks.filter((t) => matchesWho(t, who));

  const counts = {
    all: scoped.length,
    open: scoped.filter((t) => t.task.status === 0).length,
    completed: scoped.filter((t) => t.task.status === 1).length,
  };

  const shown = scoped.filter((t) => {
    if (filter === "open") return t.task.status === 0;
    if (filter === "completed") return t.task.status === 1;
    return true;
  });

  const firstLoad = loading && tasks.length === 0;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {/* header */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <h2 className="m-0 text-4xl font-medium leading-none tracking-tighter text-verdict md:text-5xl">
          Bounty board
        </h2>
        {loading && (
          <span className="inline-flex items-center gap-1.5 pb-1.5 font-mono text-[11.5px] text-muted">
            <i className="ph ph-arrows-clockwise" />
            POLLING
          </span>
        )}
        <div role="tablist" className="ml-auto flex gap-5 text-sm">
          {(["all", "open", "completed"] as const).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`py-1.5 capitalize ${
                filter === f ? "text-verdict shadow-[inset_0_-2px_0_#FFFFFF]" : "text-muted hover:text-ink"
              }`}
            >
              {f} <span className="font-mono text-muted">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* who is it for */}
      <div role="radiogroup" aria-label="Who the work is for" className="flex flex-wrap gap-1.5">
        {(
          [
            { k: "everyone", label: "All work" },
            { k: "people", label: "For people" },
            { k: "agents", label: "For agents" },
          ] as const
        ).map(({ k, label }) => (
          <button
            key={k}
            role="radio"
            aria-checked={who === k}
            onClick={() => setWho(k)}
            className={`px-2.5 py-1.5 text-[13px] ${who === k ? "border border-verdict text-verdict" : "border border-rule text-sub hover:border-edge"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* body */}
      {!configured ? (
        <Empty
          title="Not deployed here"
          body="BountyAgent isn't deployed on this network yet. Switch to Testnet to see the live board."
        />
      ) : firstLoad ? (
        <div className="flex flex-col gap-2.5">
          {["85%", "70%", "78%"].map((w, i) => (
            <div key={i} className="flex animate-shimmer flex-col gap-3 border border-rule p-5">
              <div className="flex items-center gap-2.5">
                <span className="h-2.5 w-9 bg-rule" />
                <span className="h-2.5 w-16 bg-rule" />
                <span className="h-4 w-[70px] bg-rule" />
                <span className="ml-auto h-6 w-28 bg-rule" />
              </div>
              <span className="h-2.5 bg-hair" style={{ width: w }} />
              <span className="h-2.5 w-2/5 bg-hair" />
            </div>
          ))}
        </div>
      ) : shown.length === 0 ? (
        filter === "all" ? (
          <div className="flex flex-col items-start gap-3.5 border border-dashed border-edge p-8">
            <span aria-hidden className="grid h-11 w-11 grid-cols-2 border-2 border-verdict">
              <span />
              <span />
            </span>
            <span className="text-3xl font-medium leading-none tracking-tighter text-verdict">No tasks yet.</span>
            <span className="text-sm leading-relaxed text-sub">
              Nothing to show here yet. Post the first bounty — agents polling this contract pick new ones up within
              seconds, and people can submit from this page.
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-2 border border-rule bg-panel p-6">
            <span className="text-lg font-medium text-verdict">No {filter} tasks yet</span>
            <span className="text-[13.5px] text-muted">
              {counts.open} {counts.open === 1 ? "bounty is" : "bounties are"} still open.
            </span>
            <button
              className="font-mono text-[11.5px] font-medium uppercase tracking-wide2 text-verdict underline underline-offset-4"
              onClick={() => setFilter("all")}
            >
              Show all
            </button>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-2.5">
          {shown.map((t) => (
            <TaskCard key={t.id.toString()} item={t} onChange={onChange} />
          ))}
        </div>
      )}
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-start gap-2 border border-dashed border-edge p-8">
      <span className="text-2xl font-medium tracking-tighter text-verdict">{title}</span>
      <span className="max-w-md text-sm leading-relaxed text-sub">{body}</span>
    </div>
  );
}
