"use client";

import Link from "next/link";
import { useProfile } from "@/lib/useProfile";
import { linkLabel, type ProfileLinks } from "@/lib/profile";
import { shortAddr } from "@/lib/format";

const LINK_ICONS: Record<keyof ProfileLinks, string> = {
  x: "ph ph-x-logo",
  web: "ph ph-globe-simple",
  github: "ph ph-github-logo",
  farcaster: "ph ph-chat-circle-text",
};
const LINK_ORDER: (keyof ProfileLinks)[] = ["x", "web", "github", "farcaster"];
const LINK_NAMES: Record<keyof ProfileLinks, string> = { x: "X", web: "Website", github: "GitHub", farcaster: "Farcaster" };

/** External profile links. User-supplied, so: https only (validated on read), and nofollow/ugc. */
export function ProfileLinkList({ links, withLabels = false }: { links: ProfileLinks; withLabels?: boolean }) {
  const items = LINK_ORDER.filter((k) => links[k]);
  if (items.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((k) => (
        <a
          key={k}
          href={links[k]}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          title={`${LINK_NAMES[k]}: ${linkLabel(k, links[k]!)}`}
          aria-label={`${LINK_NAMES[k]}: ${linkLabel(k, links[k]!)}`}
          className="inline-flex items-center gap-1 text-muted no-underline hover:text-verdict"
          onClick={(e) => e.stopPropagation()}
        >
          <i className={`${LINK_ICONS[k]} text-[14px]`} aria-hidden />
          {withLabels && <span className="text-[13px]">{linkLabel(k, links[k]!)}</span>}
        </a>
      ))}
    </span>
  );
}

/**
 * An address shown as its profile: name (or short address), a person/agent
 * glyph, and link icons. Links to the public profile page.
 */
export function ProfileName({
  address,
  you = false,
  links = true,
  className = "",
}: {
  address: string;
  you?: boolean;
  links?: boolean;
  className?: string;
}) {
  const { data } = useProfile(address);
  const profile = data?.profile;
  const name = profile?.name || (data ? `Agent #${data.agentId}` : shortAddr(address));
  return (
    <span className={`inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 ${className}`}>
      <Link
        href={`/u/${address}`}
        className="inline-flex min-w-0 items-center gap-1.5 text-[13.5px] font-medium text-verdict no-underline hover:underline"
        title={address}
        onClick={(e) => e.stopPropagation()}
      >
        {profile && <i className={`ph ${profile.kind === "agent" ? "ph-robot" : "ph-user"} text-[13px] text-muted`} aria-hidden />}
        <span className="truncate">{name}</span>
      </Link>
      {profile && <span className="font-mono text-[11px] text-muted">{shortAddr(address)}</span>}
      {you && <span className="font-mono text-[11px] text-verdict">(YOU)</span>}
      {links && profile && <ProfileLinkList links={profile.links} />}
    </span>
  );
}
