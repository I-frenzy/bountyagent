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

  return (
    <div className="inline-flex rounded-lg border border-line bg-inset p-0.5 text-[12px]">
      {(["testnet", "mainnet"] as const).map((id) => {
        const active = network === id;
        const live = id === "mainnet";
        return (
          <button
            key={id}
            onClick={() => pick(id)}
            className={`rounded-md px-2.5 py-1 font-medium transition ${
              active
                ? live
                  ? "bg-danger/20 text-danger"
                  : "bg-settle/15 text-settle"
                : "text-faint hover:text-muted"
            }`}
          >
            {NETWORKS[id].short}
          </button>
        );
      })}
    </div>
  );
}
