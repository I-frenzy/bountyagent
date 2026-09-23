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
    label: "Reentrancy audit",
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
];

export function PostTask({ onPosted }: { onPosted: () => void }) {
  const { isConnected, wrongNetwork, address } = useWallet();
  const { isLive, isContractConfigured, contract, verifiers, txUrl } = useNetwork();
  const { push } = useToast();
  const tx = useTx();

  const [mode, setMode] = useState<Mode>("verified");
  const [expire, setExpire] = useState(false);

  // verified
  const [kind, setKind] = useState<"preimage" | "backdoor">("backdoor");
  const [vReward, setVReward] = useState("1.00");

  // curated
  const [spec, setSpec] = useState(CURATED_PRESETS[0].spec);
  const [cReward, setCReward] = useState(CURATED_PRESETS[0].reward);
  const [validator, setValidator] = useState("");

  const verifiersReady = !isZero(verifiers.backdoor) && !isZero(verifiers.preimage) && !isZero(verifiers.target);

  // Build the verified payload (spec + verifier + taskData) for the chosen kind.
  const verified = useMemo(() => {
    if (kind === "preimage") {
      const secret = PREIMAGE_WORDS[Math.floor(Math.random() * PREIMAGE_WORDS.length)];
      const hash = keccak256(stringToHex(secret));
      const taskData = encodeAbiParameters([{ type: "bytes32" }], [hash]);
      const spec =
        "solver:preimage\n" +
        "Find the word whose keccak256 hash matches the target hash.\n" +
        `candidates: ${PREIMAGE_WORDS.join(", ")}`;
      return { verifier: verifiers.preimage, taskData, spec, preview: "Preimage challenge — agent brute-forces the candidate list to match a keccak256 hash." };
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
    return { verifier: verifiers.backdoor, taskData, spec, preview: "Backdoor CTF — agent reads the source, spots the `== 1337` backdoor, and proves it on-chain." };
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

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="eyebrow">Post objective</p>
          <h2 className="font-display text-lg font-semibold text-ink">Open a bounty</h2>
        </div>
        <span className="chip border-accent/30 text-accent">Escrowed USDC</span>
      </div>

      {/* mode switch */}
      <div className="mb-4 grid grid-cols-2 gap-0.5 rounded-lg border border-line bg-inset p-0.5 text-[12px]">
        <button
          onClick={() => setMode("verified")}
          className={`rounded-md px-2 py-2 font-medium transition ${
            mode === "verified" ? "bg-accent/15 text-accent" : "text-faint hover:text-muted"
          }`}
        >
          ⚡ Verified (auto-settle)
        </button>
        <button
          onClick={() => setMode("curated")}
          className={`rounded-md px-2 py-2 font-medium transition ${
            mode === "curated" ? "bg-elevated text-ink" : "text-faint hover:text-muted"
          }`}
        >
          Curated (validator)
        </button>
      </div>

      {mode === "verified" ? (
        <>
          <p className="mb-3 text-[12px] leading-relaxed text-muted">
            The smart contract itself judges the answer. A passing submission is paid{" "}
            <span className="text-settle">automatically, in one transaction</span> — no human, fully trustless.
          </p>

          <label className="eyebrow mb-1.5 block">Challenge type</label>
          <div className="mb-3 flex gap-2">
            {(["backdoor", "preimage"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`chip flex-1 justify-center ${
                  kind === k ? "border-accent/50 text-ink" : "border-line text-muted hover:text-ink"
                }`}
              >
                {k === "backdoor" ? "Backdoor CTF" : "Preimage"}
              </button>
            ))}
          </div>

          <div className="mb-3 rounded-lg border border-line bg-inset p-3">
            <p className="text-[12px] leading-relaxed text-muted">{verified.preview}</p>
          </div>

          <label className="eyebrow mb-1.5 block">Bounty (USDC)</label>
          <input
            value={vReward}
            onChange={(e) => setVReward(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            className="inset-field mono mb-1"
            placeholder="1.00"
          />

          {!verifiersReady && (
            <p className="mt-2 text-xs text-pending">
              Verifier contracts not configured on this network yet — deploy them first.
            </p>
          )}
        </>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {CURATED_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => {
                  setSpec(p.spec);
                  setCReward(p.reward);
                }}
                className="chip border-line text-muted hover:border-accent/50 hover:text-ink"
              >
                {p.label} · {p.reward}
              </button>
            ))}
          </div>

          <label className="eyebrow mb-1.5 block">Task specification</label>
          <textarea
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            rows={6}
            className="inset-field mb-3 resize-y font-mono text-[12.5px] leading-relaxed"
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="eyebrow mb-1.5 block">Bounty (USDC)</label>
              <input
                value={cReward}
                onChange={(e) => setCReward(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                className="inset-field mono"
                placeholder="1.00"
              />
            </div>
            <div>
              <label className="eyebrow mb-1.5 block">
                Validator <span className="text-faint normal-case tracking-normal">(optional)</span>
              </label>
              <input
                value={validator}
                onChange={(e) => setValidator(e.target.value)}
                className={`inset-field mono ${!validatorValid ? "border-danger/60" : ""}`}
                placeholder={address ?? "0x…"}
              />
            </div>
          </div>
        </>
      )}

      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={expire} onChange={(e) => setExpire(e.target.checked)} className="h-4 w-4 accent-accent" />
        Auto-expire in 24h (reclaimable if unresolved)
      </label>

      <button className="btn-primary mt-4 w-full" onClick={submit} disabled={!canPost}>
        {busy
          ? tx.isPending
            ? "Confirm in wallet…"
            : "Locking escrow…"
          : `Lock ${reward || "0"} USDC & post`}
      </button>

      {!isContractConfigured && (
        <p className="mt-2 text-center text-xs text-pending">No BountyEngine deployed on this network yet.</p>
      )}
      {isLive && <p className="mt-2 text-center text-xs text-danger">Mainnet — this spends real USDC.</p>}
    </div>
  );
}
