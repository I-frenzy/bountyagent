// End-to-end proof of the machine-commerce loop against a deployed BountyEngine.
// Drives all three roles so you can verify a full cycle on Arc in one command:
//
//   CONTRACT_ADDRESS=0x... ARC_NETWORK=testnet \
//   CREATOR_PRIVATE_KEY=0x... AGENT_PRIVATE_KEY=0x... node e2e.js
//
// Prints tx hashes + before/after balances proving the escrow paid the agent.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BOUNTY_ENGINE_ABI } from "./abi.js";
import { doWork } from "./analyzer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const env = readFileSync(join(__dirname, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const CHAINS = {
  testnet: defineChain({
    id: 5042002,
    name: "Arc Testnet",
    nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
    blockExplorers: { default: { name: "Arc", url: "https://explorer.testnet.arc.io" } },
    testnet: true,
  }),
  mainnet: defineChain({
    id: 5042,
    name: "Arc",
    nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
    blockExplorers: { default: { name: "Arc", url: "https://explorer.arc.io" } },
  }),
};

const chain = CHAINS[(process.env.ARC_NETWORK || "testnet").toLowerCase()];
const CONTRACT = process.env.CONTRACT_ADDRESS;
const REWARD = process.env.REWARD || "0.25";
if (!CONTRACT) throw new Error("Set CONTRACT_ADDRESS");
const creatorKey = need("CREATOR_PRIVATE_KEY");
const agentKey = need("AGENT_PRIVATE_KEY");

function need(k) {
  const v = process.env[k];
  if (!v) throw new Error(`Set ${k}`);
  return v.startsWith("0x") ? v : `0x${v}`;
}

const creator = privateKeyToAccount(creatorKey);
const agent = privateKeyToAccount(agentKey);
const pub = createPublicClient({ chain, transport: http() });
const creatorWallet = createWalletClient({ account: creator, chain, transport: http() });
const agentWallet = createWalletClient({ account: agent, chain, transport: http() });

const tx = (h) => `${chain.blockExplorers.default.url}/tx/${h}`;

async function main() {
  console.log(`E2E on ${chain.name} · contract ${CONTRACT}`);
  console.log(`creator ${creator.address}`);
  console.log(`agent   ${agent.address}`);
  const agentBefore = await pub.getBalance({ address: agent.address });
  console.log(`agent balance before: ${formatEther(agentBefore)} USDC\n`);

  // 1) create
  const spec = "Audit: function withdraw(){ (bool ok,)=msg.sender.call{value:bal[msg.sender]}(''); require(ok); bal[msg.sender]=0; }";
  console.log(`1) createTask  (${REWARD} USDC)…`);
  let hash = await creatorWallet.writeContract({
    address: CONTRACT,
    abi: BOUNTY_ENGINE_ABI,
    functionName: "createTask",
    args: [spec, "0x0000000000000000000000000000000000000000", BigInt(Math.floor(Date.now() / 1000) + 3600)],
    value: parseEther(REWARD),
  });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`   ${tx(hash)}`);
  const taskId = await pub.readContract({
    address: CONTRACT,
    abi: BOUNTY_ENGINE_ABI,
    functionName: "taskCount",
  });
  console.log(`   task #${taskId}`);

  // 2) agent works + submits
  console.log(`2) agent works off-chain + submitResult…`);
  const result = await doWork(spec);
  hash = await agentWallet.writeContract({
    address: CONTRACT,
    abi: BOUNTY_ENGINE_ABI,
    functionName: "submitResult",
    args: [taskId, result],
  });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`   ${tx(hash)}`);

  // 3) creator (=validator) completes -> pays agent
  console.log(`3) completeTask → pay agent…`);
  hash = await creatorWallet.writeContract({
    address: CONTRACT,
    abi: BOUNTY_ENGINE_ABI,
    functionName: "completeTask",
    args: [taskId, agent.address],
  });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`   ${tx(hash)}`);

  const agentAfter = await pub.getBalance({ address: agent.address });
  const delta = agentAfter - agentBefore;
  console.log(`\nagent balance after: ${formatEther(agentAfter)} USDC`);
  console.log(`net to agent (reward − gas): ${formatEther(delta)} USDC`);
  console.log(delta > 0n ? "✓ agent earned USDC autonomously." : "⚠ net negative (gas > reward on this run).");
}

main().catch((e) => {
  console.error(e.shortMessage || e.message);
  process.exit(1);
});
