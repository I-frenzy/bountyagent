/**
 * Link preview metadata (title, description, image) for links people paste into
 * bounties and submissions. Browsers can't read other sites' metadata (CORS), so
 * this server route fetches it.
 *
 * A server that fetches arbitrary URLs is an SSRF risk, so:
 *  - https only, default port, no credentials in the URL, URL length capped;
 *  - the hostname must resolve only to public IPs (private, loopback,
 *    link-local, CGNAT, multicast and reserved ranges are refused), re-checked
 *    on every redirect (followed manually, max 3 hops);
 *  - 5 s timeout, at most 512 KB of HTML read, text/html only;
 *  - only a few short text fields and an https image URL are returned — never
 *    the page itself;
 *  - responses are cached at the edge for a day.
 * X posts and YouTube videos use those sites' official oEmbed endpoints; their
 * HTML/scripts are never passed to the browser, only extracted plain text.
 */
import { NextResponse, type NextRequest } from "next/server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const runtime = "nodejs";

export type Preview = {
  url: string;
  site?: string;
  title?: string;
  description?: string;
  image?: string;
  kind?: "x" | "youtube" | "page";
};

const TIMEOUT_MS = 5_000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const UA = "BountyAgentPreview/1.0 (+https://bountyagent.vercel.app)";

// ---------------------------------------------------------------------------
// URL + address safety
// ---------------------------------------------------------------------------

function safeUrl(raw: string | null): URL | null {
  if (!raw || raw.length > 500) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
      return null;
    }
    return u;
  } catch {
    return null;
  }
}

function isPrivateV4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // unparseable = unsafe
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast + reserved
  );
}

/** Expand an IPv6 address into 8 16-bit groups (handles "::" and a trailing dotted IPv4). */
function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const p = dotted[1].split(".").map(Number);
    if (p.some((n) => n > 255)) return null;
    s = s.slice(0, -dotted[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

const v4Of = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateV4(ip);
  const g = expandV6(ip);
  if (!g) return true; // unparseable = unsafe
  const zeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroTo(8)) return true; // ::
  if (zeroTo(7) && g[7] === 1) return true; // ::1
  if (zeroTo(5) && g[5] === 0xffff) return isPrivateV4(v4Of(g[6], g[7])); // ::ffff:a.b.c.d (mapped)
  if (zeroTo(6)) return true; // ::a.b.c.d (deprecated compatible) — never needed
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPrivateV4(v4Of(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return isPrivateV4(v4Of(g[1], g[2])); // 6to4
  return (
    (g[0] & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (g[0] & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (g[0] & 0xff00) === 0xff00 // multicast ff00::/8
  );
}

async function hostIsPublic(rawHost: string): Promise<boolean> {
  // URL hostnames wrap IPv6 literals in brackets: "[::1]" -> "::1"
  const host = rawHost.startsWith("[") && rawHost.endsWith("]") ? rawHost.slice(1, -1) : rawHost;
  if (isIP(host)) return !isPrivateIp(host);
  try {
    const addrs = await lookup(host, { all: true, verbatim: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

/** fetch() that re-validates every hop and caps time and size. */
async function safeFetch(start: URL, accept: string): Promise<{ url: URL; body: string; type: string } | null> {
  let url = start;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!(await hostIsPublic(url.hostname))) return null;
      const res = await fetch(url, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "user-agent": UA, accept },
      });
      if (res.status >= 300 && res.status < 400) {
        const next = safeUrl(res.headers.get("location") ? new URL(res.headers.get("location")!, url).toString() : null);
        if (!next) return null;
        url = next;
        continue;
      }
      if (!res.ok || !res.body) return null;
      const type = res.headers.get("content-type") ?? "";
      // Read at most MAX_BYTES.
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
      }
      await reader.cancel().catch(() => {});
      const bytes = new Uint8Array(Math.min(total, MAX_BYTES));
      let off = 0;
      for (const c of chunks) {
        const take = Math.min(c.length, bytes.length - off);
        bytes.set(c.subarray(0, take), off);
        off += take;
        if (off >= bytes.length) break;
      }
      return { url, body: new TextDecoder().decode(bytes), type };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** Plain, single-line-ish text: tags stripped, entities decoded, length capped. */
function text(s: string | undefined, max: number): string | undefined {
  if (!s) return undefined;
  const t = decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  return t ? (t.length > max ? `${t.slice(0, max - 1)}…` : t) : undefined;
}

function httpsImage(src: string | undefined, base: URL): string | undefined {
  if (!src) return undefined;
  try {
    const u = new URL(decodeEntities(src), base);
    return u.protocol === "https:" && u.toString().length <= 600 ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function meta(html: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
      "i",
    );
    const m = html.match(re);
    if (m) return m[1] ?? m[2];
  }
  return undefined;
}

function parseHtml(html: string, url: URL): Preview {
  const head = html.slice(0, 200_000);
  const title = meta(head, ["og:title", "twitter:title"]) ?? head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  return {
    url: url.toString(),
    kind: "page",
    site: text(meta(head, ["og:site_name"]), 60) ?? url.hostname.replace(/^www\./, ""),
    title: text(title, 140),
    description: text(meta(head, ["og:description", "twitter:description", "description"]), 280),
    image: httpsImage(meta(head, ["og:image", "og:image:url", "twitter:image"]), url),
  };
}

// ---------------------------------------------------------------------------
// oEmbed for sites that don't serve normal metadata to non-browsers
// ---------------------------------------------------------------------------

const X_POST = /^(?:www\.|mobile\.)?(?:x|twitter)\.com$/;

async function oembed(endpoint: string): Promise<Record<string, unknown> | null> {
  const res = await safeFetch(new URL(endpoint), "application/json");
  if (!res) return null;
  try {
    return JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function preview(u: URL): Promise<Preview> {
  const host = u.hostname.toLowerCase();

  if (X_POST.test(host) && /\/status\/\d+/.test(u.pathname)) {
    const o = await oembed(`https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=${encodeURIComponent(u.toString())}`);
    if (o) {
      // `html` is a blockquote; keep only its first paragraph's text.
      const html = typeof o.html === "string" ? o.html : "";
      const para = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1];
      return {
        url: u.toString(),
        kind: "x",
        site: "X",
        title: text(typeof o.author_name === "string" ? o.author_name : undefined, 80),
        description: text(para, 400),
      };
    }
  }

  if (/^(?:www\.|m\.)?youtube\.com$/.test(host) || host === "youtu.be") {
    const o = await oembed(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u.toString())}`);
    if (o) {
      return {
        url: u.toString(),
        kind: "youtube",
        site: "YouTube",
        title: text(typeof o.title === "string" ? o.title : undefined, 140),
        description: text(typeof o.author_name === "string" ? o.author_name : undefined, 80),
        image: httpsImage(typeof o.thumbnail_url === "string" ? o.thumbnail_url : undefined, u),
      };
    }
  }

  const res = await safeFetch(u, "text/html,application/xhtml+xml");
  if (!res || !res.type.includes("html")) return { url: u.toString(), site: host.replace(/^www\./, "") };
  return parseHtml(res.body, res.url);
}

export async function GET(req: NextRequest) {
  const u = safeUrl(req.nextUrl.searchParams.get("url"));
  if (!u) return NextResponse.json({ error: "unsupported url" }, { status: 400 });
  if (!(await hostIsPublic(u.hostname))) return NextResponse.json({ error: "blocked address" }, { status: 400 });
  const data = await preview(u);
  const found = !!(data.title || data.description);
  return NextResponse.json(data, {
    headers: {
      // cache good previews for a day; retry misses sooner
      "cache-control": found
        ? "public, s-maxage=86400, stale-while-revalidate=604800"
        : "public, s-maxage=600",
    },
  });
}
