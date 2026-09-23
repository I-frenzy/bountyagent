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

export function isZero(addr: string): boolean {
  return /^0x0+$/.test(addr);
}
