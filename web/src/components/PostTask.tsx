"use client";

import { useEffect, useState } from "react";
import { parseEther, isAddress, zeroAddress } from "viem";
import { useWallet } from "@/lib/wallet";
import { useNetwork } from "@/lib/network";
import { useTx } from "@/lib/useTx";
import { useToast } from "@/lib/toast";
import { bountyEngineAbi } from "@/lib/bountyAbi";

const PRESETS: { label: string; reward: string; spec: string }[] = [
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
  {
    label: "Risk extraction",
    reward: "0.50",
    spec:
      "Extract the top 3 risks from this note as a bullet list:\n" +
      '"Protocol holds 40% of TVL in a single LP, oracle updates hourly, and the multisig is 2-of-3 with one lost key."',
  },
];

export function PostTask({ onPosted }: { onPosted: () => void }) {
  const { isConnected, wrongNetwork, address } = useWallet();
  const { isLive, isContractConfigured, contract, txUrl } = useNetwork();
  const { push } = useToast();
  const tx = useTx();

  const [spec, setSpec] = useState(PRESETS[0].spec);
  const [reward, setReward] = useState(PRESETS[0].reward);
  const [validator, setValidator] = useState("");
  const [expire, setExpire] = useState(false);

  const rewardNum = Number(reward);
  const validatorValid = validator.trim() === "" || isAddress(validator.trim());
  const canPost =
    isConnected &&
    !wrongNetwork &&
    isContractConfigured &&
    spec.trim().length > 0 &&
    rewardNum > 0 &&
    validatorValid &&
    !tx.isPending &&
    !tx.isConfirming;

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

  function usePreset(p: (typeof PRESETS)[number]) {
    setSpec(p.spec);
    setReward(p.reward);
  }

  async function submit() {
    const deadline = expire ? BigInt(Math.floor(Date.now() / 1000) + 24 * 3600) : 0n;
    const v = validator.trim() === "" ? zeroAddress : (validator.trim() as `0x${string}`);
    await tx.write({
      address: contract,
      abi: bountyEngineAbi,
      functionName: "createTask",
      args: [spec, v, deadline],
      value: parseEther(reward || "0"),
    });
  }

  const busy = tx.isPending || tx.isConfirming;

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="eyebrow">Post objective</p>
          <h2 className="font-display text-lg font-semibold text-ink">Open a bounty</h2>
        </div>
        <span className="chip border-accent/30 text-accent">Escrowed USDC</span>
      </div>

      {/* judge presets */}
      <div className="mb-4">
        <p className="eyebrow mb-2">1-click presets</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => usePreset(p)}
              className="chip border-line text-muted hover:border-accent/50 hover:text-ink"
            >
              {p.label} · {p.reward}
            </button>
          ))}
        </div>
      </div>

      <label className="eyebrow mb-1.5 block">Task specification</label>
      <textarea
        value={spec}
        onChange={(e) => setSpec(e.target.value)}
        rows={7}
        placeholder="Describe the objective an agent must complete…"
        className="inset-field mb-3 resize-y font-mono text-[12.5px] leading-relaxed"
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="eyebrow mb-1.5 block">Bounty (USDC)</label>
          <input
            value={reward}
            onChange={(e) => setReward(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            className="inset-field mono"
            placeholder="1.00"
          />
        </div>
        <div>
          <label className="eyebrow mb-1.5 block">
            Validator <span className="text-faint normal-case tracking-normal">(optional — defaults to you)</span>
          </label>
          <input
            value={validator}
            onChange={(e) => setValidator(e.target.value)}
            className={`inset-field mono ${!validatorValid ? "border-danger/60" : ""}`}
            placeholder={address ?? "0x…"}
          />
        </div>
      </div>

      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          checked={expire}
          onChange={(e) => setExpire(e.target.checked)}
          className="h-4 w-4 accent-accent"
        />
        Auto-expire in 24h if no agent submits (reclaimable)
      </label>

      <button className="btn-primary mt-4 w-full" onClick={submit} disabled={!canPost}>
        {busy
          ? tx.isPending
            ? "Confirm in wallet…"
            : "Locking escrow…"
          : `Lock ${reward || "0"} USDC & post`}
      </button>

      {!isContractConfigured && (
        <p className="mt-2 text-center text-xs text-pending">
          No BountyEngine deployed on this network yet.
        </p>
      )}
      {isLive && (
        <p className="mt-2 text-center text-xs text-danger">Mainnet — this spends real USDC.</p>
      )}
    </div>
  );
}
