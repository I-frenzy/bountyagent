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

type NetworkConfig = {
  id: NetworkId;
  chain: Chain;
  contract: `0x${string}`;
  label: string;
  short: string;
  live: boolean;
};

// BountyEngine addresses. Env overrides win; defaults are filled after deploy.
const ZERO = "0x0000000000000000000000000000000000000000";
const TESTNET_CONTRACT = (process.env.NEXT_PUBLIC_CONTRACT_TESTNET ?? ZERO) as `0x${string}`;
const MAINNET_CONTRACT = (process.env.NEXT_PUBLIC_CONTRACT_MAINNET ?? ZERO) as `0x${string}`;

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  testnet: {
    id: "testnet",
    chain: arcTestnet,
    contract: TESTNET_CONTRACT,
    label: "Arc Testnet",
    short: "Testnet",
    live: false,
  },
  mainnet: {
    id: "mainnet",
    chain: arcMainnet,
    contract: MAINNET_CONTRACT,
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
