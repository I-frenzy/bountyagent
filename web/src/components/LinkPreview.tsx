"use client";

import { useEffect, useState } from "react";
import type { Preview } from "@/app/api/preview/route";

// One request per URL per page load, shared by every card showing it.
const cache = new Map<string, Promise<Preview | null>>();

function load(url: string): Promise<Preview | null> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(`/api/preview?url=${encodeURIComponent(url)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Preview>) : null))
      .catch(() => null);
    cache.set(url, p);
  }
  return p;
}

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * A preview card for a link: site, title, description and image, fetched via
 * /api/preview. Everything shown is plain text; the image loads straight from
 * the linked site (no referrer sent). Falls back to a plain link row.
 */
export function LinkPreview({ url }: { url: string }) {
  const [data, setData] = useState<Preview | null | undefined>(undefined);
  const [imgOk, setImgOk] = useState(true);

  useEffect(() => {
    let alive = true;
    void load(url).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [url]);

  const rich = data && (data.title || data.description);
  const icon = data?.kind === "x" ? "ph ph-x-logo" : data?.kind === "youtube" ? "ph ph-youtube-logo" : "ph ph-link-simple";

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      onClick={(e) => e.stopPropagation()}
      className="group flex max-w-[560px] overflow-hidden border border-rule bg-panel no-underline hover:border-edge"
    >
      {rich && data.image && imgOk && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.image}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImgOk(false)}
          className="hidden h-auto max-h-[112px] w-[132px] flex-none object-cover sm:block"
        />
      )}
      <span className="flex min-w-0 flex-col gap-1 px-3.5 py-2.5">
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide2 text-muted">
          <i className={icon} aria-hidden />
          {data?.site ?? host(url)}
        </span>
        {data === undefined ? (
          <span className="h-3 w-48 animate-shimmer bg-rule" aria-label="Loading preview" />
        ) : rich ? (
          <>
            {data.title && (
              <span className="line-clamp-1 text-[14px] font-medium text-ink group-hover:text-verdict">
                {data.kind === "x" ? `${data.title} on X` : data.title}
              </span>
            )}
            {data.description && <span className="line-clamp-3 text-[13px] leading-snug text-sub">{data.description}</span>}
          </>
        ) : (
          <span className="truncate text-[13px] text-sub group-hover:text-verdict">{url}</span>
        )}
      </span>
    </a>
  );
}
