"use client";

import { useEffect, useMemo, useState } from "react";
import {
  parseEther,
  isAddress,
  zeroAddress,
  keccak256,
  stringToHex,
  encodeAbiParameters,
} from "viem";
import { useWallet } from "@/lib/wallet";
import { useNetwork } from "@/lib/network";
import { useTx } from "@/lib/useTx";
import { useToast } from "@/lib/toast";
import { bountyEngineAbi } from "@/lib/bountyAbi";
import { fmtUsdc, isZero } from "@/lib/format";

type Mode = "verified" | "curated";

// Every bounty must expire (the contract enforces 10 min – 90 days), so one
// junk submission can never lock the escrow. Default: 24h.
const DURATIONS = [
  { label: "1h", seconds: 3600 },
  { label: "24h", seconds: 24 * 3600 },
  { label: "3d", seconds: 3 * 24 * 3600 },
  { label: "7d", seconds: 7 * 24 * 3600 },
] as const;

const PREIMAGE_WORDS = ["orbit", "falcon", "matrix", "harbor", "zenith", "cobalt", "ember", "quartz"];

const MAX_WINNERS = 50; // BountyEngine.MAX_WINNERS
const MAX_TOTAL = 100; // BountyEngine.MAX_REWARD, in USDC

type PresetAudience = "anyone" | "people" | "agents";
const AUDIENCES: { k: PresetAudience; label: string }[] = [
  { k: "anyone", label: "Anyone" },
  { k: "people", label: "People" },
  { k: "agents", label: "Agents" },
];

const CURATED_PRESETS: { label: string; reward: string; spec: string; audience?: PresetAudience; winners?: string }[] = [
  {
    label: "Translate (people)",
    reward: "0.50",
    audience: "people",
    spec:
      "Translate this paragraph into natural, fluent French. No machine translation, please — it's for a product " +
      "page.\n\n\"Post a task, lock USDC in escrow, and pay the people who do the work — instantly, on Arc.\"",
  },
  {
    label: "Feedback × 5",
    reward: "0.20",
    audience: "people",
    winners: "5",
    spec:
      "Try bountyagent.vercel.app for two minutes and tell us the one thing that confused you most. " +
      "The five most useful answers get paid.",
  },
  {
    label: "Audit this code",
    reward: "1.00",
    spec:
      "Audit this function for reentrancy and report findings with severity:\n\n" +
      "function withdraw() external {\n" +
      "  uint256 bal = balances[msg.sender];\n" +
      '  (bool ok,) = msg.sender.call{value: bal}("");\n' +
      "  require(ok);\n" +
      "  balances[msg.sender] = 0;\n" +
      "}",
  },
  {
    label: "Write a PoC test",
    reward: "1.50",
    spec:
      "Write a complete Foundry test file proving this function is reentrant: an attacker contract plus a test " +
      "that drains more than its own balance. It must compile and pass with `forge test`.\n\n" +
      "function withdraw() external {\n" +
      "  uint256 bal = balances[msg.sender];\n" +
      '  (bool ok,) = msg.sender.call{value: bal}("");\n' +
      "  require(ok);\n" +
      "  balances[msg.sender] = 0;\n" +
      "}",
  },
  {
    label: "Gas-optimize",
    reward: "0.50",
    spec:
      "Rewrite this function to use less gas with identical behavior. Return the optimized code and one line per " +
      "change explaining the saving.\n\n" +
      "function sum(uint256[] memory xs) public pure returns (uint256 s) {\n" +
      "  for (uint256 i = 0; i < xs.length; i++) {\n" +
      "    s = s + xs[i];\n" +
      "  }\n" +
      "}",
  },
];

export function PostTask({ onPosted }: { onPosted: () => void }) {
  const { isConnected, wrongNetwork, address } = useWallet();
  const { isLive, isContractConfigured, contract, verifiers, txUrl } = useNetwork();
  const { push } = useToast();
  const tx = useTx();

  const [mode, setMode] = useState<Mode>("verified");
  const [duration, setDuration] = useState<number>(DURATIONS[1].seconds);
  const [kind, setKind] = useState<"backdoor" | "preimage">("backdoor");
  const [vReward, setVReward] = useState("1.00");
  const [spec, setSpec] = useState(CURATED_PRESETS[0].spec);
  const [cReward, setCReward] = useState(CURATED_PRESETS[0].reward);
  const [validator, setValidator] = useState("");
  const [audience, setAudience] = useState<PresetAudience>(CURATED_PRESETS[0].audience ?? "anyone");
  const [winners, setWinners] = useState(CURATED_PRESETS[0].winners ?? "1");

  const verifiersReady = !isZero(verifiers.backdoor) && !isZero(verifiers.preimage) && !isZero(verifiers.target);

  const verified = useMemo(() => {
    if (kind === "preimage") {
      const secret = PREIMAGE_WORDS[Math.floor(Math.random() * PREIMAGE_WORDS.length)];
      const hash = keccak256(stringToHex(secret));
      const taskData = encodeAbiParameters([{ type: "bytes32" }], [hash]);
      const spec =
        "solver:preimage\n" +
        "Find the word whose keccak256 hash matches the target hash.\n" +
        `candidates: ${PREIMAGE_WORDS.join(", ")}`;
      return {
        verifier: verifiers.preimage,
        taskData,
        spec,
        check: `keccak256(x) == ${hash.slice(0, 6)}…${hash.slice(-4)}`,
        preview: "Any input x that hashes to the target wins. The comparison runs on-chain and pays out the moment it matches.",
      };
    }
    const taskData = encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [verifiers.target, 1_000_000n],
    );
    const spec =
      "solver:backdoor\n" +
      "Find a SMALL input (<= 1000000) that makes VulnerableTarget.check() return true.\n" +
      "Source:\n" +
      "function check(uint256 input) external pure returns (bool) {\n" +
      "  if (input > 1_000_000 || input == 1337) { return true; }\n" +
      "  return false;\n" +
      "}";
    return {
      verifier: verifiers.backdoor,
      taskData,
      spec,
      check: "target.check(smallInput) == true",
      preview: "Deploys a target with a hidden privileged path. A valid answer is a small input that still passes the check; the verifier runs it on-chain and pays out if it returns true.",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, verifiers.preimage, verifiers.backdoor, verifiers.target, tx.hash]);

  // The amount field is *per winner*, so the total always splits evenly
  // (the contract requires reward % maxWinners == 0).
  const perWinner = mode === "verified" ? vReward : cReward;
  const winnerCount = /^\d+$/.test(winners) ? Number(winners) : 0;
  const winnersValid = winnerCount >= 1 && winnerCount <= MAX_WINNERS;
  const perWinnerWei = (() => {
    try {
      return parseEther(perWinner || "0");
    } catch {
      return 0n;
    }
  })();
  const totalWei = winnersValid ? perWinnerWei * BigInt(winnerCount) : 0n;
  const total = fmtUsdc(totalWei);
  const overCap = totalWei > parseEther(String(MAX_TOTAL));
  const validatorValid = validator.trim() === "" || isAddress(validator.trim());
  const busy = tx.isPending || tx.isConfirming;

  const canPost =
    isConnected &&
    !wrongNetwork &&
    isContractConfigured &&
    perWinnerWei > 0n &&
    winnersValid &&
    !overCap &&
    !busy &&
    (mode === "verified" ? verifiersReady : spec.trim().length > 0 && validatorValid);

  useEffect(() => {
    if (tx.isSuccess && tx.hash) {
      push({ kind: "success", msg: `Bounty posted — ${total} USDC locked in escrow.`, href: txUrl(tx.hash) });
      onPosted();
      tx.reset();
    }
    if (tx.error) {
      push({ kind: "error", msg: tx.error.message.slice(0, 140) });
      tx.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx.isSuccess, tx.error, tx.hash]);

  async function submit() {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + duration);
    if (mode === "verified") {
      await tx.write({
        address: contract,
        abi: bountyEngineAbi,
        functionName: "createVerifiedTask",
        args: [verified.spec, verified.verifier, verified.taskData, deadline, winnerCount],
        value: totalWei,
      });
    } else {
      const v = validator.trim() === "" ? zeroAddress : (validator.trim() as `0x${string}`);
      // Audience is a tag line agents can read (and the UI hides): a label, not a rule.
      const taggedSpec = audience === "anyone" ? spec.trim() : `audience:${audience}\n${spec.trim()}`;
      await tx.write({
        address: contract,
        abi: bountyEngineAbi,
        functionName: "createTask",
        args: [taggedSpec, v, deadline, winnerCount],
        value: totalWei,
      });
    }
  }

  const kickerCls = "font-mono text-[11px] font-medium uppercase tracking-wide3 text-muted";

  return (
    <div className={`relative flex flex-col gap-5 bg-panel p-6 ${isLive ? "border border-verdict" : "border border-rule"}`}>
      {isLive && <span aria-hidden className="absolute inset-x-[-1px] top-[-1px] h-1.5 hazard" />}

      <div className="flex items-baseline justify-between pt-0.5">
        <span className="text-2xl font-medium tracking-tight2 text-verdict">Post a bounty</span>
        {isLive && <span className="font-mono text-[11px] font-medium uppercase tracking-wide3 text-verdict">Real USDC</span>}
      </div>

      {/* mode switch */}
      <div className="grid grid-cols-2 border border-rule">
        <button
          onClick={() => setMode("verified")}
          className={`flex flex-col gap-1 p-3 text-left ${mode === "verified" ? "bg-verdict text-ground" : "text-sub"}`}
        >
          <span className="text-sm font-medium">Code checks it</span>
          <span className={`font-mono text-[11px] ${mode === "verified" ? "text-edge" : "text-muted"}`}>AUTO-PAY</span>
        </button>
        <button
          onClick={() => setMode("curated")}
          className={`flex flex-col gap-1 p-3 text-left ${mode === "curated" ? "bg-verdict text-ground" : "text-sub"}`}
        >
          <span className="text-sm font-medium">You decide</span>
          <span className={`font-mono text-[11px] ${mode === "curated" ? "text-edge" : "text-muted"}`}>PEOPLE OR AGENTS</span>
        </button>
      </div>

      {mode === "verified" ? (
        <>
          <div className="flex flex-col gap-2">
            <span className={kickerCls}>Challenge type</span>
            {(
              [
                { k: "backdoor", label: "Backdoor CTF", tag: "DEMO · EXPLOIT INPUT" },
                { k: "preimage", label: "Preimage", tag: "DEMO · HASH → INPUT" },
              ] as const
            ).map(({ k, label, tag }) => {
              const on = kind === k;
              return (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 text-left ${on ? "border border-verdict" : "border border-rule"}`}
                >
                  <span className={`grid h-3.5 w-3.5 place-items-center border-[1.5px] ${on ? "border-verdict" : "border-edge"}`}>
                    {on && <span className="h-1.5 w-1.5 bg-verdict" />}
                  </span>
                  <span className={`text-sm ${on ? "text-verdict" : "text-sub"}`}>{label}</span>
                  <span className="ml-auto font-mono text-[11px] text-muted">{tag}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-1.5 border border-dashed border-rule p-3">
            <span className={kickerCls}>The contract will check · read-only</span>
            <span className="font-mono text-[12.5px] leading-relaxed text-ink">{verified.check}</span>
            <span className="text-[13px] leading-relaxed text-sub">{verified.preview}</span>
            <span className="text-[12.5px] leading-snug text-muted">
              Demo challenge: the answer can be found in seconds, so any agent watching will claim it almost
              instantly. It shows the settlement flow, not a hard problem.
            </span>
          </div>

          <PayoutFields
            perWinner={vReward}
            onPerWinner={setVReward}
            winners={winners}
            onWinners={setWinners}
            total={total}
            overCap={overCap}
            winnersValid={winnersValid}
          />
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <span className={kickerCls}>Start from a preset</span>
            <div className="flex flex-wrap gap-1.5">
              {CURATED_PRESETS.map((p) => {
                const on = spec === p.spec;
                return (
                  <button
                    key={p.label}
                    onClick={() => {
                      setSpec(p.spec);
                      setCReward(p.reward);
                      setAudience(p.audience ?? "anyone");
                      setWinners(p.winners ?? "1");
                    }}
                    className={`px-2.5 py-1.5 text-[13px] ${on ? "border border-verdict text-verdict" : "border border-rule text-sub hover:border-edge"}`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className={kickerCls}>Who is this for</span>
            <div role="radiogroup" className="grid grid-cols-3 border border-rule">
              {AUDIENCES.map((a) => {
                const on = audience === a.k;
                return (
                  <button
                    key={a.k}
                    role="radio"
                    aria-checked={on}
                    onClick={() => setAudience(a.k)}
                    className={`py-2 text-[13px] ${on ? "bg-verdict text-ground" : "text-sub hover:text-ink"}`}
                  >
                    {a.label}
                  </button>
                );
              })}
            </div>
            <span className="text-[12.5px] leading-snug text-muted">
              A label for who should take it on. Anyone can still submit — a contract can&apos;t tell a person from a bot.
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <span className={kickerCls}>Task specification</span>
            <textarea
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
              rows={6}
              className="field-input font-mono text-[13px] leading-relaxed"
            />
            <span className="text-[12.5px] leading-snug text-muted">
              Paste links (an X post, GitHub, docs, a video) and they show as previews on the bounty.
            </span>
          </div>

          <PayoutFields
            perWinner={cReward}
            onPerWinner={setCReward}
            winners={winners}
            onWinners={setWinners}
            total={total}
            overCap={overCap}
            winnersValid={winnersValid}
            compact
          />
          <div className="grid grid-cols-1 gap-4">
            <div className="flex flex-col gap-1.5">
              <span className={kickerCls}>Who decides · optional</span>
              <input
                value={validator}
                onChange={(e) => setValidator(e.target.value)}
                placeholder="0x… defaults to you"
                className={`w-full border-b bg-transparent py-2 font-mono text-[13px] text-ink placeholder:text-edge outline-none ${
                  validatorValid ? "border-edge focus:border-verdict" : "border-verdict"
                }`}
              />
              {!validatorValid && (
                <span className="text-[12.5px] text-ink">Not a valid address. Expected 42 characters.</span>
              )}
            </div>
          </div>
        </>
      )}

      {/* deadline — required on-chain */}
      <div className="flex flex-col gap-2">
        <span className={kickerCls}>Closes in</span>
        <div role="radiogroup" className="grid grid-cols-4 border border-rule">
          {DURATIONS.map((d) => {
            const on = duration === d.seconds;
            return (
              <button
                key={d.label}
                role="radio"
                aria-checked={on}
                onClick={() => setDuration(d.seconds)}
                className={`py-2 font-mono text-[13px] ${on ? "bg-verdict text-ground" : "text-sub hover:text-ink"}`}
              >
                {d.label}
              </button>
            );
          })}
        </div>
        <span className="text-[12.5px] leading-snug text-muted">
          {mode === "verified"
            ? "After this, no new answers. Unclaimed USDC is reclaimable 15 min later."
            : "After this, no new submissions. Anything you haven't paid out, you can reclaim."}
        </span>
      </div>

      {/* inline warnings */}
      {!isContractConfigured && (
        <div className="flex items-start gap-2.5 border border-verdict bg-ground p-3">
          <span aria-hidden className="w-[18px] flex-none self-stretch hazard-thin" />
          <span className="text-[13px] leading-snug text-ink">
            <span className="font-medium text-verdict">No contract on this network.</span> BountyAgent isn&apos;t
            deployed here yet. Switch to Testnet to post.
          </span>
        </div>
      )}
      {isLive && isContractConfigured && (
        <div className="flex items-start gap-2.5 border border-verdict p-3">
          <span aria-hidden className="w-[18px] flex-none self-stretch hazard-thin" />
          <span className="text-[13px] leading-snug text-ink">
            <span className="font-medium text-verdict">Mainnet: real USDC.</span> This locks {total} USDC.
            Double-check the amount{mode === "curated" ? " and the validator" : ""}.
          </span>
        </div>
      )}

      {/* submit */}
      <div className={isLive ? "border border-verdict" : ""}>
        {busy && (
          <div className="h-[3px] bg-rule">
            <div className={`h-[3px] bg-verdict ${tx.isPending ? "w-2/5 animate-shimmer" : "w-4/5"}`} />
          </div>
        )}
        <button
          className={`flex min-h-[54px] w-full items-center justify-between px-4 font-sans text-[15px] font-medium ${
            busy ? "bg-ground text-verdict" : "bg-verdict text-ground hover:bg-body"
          } disabled:cursor-not-allowed disabled:opacity-40`}
          style={isLive && !busy ? { boxShadow: "0 0 0 1px #0A0A0A, 0 0 0 3px #FFFFFF" } : undefined}
          onClick={submit}
          disabled={!canPost}
        >
          <span className="inline-flex items-center gap-2">
            {busy ? (
              <>
                <i className="ph ph-circle-notch animate-spin" />
                {tx.isPending ? "Confirm in wallet…" : "Locking escrow…"}
              </>
            ) : (
              <>
                <i className={isLive ? "ph-bold ph-warning" : "ph ph-lock-simple"} />
                Lock {total} {isLive ? "real " : ""}USDC
              </>
            )}
          </span>
          {busy ? (
            <span className="font-mono text-[11px] text-muted">{tx.isPending ? "1 / 2" : "2 / 2"}</span>
          ) : (
            <i className="ph ph-arrow-right" />
          )}
        </button>
      </div>
    </div>
  );
}

/** Amount per winner + number of winners, with the total that gets locked. */
function PayoutFields({
  perWinner,
  onPerWinner,
  winners,
  onWinners,
  total,
  overCap,
  winnersValid,
  compact,
}: {
  perWinner: string;
  onPerWinner: (v: string) => void;
  winners: string;
  onWinners: (v: string) => void;
  total: string;
  overCap: boolean;
  winnersValid: boolean;
  compact?: boolean;
}) {
  const kicker = "font-mono text-[11px] font-medium uppercase tracking-wide3 text-muted";
  const multi = winners !== "1";
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-4">
        <label className="flex flex-col gap-1.5">
          <span className={kicker}>{multi ? "Each winner gets" : "Amount"}</span>
          <span className="flex items-baseline gap-2.5 border-b border-verdict pb-1.5">
            <input
              value={perWinner}
              onChange={(e) => onPerWinner(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              placeholder="0.00"
              className={`tnum min-w-0 flex-1 bg-transparent font-light tracking-tighter text-verdict outline-none placeholder:text-edge ${
                compact ? "text-[28px]" : "text-[44px] leading-none"
              }`}
            />
            <span className="font-mono text-xs font-medium text-muted">USDC</span>
          </span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={kicker}>Winners</span>
          <span className={`flex items-baseline border-b pb-1.5 ${winnersValid ? "border-edge" : "border-verdict"}`}>
            <input
              value={winners}
              onChange={(e) => onWinners(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
              inputMode="numeric"
              aria-label="Number of winners"
              className={`tnum w-full bg-transparent font-light tracking-tighter text-verdict outline-none ${
                compact ? "text-[28px]" : "text-[44px] leading-none"
              }`}
            />
          </span>
        </label>
      </div>
      {!winnersValid ? (
        <span className="text-[12.5px] text-ink">Winners must be between 1 and {MAX_WINNERS}.</span>
      ) : overCap ? (
        <span className="text-[12.5px] text-ink">
          The total is {total} USDC. During the beta a bounty can lock at most {MAX_TOTAL} USDC.
        </span>
      ) : (
        multi && (
          <span className="text-[12.5px] text-sub">
            Locks <span className="tnum text-verdict">{total} USDC</span> in total. Anything you don&apos;t pay out comes
            back to you.
          </span>
        )
      )}
    </div>
  );
}
