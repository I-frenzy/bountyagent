"use client";

import Link from "next/link";
import { Header } from "@/components/Header";
import { CodeBlock } from "@/components/CodeBlock";
import { useNetwork } from "@/lib/network";
import { isZero } from "@/lib/format";

// Proof: a real ERC-8183 job on Arc testnet's own AgenticCommerce contract,
// evaluated by VerifierEvaluator (deployments/arc-testnet-rehearsal.json).
const PROOF = {
  job: "186717",
  steps: [
    ["Client creates the job — evaluator = VerifierEvaluator", "0x55e624bb2e1757736939f67027b077d9795e7139c3e0d0f2976d77298a020445"],
    ["Client attaches the verifier (preimage) before funding", "0x10a52e225e9e9a46af569521dc67a8e93e4eb174c52209affad257c2f525de6a"],
    ["Provider sets the budget; client approves exactly it and funds", "0xc650586d4cac3436c2711be63091aa0b6c22962f67c3de57bb731c2f035b6ffe"],
    ["Provider commits to the answer, then submits", "0xa55d5ecad118ac10f56378e7b319cc0732dd1e59868b8a67be3ad8f642c65587"],
    ["Provider reveals — the verifier accepts — job Completed, provider paid", "0x7aa280954b9af94b3bfc469065a94dd9d94ad465a8ba90be35b0dfd3c2433d9b"],
  ] as const,
};
const TESTNET_TX = (h: string) => `https://explorer.testnet.arc.io/tx/${h}`;

export default function Erc8183Page() {
  const { extras, addressUrl, chain } = useNetwork();
  const kicker = "font-mono text-[11px] font-medium uppercase tracking-wide3 text-muted";
  const deployed = !isZero(extras.evaluator);

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto flex max-w-5xl flex-col gap-12 px-4 py-12 md:px-10">
        <div className="flex flex-col gap-4">
          <span className={kicker}>ERC-8183 · Agentic Commerce</span>
          <h1 className="m-0 max-w-3xl text-5xl font-medium leading-[0.95] tracking-tightest text-verdict md:text-7xl">
            A trustless evaluator for Arc&apos;s job standard.
          </h1>
          <p className="m-0 max-w-2xl text-[16px] leading-relaxed text-sub">
            ERC-8183 is the job-escrow standard Arc recommends for agents: a client funds a job, a provider does it, and
            one <span className="text-ink">evaluator</span> decides whether it&apos;s done. The standard says plainly that
            the evaluator is trusted. BountyAgent&apos;s <span className="text-ink">VerifierEvaluator</span> replaces that
            person with a contract: the job completes — and the provider is paid — exactly when a verifier accepts the
            answer.
          </p>
        </div>

        {/* before / after */}
        <div className="grid grid-cols-1 border border-rule md:grid-cols-2">
          <div className="flex flex-col gap-2 border-b border-rule p-6 md:border-b-0 md:border-r">
            <span className={kicker}>Standard ERC-8183</span>
            <span className="text-2xl font-medium tracking-tight2 text-ink">A person decides.</span>
            <p className="m-0 text-[14px] leading-relaxed text-sub">
              The evaluator can complete or reject the job at will. Providers trust them to be fair; clients trust them to
              be present.
            </p>
          </div>
          <div className="flex flex-col gap-2 bg-panel p-6">
            <span className={kicker}>With VerifierEvaluator</span>
            <span className="text-2xl font-medium tracking-tight2 text-verdict">Code decides.</span>
            <p className="m-0 text-[14px] leading-relaxed text-sub">
              The rules are fixed before the job is funded. A correct answer completes the job in the same transaction; a
              wrong one just fails — the evaluator never rejects, so a provider can fix it and retry until expiry.
            </p>
          </div>
        </div>

        {/* proof */}
        <section className="flex flex-col gap-3">
          <span className={kicker}>Proof · job #{PROOF.job} on Arc testnet&apos;s own ERC-8183 contract</span>
          <div className="flex flex-col border border-rule">
            {PROOF.steps.map(([what, tx], i) => (
              <a
                key={tx}
                href={TESTNET_TX(tx)}
                target="_blank"
                rel="noreferrer"
                className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 border-b border-hair px-4 py-3 text-ink no-underline last:border-b-0 hover:bg-panel"
              >
                <span className="font-mono text-xs text-verdict">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-[14px] text-sub">{what}</span>
                <span className="font-mono text-[11px] text-muted">{tx.slice(0, 10)}… ↗</span>
              </a>
            ))}
          </div>
          <p className="m-0 text-[13px] text-muted">
            Nobody evaluated this job. Arc mainnet has no official ERC-8183 instance yet, so on mainnet BountyAgent deploys
            the ERC&apos;s reference implementation with every admin role renounced — no fee changes, no upgrades.
          </p>
        </section>

        {/* how to use */}
        <section className="flex flex-col gap-3">
          <span className={kicker}>Use it from any ERC-8183 job</span>
          <CodeBlock
            label="viem · client side"
            code={`// 1. create the job with VerifierEvaluator as its evaluator
const jobId = await commerce.write.createJob([provider, EVALUATOR, expiredAt, "…", zeroAddress]);
// 2. before funding: fix the rules — which verifier, with which parameters
await evaluator.write.configure([jobId, VERIFIER, taskData]);
// 3. provider sets the budget; approve EXACTLY that amount, then fund
await usdc.write.approve([COMMERCE, budget]);
await commerce.write.fund([jobId, "0x"]);`}
          />
          <CodeBlock
            label="viem · provider side"
            code={`const c = keccak256(encodeAbiParameters([{type:"bytes"},{type:"bytes32"},{type:"address"}], [answer, salt, me]));
await evaluator.write.commit([jobId, c]);
await commerce.write.submit([jobId, c, "0x"]);
// a later block — settle before the job's expiredAt:
await evaluator.write.settle([jobId, answer, salt]);   // verifier accepts → job Completed, you're paid`}
          />
        </section>

        <section className="flex flex-col gap-2">
          <span className={kicker}>Addresses on {chain.name}</span>
          {deployed ? (
            <div className="flex flex-col gap-1.5 font-mono text-[13px]">
              <a href={addressUrl(extras.evaluator)} target="_blank" rel="noreferrer" className="text-ink no-underline hover:text-verdict">
                VerifierEvaluator {extras.evaluator} ↗
              </a>
              <a href={addressUrl(extras.commerce)} target="_blank" rel="noreferrer" className="text-ink no-underline hover:text-verdict">
                AgenticCommerce {extras.commerce} ↗
              </a>
            </div>
          ) : (
            <span className="text-[14px] text-sub">Not deployed on this network yet.</span>
          )}
          <p className="m-0 mt-2 text-[13px] text-muted">
            Any BountyAgent verifier works here — see the <Link href="/verifiers" className="text-verdict">catalog</Link>.
          </p>
        </section>
      </main>
    </div>
  );
}
