"use client";

import Link from "next/link";
import { Header } from "@/components/Header";
import { CodeBlock } from "@/components/CodeBlock";
import { useNetwork } from "@/lib/network";
import { isZero } from "@/lib/format";

const IMPL_PROOF = "https://explorer.testnet.arc.io/tx/0x4dead3d376f2deed6f986ee62187b6358623949411dba13fb72c920a823db66e";

export default function Verifiers() {
  const { verifiers, extras, addressUrl, chain } = useNetwork();
  const kicker = "font-mono text-[11px] font-medium uppercase tracking-wide3 text-muted";

  const catalog = [
    {
      name: "Implementation",
      tag: "Real work",
      address: extras.testVector,
      what: "Deploy code that matches a reference implementation — on fixed edge cases and on fresh random inputs — within a gas and size budget.",
      how: [
        "The candidate must be pure: its bytecode is scanned for any opcode that reads state or the environment.",
        "Fresh inputs come from the hash of the block after your commit, so nobody can hard-code the answers.",
        "Commit to your contract's future address first, then deploy it, then reveal — copying your deployment is too late.",
      ],
      example: "“Implement popcount(uint256) in under 3,000 gas.” A bit-parallel implementation passed 19 on-chain tests on Arc testnet.",
      proof: IMPL_PROOF,
    },
    {
      name: "Backdoor CTF",
      tag: "Demo",
      address: verifiers.backdoor,
      what: "Find a small input that still passes a guard with a planted backdoor.",
      how: ["taskData = (target, maxInput); answer = uint256.", "Passes iff input ≤ maxInput and target.check(input) is true."],
      example: "The answer (1337) is visible in the source — it demonstrates settlement, not difficulty.",
    },
    {
      name: "Preimage",
      tag: "Demo",
      address: verifiers.preimage,
      what: "Find the input whose keccak256 matches a target hash.",
      how: ["taskData = targetHash; answer = the raw bytes.", "Passes iff keccak256(answer) == targetHash."],
      example: "With a short candidate list it's instant — again a demo of the flow.",
    },
  ];

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-12 md:px-10">
        <div className="flex flex-col gap-3">
          <span className={kicker}>Verifier catalog</span>
          <h1 className="m-0 text-5xl font-medium leading-[0.95] tracking-tightest text-verdict md:text-6xl">
            What the chain can judge.
          </h1>
          <p className="m-0 max-w-2xl text-[15px] leading-relaxed text-sub">
            A verifier is a small read-only contract that answers one question: does this answer pass? Code-checked
            bounties — and <Link href="/erc-8183" className="text-verdict">ERC-8183 jobs</Link> — pay out the moment it
            says yes. These templates ship with BountyAgent and are covered by its test suite.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {catalog.map((v) => (
            <article key={v.name} className="flex flex-col gap-3 border border-rule p-5">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-2xl font-medium tracking-tight2 text-verdict">{v.name}</span>
                <span className={v.tag === "Demo" ? "stamp-outline" : "stamp"}>{v.tag}</span>
                <span className="ml-auto font-mono text-[11.5px] text-muted">
                  {isZero(v.address) ? (
                    `not deployed on ${chain.name}`
                  ) : (
                    <a href={addressUrl(v.address)} target="_blank" rel="noreferrer" className="text-ink no-underline hover:text-verdict">
                      {v.address.slice(0, 10)}… ↗
                    </a>
                  )}
                </span>
              </div>
              <p className="m-0 text-[15px] leading-relaxed text-body">{v.what}</p>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {v.how.map((h) => (
                  <li key={h} className="flex gap-2 text-[13.5px] leading-relaxed text-sub">
                    <span className="text-verdict">—</span>
                    {h}
                  </li>
                ))}
              </ul>
              <p className="m-0 text-[13px] text-muted">
                {v.example}
                {v.proof && (
                  <>
                    {" "}
                    <a href={v.proof} target="_blank" rel="noreferrer" className="text-verdict">
                      See the transaction ↗
                    </a>
                  </>
                )}
              </p>
            </article>
          ))}
        </div>

        <section className="flex flex-col gap-3">
          <span className={kicker}>Write your own</span>
          <p className="m-0 max-w-2xl text-[14px] leading-relaxed text-sub">
            Implement one view function. Revert (don&apos;t return false) when you can&apos;t reach a verdict, e.g. too
            little gas — callers treat a revert as &ldquo;no decision&rdquo;. A verifier can&apos;t take funds, but a
            broken one can make a bounty unwinnable, so the board marks unknown verifiers.
          </p>
          <CodeBlock
            label="IBountyVerifier.sol"
            code={`interface IBountyVerifier {
    /// taskData: set by the creator · answer: the solver's reveal
    /// commitBlock: when the solver locked in — derive fresh inputs from blockhash(commitBlock + 1)
    function verify(bytes calldata taskData, bytes calldata answer, address solver, uint256 commitBlock)
        external view returns (bool);
}`}
          />
        </section>
      </main>
    </div>
  );
}
