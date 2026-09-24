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
import { isZero } from "@/lib/format";

type Mode = "verified" | "curated";

const PREIMAGE_WORDS = ["orbit", "falcon", "matrix", "harbor", "zenith", "cobalt", "ember", "quartz"];

const CURATED_PRESETS = [
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
    label: "Market sentiment",
    reward: "0.25",
    spec: "In one line, summarise current BTC market sentiment (bullish / bearish / neutral) with a one-clause reason.",
  },
  {
    label: "Summarize a doc",
    reward: "0.50",
    spec: "Summarize the linked Arc docs quickstart into 5 bullet points a new developer can act on.",
  },
];

export function PostTask({ onPosted }: { onPosted: () => void }) {
  const { isConnected, wrongNetwork, address } = useWallet();
  const { isLive, isContractConfigured, contract, verifiers, txUrl } = useNetwork();
  const { push } = useToast();
  const tx = useTx();

  const [mode, setMode] = useState<Mode>("verified");
  const [expire, setExpire] = useState(false);
  const [kind, setKind] = useState<"backdoor" | "preimage">("backdoor");
  const [vReward, setVReward] = useState("1.00");
  const [spec, setSpec] = useState(CURATED_PRESETS[0].spec);
  const [cReward, setCReward] = useState(CURATED_PRESETS[0].reward);
  const [validator, setValidator] = useState("");

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

  const reward = mode === "verified" ? vReward : cReward;
  const rewardNum = Number(reward);
  const validatorValid = validator.trim() === "" || isAddress(validator.trim());
  const busy = tx.isPending || tx.isConfirming;

  const canPost =
    isConnected &&
    !wrongNetwork &&
    isContractConfigured &&
    rewardNum > 0 &&
    !busy &&
    (mode === "verified" ? verifiersReady : spec.trim().length > 0 && validatorValid);

  useEffect(() => {
    if (tx.isSuccess && tx.hash) {
      push({ kind: "success", msg: `Bounty posted — ${reward} USDC locked in escrow.`, href: txUrl(tx.hash) });
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
    const deadline = expire ? BigInt(Math.floor(Date.now() / 1000) + 24 * 3600) : 0n;
    if (mode === "verified") {
      await tx.write({
        address: contract,
        abi: bountyEngineAbi,
        functionName: "createVerifiedTask",
        args: [verified.spec, verified.verifier, verified.taskData, deadline],
        value: parseEther(vReward || "0"),
      });
    } else {
      const v = validator.trim() === "" ? zeroAddress : (validator.trim() as `0x${string}`);
      await tx.write({
        address: contract,
        abi: bountyEngineAbi,
        functionName: "createTask",
        args: [spec, v, deadline],
        value: parseEther(cReward || "0"),
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
          <span className="text-sm font-medium">Verified</span>
          <span className={`font-mono text-[11px] ${mode === "verified" ? "text-edge" : "text-muted"}`}>AUTO-SETTLE</span>
        </button>
        <button
          onClick={() => setMode("curated")}
          className={`flex flex-col gap-1 p-3 text-left ${mode === "curated" ? "bg-verdict text-ground" : "text-sub"}`}
        >
          <span className="text-sm font-medium">Curated</span>
          <span className={`font-mono text-[11px] ${mode === "curated" ? "text-edge" : "text-muted"}`}>VALIDATOR</span>
        </button>
      </div>

      {mode === "verified" ? (
        <>
          <div className="flex flex-col gap-2">
            <span className={kickerCls}>Challenge type</span>
            {(
              [
                { k: "backdoor", label: "Backdoor CTF", tag: "EXPLOIT INPUT" },
                { k: "preimage", label: "Preimage", tag: "HASH → INPUT" },
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
          </div>

          <AmountField value={vReward} onChange={setVReward} />
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
            <span className={kickerCls}>Task specification</span>
            <textarea
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
              rows={6}
              className="field-input font-mono text-[13px] leading-relaxed"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <AmountField value={cReward} onChange={setCReward} compact />
            <div className="flex flex-col gap-1.5">
              <span className={kickerCls}>Validator · optional</span>
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

      {/* expire toggle */}
      <label className="flex cursor-pointer items-center gap-3">
        <span className={`relative h-[18px] w-[34px] flex-none border-[1.5px] ${expire ? "border-verdict" : "border-edge"}`}>
          <span
            className={`absolute top-0.5 h-[11px] w-[11px] ${expire ? "right-0.5 bg-verdict" : "left-0.5 bg-edge"}`}
          />
        </span>
        <input type="checkbox" checked={expire} onChange={(e) => setExpire(e.target.checked)} className="sr-only" />
        <span className="text-sm text-ink">
          Auto-expire in 24h <span className="text-muted">(reclaimable)</span>
        </span>
      </label>

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
            <span className="font-medium text-verdict">Mainnet: real USDC.</span> This locks {reward || "0"} USDC.
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
                Lock {reward || "0"} {isLive ? "real " : ""}USDC
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

function AmountField({
  value,
  onChange,
  compact,
}: {
  value: string;
  onChange: (v: string) => void;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[11px] font-medium uppercase tracking-wide3 text-muted">Amount</span>
      <div className="flex items-baseline gap-2.5 border-b border-verdict pb-1.5">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          placeholder="0.00"
          className={`tnum min-w-0 flex-1 bg-transparent font-light tracking-tighter text-verdict outline-none placeholder:text-edge ${
            compact ? "text-[28px]" : "text-[44px] leading-none"
          }`}
        />
        <span className="font-mono text-xs font-medium text-muted">USDC</span>
      </div>
    </div>
  );
}
