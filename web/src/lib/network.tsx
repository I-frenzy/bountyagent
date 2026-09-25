"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Chain } from "viem";
import {
  DEFAULT_NETWORK,
  DEV_LOCAL,
  NETWORKS,
  explorerAddrUrl,
  explorerTxUrl,
  type NetworkId,
  type Verifiers,
} from "./arc";

const STORAGE_KEY = "bountyagent-network";

type NetworkState = {
  network: NetworkId;
  setNetwork: (id: NetworkId) => void;
  chain: Chain;
  contract: `0x${string}`;
  verifiers: Verifiers;
  isLive: boolean;
  isContractConfigured: boolean;
  txUrl: (hash: string) => string;
  addressUrl: (addr: string) => string;
};

const Ctx = createContext<NetworkState | null>(null);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [network, setNetworkState] = useState<NetworkId>(DEFAULT_NETWORK);

  // Restore last choice after mount (avoids hydration mismatch).
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "testnet" || saved === "mainnet" || (saved === "local" && DEV_LOCAL)) setNetworkState(saved);
  }, []);

  const setNetwork = useCallback((id: NetworkId) => {
    setNetworkState(id);
    window.localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const cfg = NETWORKS[network];

  const value = useMemo<NetworkState>(
    () => ({
      network,
      setNetwork,
      chain: cfg.chain,
      contract: cfg.contract,
      verifiers: cfg.verifiers,
      isLive: cfg.live,
      isContractConfigured:
        /^0x[a-fA-F0-9]{40}$/.test(cfg.contract) && !/^0x0+$/.test(cfg.contract),
      txUrl: (hash: string) => explorerTxUrl(cfg.chain, hash),
      addressUrl: (addr: string) => explorerAddrUrl(cfg.chain, addr),
    }),
    [network, setNetwork, cfg],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNetwork() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNetwork must be used within NetworkProvider");
  return ctx;
}
