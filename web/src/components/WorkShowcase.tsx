"use client";

import type { Hex } from "viem";
import { useNetwork } from "@/lib/network";
import { decodeAnswer } from "@/lib/answers";
import { fmtAmount, shortAddr, timeAgo } from "@/lib/format";
import { LinkedText } from "./LinkedText";
import { ProfileName } from "./ProfileName";

/**
 * One winner's work: who did it, what they were paid, and the work itself —
 * their submission (poster-decided bounties, with link previews) or the answer
 * the contract checked (code-checked bounties), decoded to something readable.
 */
export function WorkShowcase({
  winner,
  share,
  verified,
  verifier,
  solverTag,
  submission,
  answer,
  submittedAt,
  rank,
  you,
}: {
  winner: `0x${string}`;
  share: bigint;
  verified: boolean;
  verifier?: `0x${string}`;
  solverTag?: string;
  submission?: string;
  answer?: Hex;
  submittedAt?: bigint;
  rank?: number;
  you?: boolean;
}) {
  const { addressUrl } = useNetwork();
  const decoded = answer ? decodeAnswer(answer, solverTag) : null;

  return (
    <article className="relative flex flex-col gap-4 border border-verdict bg-ground p-5">
      <span className="absolute inset-y-[-1px] left-[-1px] w-1 bg-verdict" aria-hidden />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {rank !== undefined && <span className="font-mono text-xs text-muted">WINNER {rank}</span>}
        <ProfileName address={winner} you={you} />
        <span className="ml-auto stamp">
          <i className="ph-bold ph-check" />
          Paid {fmtAmount(share)} USDC
        </span>
      </div>

      {verified ? (
        <div className="flex flex-col gap-2.5">
          <span className="font-mono text-[11px] font-medium uppercase tracking-wide3 text-muted">
            The answer the contract checked
          </span>
          {decoded?.kind === "contract" ? (
            <div className="flex flex-col gap-1 border border-rule bg-panel px-4 py-3">
              <span className="text-[13px] text-sub">A deployed implementation, run against the tests on-chain:</span>
              <a
                href={addressUrl(decoded.value)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[15px] text-verdict no-underline hover:underline"
              >
                {decoded.value}
              </a>
            </div>
          ) : decoded?.kind === "text" || decoded?.kind === "number" ? (
            <div className="border border-rule bg-panel px-4 py-3 font-mono text-2xl leading-snug text-verdict">
              {decoded.value}
            </div>
          ) : decoded ? (
            <div className="break-all border border-rule bg-panel px-4 py-3 font-mono text-[12.5px] text-sub">{decoded.value}</div>
          ) : (
            <div className="text-[13px] text-muted">Loading the revealed answer…</div>
          )}
          <span className="inline-flex flex-wrap items-center gap-1.5 text-[13px] text-sub">
            <i className="ph-fill ph-seal-check text-verdict" />
            Accepted by the verifier contract
            {verifier && (
              <a href={addressUrl(verifier)} target="_blank" rel="noreferrer" className="font-mono text-ink no-underline hover:text-verdict">
                {shortAddr(verifier)}
              </a>
            )}
            — no person decided this payout.
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <span className="flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-wide3 text-muted">
            Their submission
            {submittedAt !== undefined && <span className="normal-case tracking-normal">· {timeAgo(submittedAt)}</span>}
          </span>
          {submission ? (
            <LinkedText text={submission} previews className="text-[15px] leading-relaxed text-body" />
          ) : (
            <span className="text-[13px] text-muted">No submission text found.</span>
          )}
        </div>
      )}
    </article>
  );
}
