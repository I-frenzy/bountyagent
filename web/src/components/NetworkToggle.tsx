"use client";

import { useWallet } from "@/lib/wallet";
import { useNetwork } from "@/lib/network";
import { NETWORKS } from "@/lib/arc";

export function NetworkToggle() {
  const { network, setNetwork } = useNetwork();
  const { isConnected, switchToChain } = useWallet();

  async function pick(id: "testnet" | "mainnet") {
    setNetwork(id);
    if (isConnected) {
      try {
        await switchToChain(NETWORKS[id].chain);
      } catch {
        /* user can switch manually */
      }
    }
  }

  const onMainnet = network === "mainnet";

  return (
    <div
      role="radiogroup"
      aria-label="Network"
      className={`inline-flex border ${onMainnet ? "border-verdict" : "border-rule"}`}
    >
      <button
        role="radio"
        aria-checked={network === "testnet"}
        onClick={() => pick("testnet")}
        className={`px-3 py-[7px] font-mono text-[11.5px] font-medium uppercase tracking-wide2 ${
          network === "testnet" ? "bg-verdict text-ground" : "text-muted hover:text-ink"
        }`}
      >
        Testnet
      </button>
      <button
        role="radio"
        aria-checked={onMainnet}
        onClick={() => pick("mainnet")}
        className={`inline-flex items-center gap-1.5 px-3 py-[7px] font-mono text-[11.5px] font-medium uppercase tracking-wide2 ${
          onMainnet ? "hazard-soft text-ground" : "text-muted hover:text-ink"
        }`}
      >
        {onMainnet && <i className="ph-bold ph-warning" />}
        Mainnet
      </button>
    </div>
  );
}
