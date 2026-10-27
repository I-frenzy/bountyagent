"use client";

import { useNetwork } from "@/lib/network";

/** Plain-language onboarding for people who've never used this network. */
export function UsdcGuide() {
  const { isLive, chain, symbol, label, faucet, network } = useNetwork();
  return (
    <details className="group border border-rule">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-3 text-[14px] text-ink">
        <i className="ph ph-question text-verdict" />
        New to this? How to get {symbol} on {label}
        <i className="ph ph-caret-down ml-auto text-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <ol className="m-0 flex list-none flex-col gap-3 px-3.5 pb-4 text-[13.5px] leading-relaxed text-sub">
        <Step n="1" title="Get a wallet">
          Install a browser wallet such as MetaMask, then press <span className="text-ink">Connect</span> at the top.
          The site adds the {chain.name} network for you.
        </Step>
        <Step n="2" title="Get some {symbol}">
          {network === "bot" ? (
            <>
              BOT is the native coin of BOT Chain. See{" "}
              <a href="https://botchain.ai" target="_blank" rel="noreferrer" className="text-verdict">
                botchain.ai
              </a>{" "}
              for how to get it. Start small.
            </>
          ) : isLive ? (
            <>
              Move USDC to Arc from another chain with Circle&apos;s bridge, or withdraw it to Arc from an exchange
              that supports Arc. Start small.
            </>
          ) : (
            <>
              On testnet it&apos;s free: request test {symbol} for your address at{" "}
              <a href={faucet} target="_blank" rel="noreferrer" className="text-verdict">
                {faucet?.replace("https://", "")}
              </a>
              .
            </>
          )}
        </Step>
        <Step n="3" title="That's it">
          On {label}, {symbol} is also what fees are paid in, so you only need one balance. Submitting work costs a small
          amount of {symbol} in gas; getting paid costs you nothing.
        </Step>
      </ol>
    </details>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-2.5">
      <span className="font-mono text-xs font-medium text-verdict">{n}</span>
      <span>
        <span className="font-medium text-ink">{title}. </span>
        {children}
      </span>
    </li>
  );
}
