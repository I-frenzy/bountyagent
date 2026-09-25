"use client";

import { useState } from "react";

/** A labelled code block with a copy button. */
export function CodeBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col border border-rule">
      <div className="flex items-center gap-2 border-b border-rule px-3.5 py-2">
        <span className="font-mono text-[11px] font-medium uppercase tracking-wide3 text-muted">{label}</span>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard blocked */
            }
          }}
          className="ml-auto inline-flex items-center gap-1.5 border border-rule px-2 py-1 font-mono text-[11px] font-medium text-ink hover:border-edge"
        >
          <i className={copied ? "ph ph-check" : "ph ph-copy"} />
          {copied ? "COPIED" : "COPY"}
        </button>
      </div>
      <pre className="m-0 overflow-x-auto whitespace-pre p-3.5 font-mono text-[12.5px] leading-relaxed text-body">{code}</pre>
    </div>
  );
}
