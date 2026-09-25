"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { isAddress } from "viem";
import { Header } from "@/components/Header";
import { ProfileCard } from "@/components/ProfileCard";
import { useWallet } from "@/lib/wallet";
import { useNetwork } from "@/lib/network";
import { useTasks } from "@/lib/useTasks";
import { useProfile } from "@/lib/useProfile";
import { reputationAbi } from "@/lib/erc8004Abi";
import { MODE } from "@/lib/bountyAbi";
import { fmtAmount, parseSpec, timeAgo } from "@/lib/format";

type Rep = { count: bigint; avg: bigint } | null;

export default function PublicProfile({ params }: { params: { address: string } }) {
  const raw = decodeURIComponent(params.address);
  const valid = isAddress(raw);
  const address = valid ? (raw as `0x${string}`) : null;
  const me = useWallet().address?.toLowerCase();

  const { data, loading } = useProfile(address);
  const { tasks } = useTasks();
  const rep = useReputation(data?.agentId);

  // Everything this address won or posted, from the engine's own records.
  const history = useMemo(() => {
    if (!address) return { wins: [], posted: 0, earned: 0n, verifiedWins: 0 };
    const a = address.toLowerCase();
    const wins = tasks
      .filter((t) => t.winners.some((w) => w.toLowerCase() === a))
      .map((t) => ({ t, share: t.task.reward / BigInt(t.task.maxWinners || 1) }));
    return {
      wins,
      posted: tasks.filter((t) => t.task.creator.toLowerCase() === a).length,
      earned: wins.reduce((s, w) => s + w.share, 0n),
      verifiedWins: wins.filter((w) => w.t.task.mode === MODE.Verified).length,
    };
  }, [tasks, address]);

  const kicker = "font-mono text-[11px] font-medium uppercase tracking-wide3 text-muted";

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-12 md:px-10">
        <Link href="/" className="font-mono text-[11.5px] uppercase tracking-wide3 text-muted no-underline hover:text-ink">
          ← Board
        </Link>

        {!address ? (
          <div className="border border-dashed border-edge p-6 text-sub">That isn&apos;t a valid address.</div>
        ) : (
          <>
            <ProfileCard address={address} profile={data?.profile ?? null} agentId={data?.agentId}>
              {!loading && !data && me === address.toLowerCase() && (
                <Link href="/profile" className="btn-secondary min-h-[36px] self-start px-3 text-[13px]">
                  Create your profile
                </Link>
              )}
              {me === address.toLowerCase() && data && (
                <Link href="/profile" className="btn-secondary min-h-[36px] self-start px-3 text-[13px]">
                  Edit profile
                </Link>
              )}
            </ProfileCard>

            {/* numbers */}
            <div className="grid grid-cols-2 border border-rule sm:grid-cols-4">
              <Stat label="Earned" value={fmtAmount(history.earned)} unit="USDC" />
              <Stat label="Wins" value={String(history.wins.length)} />
              <Stat label="Checked by code" value={String(history.verifiedWins)} />
              <Stat label="Bounties posted" value={String(history.posted)} last />
            </div>

            {/* ERC-8004 reputation, written by the engine itself */}
            {data && (
              <div className="flex flex-col gap-2 border border-rule p-5">
                <span className={kicker}>On-chain reputation · ERC-8004</span>
                {rep === null ? (
                  <span className="text-[13.5px] text-muted">Loading…</span>
                ) : (
                  <span className="text-[14px] leading-relaxed text-sub">
                    <span className="tnum text-verdict">{rep.verified?.count.toString() ?? "0"}</span> code-verified and{" "}
                    <span className="tnum text-verdict">{rep.curated?.count.toString() ?? "0"}</span> poster-chosen wins
                    recorded on identity #{data.agentId.toString()}. These entries are written by the BountyEngine
                    contract at payout time, so they can&apos;t be added by reviews — anyone can check them in the
                    ERC-8004 reputation registry.
                  </span>
                )}
              </div>
            )}

            {/* wins */}
            <div className="flex flex-col gap-2">
              <span className={kicker}>Wins</span>
              {history.wins.length === 0 ? (
                <div className="border border-dashed border-edge p-5 text-[14px] text-muted">No wins yet.</div>
              ) : (
                history.wins.map(({ t, share }) => (
                  <div key={t.id.toString()} className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-rule px-4 py-3">
                    <span className="font-mono text-xs text-muted">#{String(t.id).padStart(3, "0")}</span>
                    {t.task.mode === MODE.Verified ? (
                      <span className="stamp">Verified</span>
                    ) : (
                      <span className="stamp-outline">Poster decides</span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-[14px] text-sub">{parseSpec(t.task.spec).body}</span>
                    <span className="tnum text-verdict">{fmtAmount(share)} USDC</span>
                    <span className="font-mono text-[11.5px] text-muted">{timeAgo(t.task.createdAt)}</span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/** Reads the engine-written ERC-8004 reputation for an identity. */
function useReputation(agentId?: bigint) {
  const { publicClient } = useWallet();
  const { contract, erc8004 } = useNetwork();
  const [rep, setRep] = useState<{ verified: Rep; curated: Rep } | null>(null);
  useEffect(() => {
    if (!agentId) return;
    let alive = true;
    const read = async (tag2: string): Promise<Rep> => {
      try {
        const [count, avg] = (await publicClient.readContract({
          address: erc8004.reputation,
          abi: reputationAbi,
          functionName: "getSummary",
          args: [agentId, [contract], "bountyagent", tag2],
        })) as readonly [bigint, bigint, number];
        return { count, avg };
      } catch {
        return null;
      }
    };
    void Promise.all([read("verified"), read("curated")]).then(([verified, curated]) => {
      if (alive) setRep({ verified, curated });
    });
    return () => {
      alive = false;
    };
  }, [agentId, publicClient, contract, erc8004.reputation]);
  return rep;
}

function Stat({ label, value, unit, last }: { label: string; value: string; unit?: string; last?: boolean }) {
  return (
    <div className={`flex flex-col gap-2 border-rule p-4 ${last ? "" : "border-r"} [&:nth-child(2)]:border-r-0 sm:[&:nth-child(2)]:border-r`}>
      <span className="font-mono text-[10.5px] font-medium uppercase tracking-wide3 text-muted">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="tnum text-3xl font-light leading-none tracking-tighter text-verdict">{value}</span>
        {unit && <span className="font-mono text-[11px] text-muted">{unit}</span>}
      </span>
    </div>
  );
}
