import { defineChain, type Chain } from "viem";

/**
 * Arc chains. nativeCurrency.decimals = 18 because USDC is Arc's native gas
 * asset in its 18-decimal view, so `parseEther` correctly encodes `msg.value`.
 */
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" },
  },
  testnet: true,
});

export const arcMainnet = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.arc.io" },
  },
});

export type NetworkId = "testnet" | "mainnet";

export type Verifiers = {
  preimage: `0x${string}`;
  backdoor: `0x${string}`;
  target: `0x${string}`; // VulnerableTarget for the backdoor demo
};

type NetworkConfig = {
  id: NetworkId;
  chain: Chain;
  contract: `0x${string}`;
  verifiers: Verifiers;
  label: string;
  short: string;
  live: boolean;
};

// Addresses. Env overrides win; defaults are the live testnet deploy (2026-09-24).
const ZERO = "0x0000000000000000000000000000000000000000" as `0x${string}`;
const def = (k: string, fallback: string) => (process.env[k] ?? fallback) as `0x${string}`;
const env = (k: string) => (process.env[k] ?? ZERO) as `0x${string}`;

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  testnet: {
    id: "testnet",
    chain: arcTestnet,
    contract: def("NEXT_PUBLIC_CONTRACT_TESTNET", "0x9A7a66fc35b9237FD88E7f9fccC82A830eF90Ade"),
    verifiers: {
      preimage: def("NEXT_PUBLIC_PREIMAGE_TESTNET", "0x8bCa2402420198103d709e2777A4Ca4620f4B9Ee"),
      backdoor: def("NEXT_PUBLIC_BACKDOOR_TESTNET", "0x8F19eCab548AC6c0A3b673a99EDb37eC7F8638ff"),
      target: def("NEXT_PUBLIC_TARGET_TESTNET", "0x78bB16fCca4374FE19B23C1a02258a7eC754f39C"),
    },
    label: "Arc Testnet",
    short: "Testnet",
    live: false,
  },
  mainnet: {
    id: "mainnet",
    chain: arcMainnet,
    contract: env("NEXT_PUBLIC_CONTRACT_MAINNET"),
    verifiers: {
      preimage: env("NEXT_PUBLIC_PREIMAGE_MAINNET"),
      backdoor: env("NEXT_PUBLIC_BACKDOOR_MAINNET"),
      target: env("NEXT_PUBLIC_TARGET_MAINNET"),
    },
    label: "Arc Mainnet",
    short: "Mainnet",
    live: true,
  },
};

// Safe default: testnet, so nobody spends real money by accident.
export const DEFAULT_NETWORK: NetworkId = "testnet";

export function explorerTxUrl(chain: Chain, hash: string) {
  return `${chain.blockExplorers?.default.url}/tx/${hash}`;
}
export function explorerAddrUrl(chain: Chain, addr: string) {
  return `${chain.blockExplorers?.default.url}/address/${addr}`;
}
