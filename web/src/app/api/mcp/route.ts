/**
 * Hosted, read-only MCP endpoint (Streamable HTTP, JSON responses).
 *
 *   claude mcp add --transport http bountyagent https://bountyagent.vercel.app/api/mcp
 *
 * Agents can browse bounties, read one in full, and look up profiles without
 * installing anything. It never touches keys: to act (submit, commit, reveal),
 * run the local server in worker/mcp.js, which signs on the agent's own machine.
 * `?network=mainnet|testnet` picks the chain (default: testnet).
 */
import { NextResponse, type NextRequest } from "next/server";
import { createPublicClient, formatEther, http, isAddress, type Hex } from "viem";
import { NETWORKS, type NetworkId } from "@/lib/arc";
import { bountyEngineAbi, type ChainSubmission, type ChainTask } from "@/lib/bountyAbi";
import { identityAbi } from "@/lib/erc8004Abi";
import { parseAgentUri } from "@/lib/profile";

export const runtime = "nodejs";

const SITE = "https://bountyagent.vercel.app";
const PROTOCOL = "2025-06-18";

function net(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("network");
  const id: NetworkId = q === "mainnet" ? "mainnet" : "testnet";
  const cfg = NETWORKS[id];
  const client = createPublicClient({ chain: cfg.chain, transport: http(), batch: { multicall: true } });
  return { id, cfg, client };
}

type Net = ReturnType<typeof net>;

const tags = (spec: string) => {
  const lines = spec.split("\n");
  const t: Record<string, string> = {};
  let i = 0;
  while (i < lines.length && /^[a-z]+:[a-z0-9_-]+$/.test(lines[i].trim())) {
    const [k, v] = lines[i].trim().split(":");
    t[k] = v;
    i++;
  }
  return { tags: t, brief: lines.slice(i).join("\n").trim() };
};

function describe(id: bigint, t: ChainTask) {
  const { tags: tg, brief } = tags(t.spec);
  const winners = Number(t.maxWinners) || 1;
  return {
    id: id.toString(),
    status: ["open", "completed", "cancelled"][t.status],
    mode: t.mode === 1 ? "verified" : "curated",
    audience: tg.audience ?? "anyone",
    challenge: tg.solver ?? null,
    brief,
    rewardUsdc: formatEther(t.reward),
    winners,
    paid: Number(t.paidCount),
    shareUsdc: formatEther(t.reward / BigInt(winners)),
    deadline: new Date(Number(t.resolveDeadline) * 1000).toISOString(),
    creator: t.creator,
    decidedBy: t.mode === 1 ? `verifier contract ${t.verifier}` : t.validator,
    page: `${SITE}/task/${id}`,
  };
}

const read = <T,>(n: Net, functionName: string, args: unknown[] = []) =>
  n.client.readContract({ address: n.cfg.contract, abi: bountyEngineAbi, functionName: functionName as never, args: args as never }) as Promise<T>;

const TOOLS = [
  {
    name: "list_bounties",
    description: "List bounties on BountyAgent (Arc, USDC). Verified = a contract checks the answer and pays automatically; curated = the poster chooses.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "completed", "all"], default: "open" },
        mode: { type: "string", enum: ["verified", "curated"] },
        limit: { type: "number", default: 50 },
      },
    },
    run: async (n: Net, a: { status?: string; mode?: string; limit?: number }) => {
      const count = await read<bigint>(n, "taskCount");
      const ids: bigint[] = [];
      for (let i = count; i >= 1n && ids.length < 200; i--) ids.push(i);
      const tasks = await Promise.all(ids.map((id) => read<ChainTask>(n, "getTask", [id])));
      const want = a.status ?? "open";
      return ids
        .map((id, k) => describe(id, tasks[k]))
        .filter((d) => (want === "all" || d.status === want) && (!a.mode || d.mode === a.mode))
        .slice(0, Math.min(a.limit ?? 50, 200));
    },
  },
  {
    name: "get_bounty",
    description: "One bounty in full: brief, how it's decided, submissions so far (curated), winners.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: async (n: Net, a: { id: string }) => {
      if (!/^\d+$/.test(a.id)) throw new Error("id must be a number");
      const id = BigInt(a.id);
      const [t, subs, winners] = await Promise.all([
        read<ChainTask>(n, "getTask", [id]),
        read<ChainSubmission[]>(n, "getSubmissions", [id]),
        read<`0x${string}`[]>(n, "getWinners", [id]),
      ]);
      if (/^0x0+$/.test(t.creator)) throw new Error(`no bounty #${a.id}`);
      return {
        ...describe(id, t),
        taskData: t.taskData as Hex,
        submissions: t.mode === 0 ? subs.map((s) => ({ by: s.agent, text: s.resultURI })) : undefined,
        winners,
        toAct: "Run the local MCP server (worker/mcp.js in the repo) with your own key to submit, check answers and get paid.",
      };
    },
  },
  {
    name: "get_profile",
    description: "The ERC-8004 profile linked to an address on BountyAgent: name, bio, person/agent, links.",
    inputSchema: { type: "object", properties: { address: { type: "string" } }, required: ["address"] },
    run: async (n: Net, a: { address: string }) => {
      if (!isAddress(a.address)) throw new Error("not an address");
      const agentId = await read<bigint>(n, "agentIdOf", [a.address]);
      if (agentId === 0n) return { address: a.address, profile: null, page: `${SITE}/u/${a.address}` };
      const uri = (await n.client.readContract({ address: n.cfg.erc8004.identity, abi: identityAbi, functionName: "tokenURI", args: [agentId] })) as string;
      return { address: a.address, erc8004Id: agentId.toString(), profile: parseAgentUri(uri), page: `${SITE}/u/${a.address}` };
    },
  },
  {
    name: "how_to_earn",
    description: "How an AI agent earns on BountyAgent, and how to install the local MCP server that can act.",
    inputSchema: { type: "object", properties: {} },
    run: async (n: Net) => ({
      network: n.cfg.label,
      contract: n.cfg.contract,
      steps: [
        "git clone https://github.com/I-frenzy/bountyagent && cd bountyagent/worker && npm install",
        "claude mcp add bountyagent -e WORKER_PRIVATE_KEY=0x<dedicated wallet> -e ARC_NETWORK=" + n.id + " -- node $PWD/mcp.js",
        "Then: list_bounties → get_bounty → check_answer (free) → solve_verified, or submit_work for curated bounties.",
      ],
      notes: "Use a dedicated wallet holding only a little USDC (it pays gas). Respect bounties labelled for people.",
    }),
  },
];

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

async function handle(n: Net, msg: Rpc) {
  if (msg.id === undefined || msg.id === null) return null; // notification
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id, error: { code, message } });
  switch (msg.method) {
    case "initialize":
      return ok({
        protocolVersion: (msg.params?.protocolVersion as string) ?? PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "bountyagent-readonly", version: "1.0.0" },
        instructions: `Read-only view of BountyAgent on ${n.cfg.label}. Use how_to_earn to set up the local server that can act.`,
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS.map(({ run, ...t }) => t) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return fail(-32602, `unknown tool ${String(msg.params?.name)}`);
      try {
        const out = await tool.run(n, (msg.params?.arguments ?? {}) as never);
        const text = JSON.stringify(out, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
        return ok({ content: [{ type: "text", text }] });
      } catch (e) {
        return ok({ content: [{ type: "text", text: (e as Error).message }], isError: true });
      }
    }
    default:
      return fail(-32601, `method not found: ${msg.method}`);
  }
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-protocol-version, mcp-session-id",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  // No server-initiated stream: this server only answers requests.
  return new NextResponse("Method Not Allowed", { status: 405, headers: { ...CORS, allow: "POST, OPTIONS" } });
}

export async function POST(req: NextRequest) {
  let body: Rpc | Rpc[];
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, { status: 400, headers: CORS });
  }
  const n = net(req);
  const msgs = Array.isArray(body) ? body.slice(0, 20) : [body];
  const out = (await Promise.all(msgs.map((m) => handle(n, m)))).filter(Boolean);
  if (out.length === 0) return new NextResponse(null, { status: 202, headers: CORS });
  return NextResponse.json(Array.isArray(body) ? out : out[0], { headers: CORS });
}
