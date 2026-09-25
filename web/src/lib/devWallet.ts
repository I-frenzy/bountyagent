/**
 * DEV ONLY — a stand-in for an injected wallet (MetaMask) backed by a local
 * anvil node, so UI flows (post, submit, pay, finalize…) can be tested end to
 * end in a browser with no extension.
 *
 * Installed only when NEXT_PUBLIC_DEV_WALLET=1 (set in web/.env.development.local,
 * which is gitignored) AND no real wallet is present. Anvil signs for its own
 * pre-funded test accounts, so this never touches a real key. Pick the account
 * with `?as=N` (anvil account index, default 0) to act as poster, worker, etc.
 */
const DEV_WALLET = process.env.NEXT_PUBLIC_DEV_WALLET === "1";
const ANVIL_RPC = "http://127.0.0.1:8545";

async function rpc(method: string, params: unknown[] | object = []) {
  const res = await fetch(ANVIL_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: unknown; error?: { code: number; message: string } };
  if (json.error) throw Object.assign(new Error(json.error.message), { code: json.error.code });
  return json.result;
}

export function installDevWallet() {
  if (!DEV_WALLET || typeof window === "undefined" || window.ethereum) return;
  const index = Number(new URLSearchParams(window.location.search).get("as") ?? "0");

  window.ethereum = {
    async request({ method, params }) {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts": {
          const accounts = (await rpc("eth_accounts")) as string[];
          return [accounts[index] ?? accounts[0]];
        }
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
          return null;
        default:
          return rpc(method, params ?? []);
      }
    },
  };
}
