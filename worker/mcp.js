#!/usr/bin/env node
// BountyAgent MCP server (stdio) — lets any MCP-capable AI agent (Claude
// Desktop, Claude Code, …) find bounties on Arc, check answers for free, and
// get paid in USDC. Signing happens here, locally, with the owner's own key;
// the key never leaves this machine.
//
//   Claude Code:  claude mcp add bountyagent -e WORKER_PRIVATE_KEY=0x… -- node /path/to/bountyagent/worker/mcp.js
//   Claude Desktop (claude_desktop_config.json):
//     { "mcpServers": { "bountyagent": { "command": "node",
//         "args": ["/path/to/bountyagent/worker/mcp.js"],
//         "env": { "WORKER_PRIVATE_KEY": "0x…", "ARC_NETWORK": "testnet" } } } }
//
// Without a key the server still works read-only (browse + check answers).
import { createInterface } from "node:readline";
import { decodeAbiParameters, encodeAbiParameters, formatEther, isAddress, isHex, stringToHex } from "viem";
import { MODE } from "./abi.js";
import {
  CONTRACT,
  account,
  chain,
  commitAndReveal,
  describe,
  listTasks,
  publicClient,
  read,
  skipReason,
  submitWork,
  txUrl,
  work,
} from "./core.js";

const VERIFY_ABI = [
  {
    type: "function",
    name: "verify",
    stateMutability: "view",
    inputs: [
      { name: "taskData", type: "bytes" },
      { name: "answer", type: "bytes" },
      { name: "solver", type: "address" },
      { name: "commitBlock", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
];

const SERVER_INFO = { name: "bountyagent", version: "1.0.0" };
const INSTRUCTIONS = `BountyAgent is a bounty market on Arc (USDC). Bounties are either "verified" — a contract checks the answer and pays automatically — or "curated" — the poster reads submissions and pays the ones they choose.
To earn: list_bounties → get_bounty → for verified ones, check_answer until it returns true (free), then solve_verified (commit, wait a block, reveal: paid in the same transaction); for curated ones, do the work and submit_work. Respect bounties labelled "people". Network: ${chain.name}, contract ${CONTRACT}.`;

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

function encodeAnswer(answer, type = "text") {
  switch (type) {
    case "text":
      return stringToHex(String(answer));
    case "uint256":
      return encodeAbiParameters([{ type: "uint256" }], [BigInt(answer)]);
    case "address":
      if (!isAddress(answer)) throw new Error("answer is not an address");
      return encodeAbiParameters([{ type: "address" }], [answer]);
    case "hex":
      if (!isHex(answer)) throw new Error("answer is not 0x-hex");
      return answer;
    default:
      throw new Error(`unknown answer_type "${type}"`);
  }
}

/** What a solver needs to know about a verified bounty's parameters. */
function hints(t) {
  const d = describe(0n, t);
  try {
    if (d.challenge === "preimage") {
      const [hash] = decodeAbiParameters([{ type: "bytes32" }], t.taskData);
      return { check: "keccak256(answer bytes) == targetHash", targetHash: hash, answer_type: "text" };
    }
    if (d.challenge === "backdoor") {
      const [target, maxInput] = decodeAbiParameters([{ type: "address" }, { type: "uint256" }], t.taskData);
      return { check: "answer <= maxInput && target.check(answer) == true", target, maxInput: maxInput.toString(), answer_type: "uint256" };
    }
    if (d.challenge === "testvector") {
      return {
        check: "a pure contract you deploy must match the reference on fixed + fresh random inputs within the gas budget",
        answer_type: "address",
        note: "Commit to your contract's address BEFORE deploying it (predict it from your nonce), then deploy, then reveal. Compile without CBOR metadata.",
      };
    }
  } catch {
    /* unknown encoding */
  }
  return { check: "see the verifier contract", answer_type: "hex" };
}

const TOOLS = [
  {
    name: "list_bounties",
    description: "List bounties on BountyAgent (Arc). Returns id, mode (verified/curated), audience, brief, reward and share per winner in USDC, deadline.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "completed", "all"], default: "open" },
        mode: { type: "string", enum: ["verified", "curated"], description: "optional filter" },
      },
    },
    run: async ({ status = "open", mode } = {}) => {
      const rows = (await listTasks({ status })).map(({ id, t }) => describe(id, t));
      return rows.filter((r) => !mode || r.mode === mode).map(({ taskData, ...r }) => r);
    },
  },
  {
    name: "get_bounty",
    description: "Full details of one bounty: the brief, how the answer is checked (verified) or the submissions so far (curated), winners, and whether this agent can take it.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: async ({ id }) => {
      const tid = BigInt(id);
      const [t, subs, winners] = await Promise.all([read("getTask", [tid]), read("getSubmissions", [tid]), read("getWinners", [tid])]);
      if (/^0x0+$/.test(t.creator)) throw new Error(`no bounty #${id}`);
      const d = describe(tid, t);
      return {
        ...d,
        ...(d.mode === "verified" ? { howItIsChecked: hints(t) } : { submissions: subs.map((s) => ({ by: s.agent, text: s.resultURI })) }),
        winnersSoFar: winners,
        canTake: account ? ((await skipReason(tid, t)) ?? "yes") : "no key configured (read-only)",
        receipt: `https://bountyagent.vercel.app/task/${id}`,
      };
    },
  },
  {
    name: "check_answer",
    description: "Ask the bounty's verifier contract whether an answer would pass — a free read, no transaction. Use before solve_verified.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        answer: { type: "string", description: "the answer" },
        answer_type: { type: "string", enum: ["text", "uint256", "address", "hex"], default: "text" },
      },
      required: ["id", "answer"],
    },
    run: async ({ id, answer, answer_type = "text" }) => {
      const t = await read("getTask", [BigInt(id)]);
      if (Number(t.mode) !== MODE.Verified) throw new Error("not a verified bounty");
      const encoded = encodeAnswer(answer, answer_type);
      const head = await publicClient.getBlockNumber();
      const solver = account?.address ?? "0x000000000000000000000000000000000000dEaD";
      try {
        const ok = await publicClient.readContract({ address: t.verifier, abi: VERIFY_ABI, functionName: "verify", args: [t.taskData, encoded, solver, head - 2n] });
        return { passes: ok };
      } catch (e) {
        return { passes: false, note: `verifier reverted: ${e.shortMessage || e.message}` };
      }
    },
  },
  {
    name: "solve_verified",
    description: "Win a verified bounty: commit the answer, wait a block, reveal. If it passes, the contract pays this agent in the same transaction. Costs a little USDC gas. Check with check_answer first.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        answer: { type: "string" },
        answer_type: { type: "string", enum: ["text", "uint256", "address", "hex"], default: "text" },
      },
      required: ["id", "answer"],
    },
    run: async ({ id, answer, answer_type = "text" }) => {
      if (!account) throw new Error("no WORKER_PRIVATE_KEY configured");
      const tid = BigInt(id);
      const t = await read("getTask", [tid]);
      const why = await skipReason(tid, t);
      if (why) throw new Error(`can't take #${id}: ${why}`);
      const logs = [];
      const r = await commitAndReveal(tid, encodeAnswer(answer, answer_type), {
        seedBlocks: describe(tid, t).challenge === "testvector" ? 2 : 1,
        log: (l) => logs.push(l.trim()),
      });
      return { paid: true, reveal: txUrl(r.transactionHash), log: logs, receipt: `https://bountyagent.vercel.app/task/${id}` };
    },
  },
  {
    name: "submit_work",
    description: "Submit (or update) your work on a curated bounty: text and/or links. The poster reviews submissions and pays the ones they choose.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, text: { type: "string", description: "your answer, or links to it" } },
      required: ["id", "text"],
    },
    run: async ({ id, text }) => {
      if (!account) throw new Error("no WORKER_PRIVATE_KEY configured");
      const tid = BigInt(id);
      const t = await read("getTask", [tid]);
      if (Number(t.mode) !== MODE.Curated) throw new Error("not a curated bounty — use solve_verified");
      if (describe(tid, t).audience === "people") throw new Error("this bounty is labelled for people, not agents");
      const r = await submitWork(tid, String(text).slice(0, 4000), () => {});
      return { submitted: true, tx: txUrl(r.transactionHash) };
    },
  },
  {
    name: "auto_work",
    description: "Let the built-in reference agent try a bounty with its own solvers (known demo challenges; LLM/heuristic work for curated audits).",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: async ({ id }) => {
      if (!account) throw new Error("no WORKER_PRIVATE_KEY configured");
      const logs = [];
      const outcome = await work(BigInt(id), await read("getTask", [BigInt(id)]), (l) => logs.push(l.trim()));
      return { outcome, log: logs };
    },
  },
  {
    name: "my_status",
    description: "This agent's address, USDC balance, linked ERC-8004 profile id, and network.",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      if (!account) return { readOnly: true, network: chain.name, contract: CONTRACT };
      const [bal, agentId] = await Promise.all([publicClient.getBalance({ address: account.address }), read("agentIdOf", [account.address])]);
      return {
        address: account.address,
        balanceUsdc: formatEther(bal),
        erc8004Profile: agentId === 0n ? null : agentId.toString(),
        profilePage: `https://bountyagent.vercel.app/u/${account.address}`,
        network: chain.name,
        contract: CONTRACT,
      };
    },
  },
];

// ---------------------------------------------------------------------------
// MCP over stdio: newline-delimited JSON-RPC 2.0
// ---------------------------------------------------------------------------

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications (e.g. notifications/initialized)
  try {
    if (method === "initialize") {
      return send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        },
      });
    }
    if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
    if (method === "tools/list") {
      return send({ jsonrpc: "2.0", id, result: { tools: TOOLS.map(({ run, ...t }) => t) } });
    }
    if (method === "tools/call") {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) throw Object.assign(new Error(`unknown tool ${params?.name}`), { code: -32602 });
      try {
        const out = await tool.run(params.arguments ?? {});
        return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: json(out) }] } });
      } catch (e) {
        return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: e.shortMessage || e.message }], isError: true } });
      }
    }
    throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 });
  } catch (e) {
    send({ jsonrpc: "2.0", id, error: { code: e.code ?? -32603, message: e.message } });
  }
}

// stdout is the protocol channel: route any stray logging to stderr.
console.log = (...a) => process.stderr.write(`${a.join(" ")}\n`);
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
  }
  void handle(msg);
});
