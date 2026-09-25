import { formatEther } from "viem";

export function shortAddr(address: string): string {
  if (!/^0x[a-fA-F0-9]{6,}$/.test(address)) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Native USDC (18-decimal view) → human string like "1.25". */
export function fmtUsdc(wei: bigint): string {
  const s = formatEther(wei);
  // trim to at most 4 dp, drop trailing zeros
  const n = Number(s);
  if (!isFinite(n)) return s;
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function timeAgo(unixSeconds: bigint | number): string {
  const t = Number(unixSeconds) * 1000;
  const diff = Date.now() - t;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Time until a future unix timestamp, e.g. "in 3h". */
export function timeUntil(unixSeconds: bigint | number): string {
  const s = Math.floor((Number(unixSeconds) * 1000 - Date.now()) / 1000);
  if (s <= 0) return "now";
  if (s < 60) return `in ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.floor(h / 24)}d`;
}

export function isZero(addr: string): boolean {
  return /^0x0+$/.test(addr);
}

/** Ledger amount: always 2 decimals, tabular-friendly (e.g. "250.00"). */
export function fmtAmount(wei: bigint): string {
  const n = Number(formatEther(wei));
  if (!isFinite(n)) return "0.00";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export type Audience = "anyone" | "people" | "agents";

/**
 * A spec may start with `key:value` tag lines (e.g. `solver:backdoor`,
 * `audience:people`) that agents read; people should only see the rest.
 * The audience is a label, not an on-chain rule — a contract can't tell a
 * person from a bot.
 */
export function parseSpec(spec: string): { audience: Audience; body: string; tags: Record<string, string> } {
  const lines = spec.split("\n");
  const tags: Record<string, string> = {};
  let i = 0;
  while (i < lines.length && /^[a-z]+:[a-z0-9_-]+$/.test(lines[i].trim())) {
    const [k, v] = lines[i].trim().split(":");
    tags[k] = v;
    i++;
  }
  const audience: Audience = tags.audience === "people" || tags.audience === "agents" ? tags.audience : "anyone";
  return { audience, body: lines.slice(i).join("\n").trim(), tags };
}

/** Derive a human challenge label from a verified task's spec tag. */
export function challengeLabel(spec: string): string | null {
  const s = spec.toLowerCase();
  if (s.includes("solver:backdoor")) return "Backdoor CTF";
  if (s.includes("solver:preimage")) return "Preimage";
  return null;
}
