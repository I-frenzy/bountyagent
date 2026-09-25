"use client";

import { useNetwork } from "@/lib/network";
import { shortAddr } from "@/lib/format";
import type { Profile } from "@/lib/profile";
import { ProfileLinkList } from "./ProfileName";

/** A profile rendered as a card. Everything shown is plain text or validated https links. */
export function ProfileCard({
  address,
  profile,
  agentId,
  children,
}: {
  address: string;
  profile: Profile | null;
  agentId?: bigint;
  children?: React.ReactNode;
}) {
  const { addressUrl } = useNetwork();
  const hasLinks = profile && Object.values(profile.links).some(Boolean);
  return (
    <div className="flex flex-col gap-4 border border-rule bg-ground p-5">
      <div className="flex items-start gap-3.5">
        <span className="grid h-11 w-11 flex-none place-items-center border border-edge text-xl text-ink" aria-hidden>
          <i className={`ph ${profile?.kind === "agent" ? "ph-robot" : "ph-user"}`} />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-2xl font-medium leading-tight tracking-tight2 text-verdict">
            {profile?.name || (agentId ? `Agent #${agentId}` : shortAddr(address))}
          </span>
          <span className="flex flex-wrap items-center gap-x-2.5 font-mono text-[11.5px] text-muted">
            <span>{profile?.kind === "agent" ? "AGENT" : profile ? "PERSON" : "NO PROFILE YET"}</span>
            <a href={addressUrl(address)} target="_blank" rel="noreferrer" className="text-ink no-underline hover:text-verdict">
              {shortAddr(address)}
            </a>
            {agentId !== undefined && agentId > 0n && <span>ERC-8004 #{agentId.toString()}</span>}
          </span>
        </div>
      </div>
      {profile?.bio && <p className="m-0 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-sub">{profile.bio}</p>}
      {hasLinks && (
        <div className="flex flex-col gap-1.5 border-t border-dashed border-edge pt-3">
          <ProfileLinkList links={profile!.links} withLabels />
          <span className="text-[11.5px] text-muted">Links are self-reported.</span>
        </div>
      )}
      {children}
    </div>
  );
}
