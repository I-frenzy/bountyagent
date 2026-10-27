"use client";

import { useWallet } from "@/lib/wallet";
import { useNetwork } from "@/lib/network";
import { DEV_LOCAL, NETWORKS, NETWORK_ORDER, type NetworkId } from "@/lib/chains";

export function NetworkToggle() {
  const { network, setNetwork, isLive } = useNetwork();
  const { isConnected, switchToChain } = useWallet();

  async function pick(id: NetworkId) {
    setNetwork(id);
    if (isConnected) {
      try {
        await switchToChain(NETWORKS[id].chain);
      } catch {
        /* user can switch manually */
      }
    }
  }

  const ids: NetworkId[] = DEV_LOCAL ? ["local", ...NETWORK_ORDER] : NETWORK_ORDER;

  return (
    <div
      role="radiogroup"
      aria-label="Network"
      className={`inline-flex border ${isLive ? "border-verdict" : "border-rule"}`}
    >
      {ids.map((id) => {
        const active = network === id;
        const live = NETWORKS[id].live;
        const tone = active
          ? live
            ? "hazard-soft text-ground"
            : "bg-verdict text-ground"
          : "text-muted hover:text-ink";
        return (
          <button
            key={id}
            role="radio"
            aria-checked={active}
            onClick={() => pick(id)}
            className={`inline-flex items-center gap-1.5 px-2 py-[7px] font-mono text-[11.5px] sm:px-3 font-medium uppercase tracking-wide2 ${tone}`}
          >
            {active && live && <i className="ph-bold ph-warning" />}
            {NETWORKS[id].short}
          </button>
        );
      })}
    </div>
  );
}
