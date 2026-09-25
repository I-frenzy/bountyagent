/**
 * Profiles are ERC-8004 identities. The profile lives fully on-chain as the
 * identity's registration file (an ERC-8004 "registration-v1" JSON document in
 * a base64 data URI, which the standard recommends for on-chain metadata).
 *
 * Everything here treats profile content as untrusted input: names and bios are
 * length-limited plain text, and links are only ever emitted as https URLs to
 * the expected sites — never javascript:, data: or anything a user controls
 * beyond a handle.
 */

export type ProfileKind = "person" | "agent";

export type ProfileLinks = {
  web?: string; // https URL
  x?: string; // https://x.com/<handle>
  github?: string; // https://github.com/<user>
  farcaster?: string; // https://farcaster.xyz/<name>
};

export type Profile = {
  name: string;
  bio: string;
  kind: ProfileKind;
  links: ProfileLinks;
};

export const LIMITS = { name: 40, bio: 280, url: 200 } as const;

const REGISTRATION_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";

// ---------------------------------------------------------------------------
// Link normalisation — each returns an https URL or null.
// ---------------------------------------------------------------------------

function handleFrom(input: string, hosts: string[]): string {
  let s = input.trim();
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    if (hosts.includes(u.hostname.replace(/^www\./, ""))) {
      s = u.pathname.split("/").filter(Boolean)[0] ?? "";
    }
  } catch {
    /* not a URL — treat as a bare handle */
  }
  return s.replace(/^@/, "");
}

export function normalizeX(input: string): string | null {
  if (!input.trim()) return null;
  const h = handleFrom(input, ["x.com", "twitter.com", "mobile.twitter.com"]);
  return /^[A-Za-z0-9_]{1,15}$/.test(h) ? `https://x.com/${h}` : null;
}

export function normalizeGithub(input: string): string | null {
  if (!input.trim()) return null;
  const h = handleFrom(input, ["github.com"]);
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(h) ? `https://github.com/${h}` : null;
}

export function normalizeFarcaster(input: string): string | null {
  if (!input.trim()) return null;
  const h = handleFrom(input, ["farcaster.xyz", "warpcast.com"]).toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,19}(\.eth)?$/.test(h) ? `https://farcaster.xyz/${h}` : null;
}

export function normalizeWeb(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    if (u.protocol !== "https:" || !u.hostname.includes(".") || u.username || u.password) return null;
    const out = u.toString();
    return out.length <= LIMITS.url ? out : null;
  } catch {
    return null;
  }
}

/** Short label for a link, e.g. "@alice" or "alice.dev". */
export function linkLabel(kind: keyof ProfileLinks, url: string): string {
  try {
    const u = new URL(url);
    const first = u.pathname.split("/").filter(Boolean)[0] ?? "";
    if (kind === "x" || kind === "farcaster") return `@${first}`;
    if (kind === "github") return first;
    return u.hostname.replace(/^www\./, "") + (u.pathname !== "/" ? u.pathname : "");
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// ERC-8004 registration file <-> Profile
// ---------------------------------------------------------------------------

const clean = (s: unknown, max: number) =>
  typeof s === "string" ? s.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim().slice(0, max) : "";

export function buildRegistration(p: Profile) {
  const services: { name: string; endpoint: string }[] = [];
  if (p.links.web) services.push({ name: "web", endpoint: p.links.web });
  if (p.links.x) services.push({ name: "x", endpoint: p.links.x });
  if (p.links.github) services.push({ name: "github", endpoint: p.links.github });
  if (p.links.farcaster) services.push({ name: "farcaster", endpoint: p.links.farcaster });
  return {
    type: REGISTRATION_TYPE,
    name: clean(p.name, LIMITS.name),
    description: clean(p.bio, LIMITS.bio),
    services,
    active: true,
    supportedTrust: ["reputation"],
    // app-specific: lets the UI show a person or an agent
    bountyagent: { kind: p.kind },
  };
}

function toBase64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function fromBase64Utf8(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function toDataUri(p: Profile): string {
  return `data:application/json;base64,${toBase64Utf8(JSON.stringify(buildRegistration(p)))}`;
}

/**
 * Parse an agentURI into a Profile. Only on-chain data URIs are read (no
 * fetching of arbitrary URLs from the browser); anything else returns null and
 * the UI falls back to showing the agent ID. Every field is re-validated.
 */
export function parseAgentUri(uri: string): Profile | null {
  try {
    let json: string;
    if (uri.startsWith("data:application/json;base64,")) json = fromBase64Utf8(uri.slice(29));
    else if (uri.startsWith("data:application/json,")) json = decodeURIComponent(uri.slice(22));
    else return null;
    if (json.length > 8_000) return null;
    const doc = JSON.parse(json) as Record<string, unknown>;
    const links: ProfileLinks = {};
    const services = Array.isArray(doc.services) ? doc.services : Array.isArray(doc.endpoints) ? doc.endpoints : [];
    for (const s of services.slice(0, 20) as { name?: unknown; endpoint?: unknown }[]) {
      const name = typeof s?.name === "string" ? s.name.toLowerCase() : "";
      const ep = typeof s?.endpoint === "string" ? s.endpoint : "";
      if (name === "web" && !links.web) links.web = normalizeWeb(ep) ?? undefined;
      if ((name === "x" || name === "twitter") && !links.x) links.x = normalizeX(ep) ?? undefined;
      if (name === "github" && !links.github) links.github = normalizeGithub(ep) ?? undefined;
      if (name === "farcaster" && !links.farcaster) links.farcaster = normalizeFarcaster(ep) ?? undefined;
    }
    const ba = doc.bountyagent as { kind?: unknown } | undefined;
    return {
      name: clean(doc.name, LIMITS.name),
      bio: clean(doc.description, LIMITS.bio),
      kind: ba?.kind === "agent" ? "agent" : "person",
      links,
    };
  } catch {
    return null;
  }
}
