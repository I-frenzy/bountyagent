"use client";

import { Fragment } from "react";
import { LinkPreview } from "./LinkPreview";

// https URLs only; trailing punctuation isn't part of the link.
const URL_RE = /https:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}]/g;

/** The https links in a piece of text, deduplicated, in order. */
export function extractLinks(text: string, max = 3): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(URL_RE)) {
    try {
      const u = new URL(m[0]).toString();
      if (!out.includes(u)) out.push(u);
    } catch {
      /* not a URL */
    }
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Renders user text with https links made clickable — built as React nodes,
 * never as HTML, so nothing in the text can inject markup. Optionally shows a
 * preview card for the first few links.
 */
export function LinkedText({
  text,
  className = "",
  previews = false,
  maxPreviews = 2,
}: {
  text: string;
  className?: string;
  previews?: boolean;
  maxPreviews?: number;
}) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(text.slice(last, i));
    parts.push(
      <a
        key={i}
        href={m[0]}
        target="_blank"
        rel="noopener noreferrer nofollow ugc"
        className="break-all text-verdict underline decoration-edge underline-offset-2 hover:decoration-verdict"
        onClick={(e) => e.stopPropagation()}
      >
        {m[0]}
      </a>,
    );
    last = i + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));

  const links = previews ? extractLinks(text, maxPreviews) : [];
  return (
    <>
      <p className={`m-0 whitespace-pre-wrap break-words ${className}`}>
        {parts.map((p, k) => (
          <Fragment key={k}>{p}</Fragment>
        ))}
      </p>
      {links.length > 0 && (
        <div className="flex flex-col gap-2">
          {links.map((l) => (
            <LinkPreview key={l} url={l} />
          ))}
        </div>
      )}
    </>
  );
}
