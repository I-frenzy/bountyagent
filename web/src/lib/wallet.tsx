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
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  numberToHex,
  type Chain,
  type PublicClient,
  type WalletClient,
} from "viem";
import { useNetwork } from "./network";
import { installDevWallet } from "./devWallet";

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

type WalletState = {
  address: `0x${string}` | null;
  chainId: number | null;
  isConnected: boolean;
  wrongNetwork: boolean;
  hasWallet: boolean;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
  switchToChain: (chain: Chain) => Promise<void>;
  walletClient: WalletClient | null;
  publicClient: PublicClient;
};

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { chain } = useNetwork();
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [hasWallet, setHasWallet] = useState(false);

  const publicClient = useMemo(
    // batch.multicall: reads issued together (the board polls many tasks) go out
    // as one Multicall3 call instead of dozens — the public Arc RPC rate-limits.
    () => createPublicClient({ chain, transport: http(), batch: { multicall: true } }) as PublicClient,
    [chain],
  );

  const walletClient = useMemo(() => {
    if (typeof window === "undefined" || !window.ethereum || !address) return null;
    return createWalletClient({ account: address, chain, transport: custom(window.ethereum) });
  }, [address, chain]);

  const refreshChain = useCallback(async () => {
    if (!window.ethereum) return;
    const hex = (await window.ethereum.request({ method: "eth_chainId" })) as string;
    setChainId(parseInt(hex, 16));
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) return;
    setConnecting(true);
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      if (accounts[0]) setAddress(accounts[0] as `0x${string}`);
      await refreshChain();
    } finally {
      setConnecting(false);
    }
  }, [refreshChain]);

  const disconnect = useCallback(() => setAddress(null), []);

  const switchToChain = useCallback(
    async (target: Chain) => {
      if (!window.ethereum) return;
      const hexId = numberToHex(target.id);
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: hexId }],
        });
      } catch (err: unknown) {
        if ((err as { code?: number }).code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: hexId,
                chainName: target.name,
                nativeCurrency: target.nativeCurrency,
                rpcUrls: target.rpcUrls.default.http,
                blockExplorerUrls: [target.blockExplorers?.default.url],
              },
            ],
          });
        }
      }
      await refreshChain();
    },
    [refreshChain],
  );

  const switchNetwork = useCallback(() => switchToChain(chain), [switchToChain, chain]);

  useEffect(() => {
    installDevWallet(); // no-op unless NEXT_PUBLIC_DEV_WALLET=1 and no real wallet
    const eth = window.ethereum;
    setHasWallet(!!eth);
    if (!eth) return;
    void refreshChain();

    const onAccounts = (...args: unknown[]) => {
      const accs = args[0] as string[];
      setAddress(accs && accs[0] ? (accs[0] as `0x${string}`) : null);
    };
    const onChain = (...args: unknown[]) => setChainId(parseInt(args[0] as string, 16));
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [refreshChain]);

  const value: WalletState = {
    address,
    chainId,
    isConnected: !!address,
    wrongNetwork: !!address && chainId !== chain.id,
    hasWallet,
    connecting,
    connect,
    disconnect,
    switchNetwork,
    switchToChain,
    walletClient,
    publicClient,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
