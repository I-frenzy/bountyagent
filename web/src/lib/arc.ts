import { defineChain, type Chain } from "viem";

// Multicall3 at its standard address (verified on Arc testnet and mainnet), so
// viem batches the board's many reads into one call and avoids RPC rate limits.
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

// Dev only: a local anvil chain for testing UI flows end to end. Never on in
// production — enabled by NEXT_PUBLIC_DEV_LOCAL=1 in web/.env.development.local.
export const DEV_LOCAL = process.env.NEXT_PUBLIC_DEV_LOCAL === "1";

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
  contracts: { multicall3: { address: MULTICALL3 } },
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
  contracts: { multicall3: { address: MULTICALL3 } },
});

export const arcLocal = defineChain({
  id: 31337,
  name: "Local (anvil)",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  contracts: { multicall3: { address: MULTICALL3 } },
  testnet: true,
});

export type NetworkId = "testnet" | "mainnet" | "local";

export type Extras = {
  testVector: `0x${string}`;
  popcountReference: `0x${string}`;
  evaluator: `0x${string}`; // VerifierEvaluator (ERC-8183)
  commerce: `0x${string}`; // the ERC-8183 AgenticCommerce it evaluates for
};

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
  /// ERC-8004 registries (profiles + reputation). Zero = not available.
  erc8004: { identity: `0x${string}`; reputation: `0x${string}` };
  /// Implementation bounties + the ERC-8183 evaluator. Zero = not deployed here.
  extras: Extras;
  label: string;
  short: string;
  live: boolean;
};

// Addresses. Env overrides win; testnet falls back to the live deploy (2026-09-25, deployments/arc-testnet.json).
// Each variable must be read as a literal `process.env.NEXT_PUBLIC_…` so Next.js
// inlines it into the browser bundle — a dynamic `process.env[name]` lookup is
// undefined client-side (it silently disabled every override before).
const ZERO = "0x0000000000000000000000000000000000000000" as `0x${string}`;
const addr = (value: string | undefined, fallback: string = ZERO) => (value || fallback) as `0x${string}`;

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  testnet: {
    id: "testnet",
    chain: arcTestnet,
    contract: addr(process.env.NEXT_PUBLIC_CONTRACT_TESTNET, "0x6f525E678aEf9088c0b5eA227FAaed850E206D08"),
    verifiers: {
      preimage: addr(process.env.NEXT_PUBLIC_PREIMAGE_TESTNET, "0xeB3389D66b6D6fDF0e674b33A77B6d20bca19a05"),
      backdoor: addr(process.env.NEXT_PUBLIC_BACKDOOR_TESTNET, "0xF0703618D8BDe4B20260538543e36C08d1a78Ea9"),
      target: addr(process.env.NEXT_PUBLIC_TARGET_TESTNET, "0x6f1EeEc22E7D9024C63474175ED1355ee77C9492"),
    },
    erc8004: {
      identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    },
    extras: {
      testVector: addr(process.env.NEXT_PUBLIC_TESTVECTOR_TESTNET, "0x1952Bb6EebbA7D029EA3cf3e8427afA31dC1911A"),
      popcountReference: addr(process.env.NEXT_PUBLIC_POPCOUNT_TESTNET, "0x5cD597906B6705ea8698Cd3e8769C216240838a3"),
      evaluator: addr(process.env.NEXT_PUBLIC_EVALUATOR_TESTNET, "0x382B40F21c4A278a2e7d156d6310D7389ca71C58"),
      commerce: addr(process.env.NEXT_PUBLIC_COMMERCE_TESTNET, "0x0747EEf0706327138c69792bF28Cd525089e4583"),
    },
    label: "Arc Testnet",
    short: "Testnet",
    live: false,
  },
  local: {
    id: "local",
    chain: arcLocal,
    contract: addr(process.env.NEXT_PUBLIC_CONTRACT_LOCAL),
    verifiers: {
      preimage: addr(process.env.NEXT_PUBLIC_PREIMAGE_LOCAL),
      backdoor: addr(process.env.NEXT_PUBLIC_BACKDOOR_LOCAL),
      target: addr(process.env.NEXT_PUBLIC_TARGET_LOCAL),
    },
    erc8004: {
      identity: addr(process.env.NEXT_PUBLIC_IDENTITY_LOCAL),
      reputation: addr(process.env.NEXT_PUBLIC_REPUTATION_LOCAL),
    },
    extras: {
      testVector: addr(process.env.NEXT_PUBLIC_TESTVECTOR_LOCAL),
      popcountReference: addr(process.env.NEXT_PUBLIC_POPCOUNT_LOCAL),
      evaluator: addr(process.env.NEXT_PUBLIC_EVALUATOR_LOCAL),
      commerce: addr(process.env.NEXT_PUBLIC_COMMERCE_LOCAL),
    },
    label: "Local",
    short: "Local",
    live: false,
  },
  mainnet: {
    id: "mainnet",
    chain: arcMainnet,
    contract: addr(process.env.NEXT_PUBLIC_CONTRACT_MAINNET),
    verifiers: {
      preimage: addr(process.env.NEXT_PUBLIC_PREIMAGE_MAINNET),
      backdoor: addr(process.env.NEXT_PUBLIC_BACKDOOR_MAINNET),
      target: addr(process.env.NEXT_PUBLIC_TARGET_MAINNET),
    },
    erc8004: {
      identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
      reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
    },
    extras: {
      testVector: addr(process.env.NEXT_PUBLIC_TESTVECTOR_MAINNET),
      popcountReference: addr(process.env.NEXT_PUBLIC_POPCOUNT_MAINNET),
      evaluator: addr(process.env.NEXT_PUBLIC_EVALUATOR_MAINNET),
      commerce: addr(process.env.NEXT_PUBLIC_COMMERCE_MAINNET),
    },
    label: "Arc Mainnet",
    short: "Mainnet",
    live: true,
  },
};

// Safe default: testnet, so nobody spends real money by accident.
export const DEFAULT_NETWORK: NetworkId = DEV_LOCAL ? "local" : "testnet";

export function explorerTxUrl(chain: Chain, hash: string) {
  return `${chain.blockExplorers?.default.url}/tx/${hash}`;
}
export function explorerAddrUrl(chain: Chain, addr: string) {
  return `${chain.blockExplorers?.default.url}/address/${addr}`;
}
