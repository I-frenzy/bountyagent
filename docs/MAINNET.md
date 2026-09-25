# Mainnet launch runbook

Everything below has been rehearsed on Arc testnet (see
`deployments/arc-testnet-rehearsal.json`). The steps marked **You** need your
own wallet or accounts; nothing here ever needs a key to be pasted anywhere
except your own terminal.

**Budget:** about **$20–30 USDC** on Arc mainnet — deploy ≈ $0.25, a small
rehearsal ≈ $1 (most of it moves between your two wallets), the rest seeds the
launch bounties. Hosting is free.

---

## 0 · Before you start

- [ ] **You:** two wallets on Arc mainnet
  - **Deployer** — your own, owner-attributable wallet (it becomes the
    engine's `owner()` for Tally provenance; it has no power over funds).
    ~$25 USDC.
  - **Agent** — a *new*, dedicated hot wallet for the reference agent. ~$2 USDC.
- [ ] **You:** get USDC onto Arc (bridge from another chain with Circle's
  CCTP/Gateway, or withdraw from an exchange that supports Arc).
- [ ] Move the throwaway testnet key out of the way, so it can't be used by
  accident: `mv .env .env.testnet` (the deploy script also refuses an env key
  on mainnet by default).

## 1 · Import your deployer key into an encrypted keystore (**You**)

```bash
cast wallet import deployer --interactive      # paste key once; set a password
cast wallet address --account deployer         # check it's the right address
```
A Ledger works too: use `--ledger --sender <address>` instead of `--account deployer`.

## 2 · Dry run against real mainnet state

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url https://rpc.mainnet.arc.io \
  --account deployer --sender $(cast wallet address --account deployer)
```
Should end with `Script ran successfully` and `dry run: deployments file not written`.

## 3 · Deploy (**You** confirm)

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url https://rpc.mainnet.arc.io \
  --account deployer --sender $(cast wallet address --account deployer) --broadcast --slow
```
This deploys the engine, the three verifiers, the demo targets, **our own
admin-less ERC-8183 `AgenticCommerce`** (Arc mainnet has none — every admin role
is renounced in the same script) and the `VerifierEvaluator`, and writes
`deployments/arc-mainnet.json`.

Check the ERC-8183 instance really has no admin:
```bash
C=$(node -e "console.log(require('./deployments/arc-mainnet.json').contracts.AgenticCommerce)")
cast call $C "hasRole(bytes32,address)(bool)" 0x0000000000000000000000000000000000000000000000000000000000000000 $(cast wallet address --account deployer) --rpc-url https://rpc.mainnet.arc.io   # false
```

## 4 · Verify the source on the explorer

```bash
script/verify.sh mainnet
```
No API key needed (Blockscout). If it says "Too many requests", wait for the
reset and run it again — verified contracts are skipped.

**Known issue (confirmed 2026-09-25, twice, on every contract):** `explorer.arc.io`
puts its `/api` behind a Cloudflare *managed* JS challenge. `forge`'s HTTP client
can't execute the challenge, so automated verification fails every time with
"failed (rate limit? rerun later)" — it is not actually a rate limit, and
re-running `verify.sh` won't fix it. Verify manually instead, from a real
browser session on the Blockscout UI (`explorer.arc.io` → the contract's
address → *Verify & Publish*): pick **Solidity (single file / standard-json)**,
paste the source from `src/…`, and supply the constructor args `verify.sh`
already computes (read the script — each `verify()` call prints the exact
`cast abi-encode` args it would have sent). Retry the script periodically in
case Arc loosens its WAF rules later.

## 5 · Rehearse on mainnet with tiny amounts

```bash
cd worker && npm install
CREATOR_KEY=<deployer key> WORKER_PRIVATE_KEY=<agent key> ARC_NETWORK=mainnet node rehearsal.js
```
Runs every flow for real (profile, poster-decided, code-checked, multi-winner,
implementation, ERC-8183 job, cancel) and saves
`deployments/arc-mainnet-rehearsal.json` — the launch-gate evidence. Commit both
deployments files.

## 6 · Point the website at mainnet (**You**)

The live mainnet addresses are built into `web/src/lib/arc.ts` as fallbacks, so
these variables are **optional** — set them only to point the site at a
different deployment. If you do, type the values in (don't pipe them through
Windows PowerShell, which prepends an invisible BOM); `addr()` strips stray
whitespace/BOMs and ignores anything that isn't a 20-byte hex address.

In Vercel → project `bountyagent` → Settings → Environment Variables (Production),
the optional overrides are:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_CONTRACT_MAINNET` | `contracts.BountyEngine` |
| `NEXT_PUBLIC_PREIMAGE_MAINNET` | `contracts.PreimageVerifier` |
| `NEXT_PUBLIC_BACKDOOR_MAINNET` | `contracts.BackdoorVerifier` |
| `NEXT_PUBLIC_TARGET_MAINNET` | `contracts.VulnerableTarget` |
| `NEXT_PUBLIC_TESTVECTOR_MAINNET` | `contracts.TestVectorVerifier` |
| `NEXT_PUBLIC_POPCOUNT_MAINNET` | `contracts.PopcountReference` |
| `NEXT_PUBLIC_EVALUATOR_MAINNET` | `contracts.VerifierEvaluator` |
| `NEXT_PUBLIC_COMMERCE_MAINNET` | `contracts.AgenticCommerce` |

Then deploy: `cd web && vercel login && vercel --prod` (the CLI login on this
machine has expired). Open the site, switch to **Mainnet**, and check the board
shows the rehearsal bounties.

**The Vercel project is not connected to GitHub** (as of 2026-09-26): pushing
to `main` does not update the site; only `vercel --prod` does. Connect it once
in Vercel → project `bountyagent` → Settings → Git → `I-frenzy/bountyagent`,
production branch `main`, root directory `web`. After that, every push deploys.

## 7 · Register on Tally (**You**)

Register the engine on the Tally provenance registry
(`0x459Cab32306c439a408cA6b8672CcF6c6A0536d9`, Arc mainnet) from the deployer
wallet, as with Tally's other entries, so it shows `OWNER_PROVEN`.

## 8 · Turn on the reference agent (**You**)

GitHub → `I-frenzy/bountyagent` → Settings → Secrets and variables → Actions:
- secret `WORKER_PRIVATE_KEY` = the agent wallet's key
- variable `ARC_NETWORK` = `mainnet`
- optional secret `GEMINI_API_KEY` (rotate the old one first)

`.github/workflows/agent.yml` then runs one pass every ~5 minutes, free.

## 9 · Seed the launch bounties

Post 10–15 small bounties from the site (Mainnet): a few code-checked demos, one
**implementation** bounty ("popcount under 3,000 gas"), a couple of
poster-decided audits, and 2–3 **For people** bounties (translation, feedback ×5)
to show people mode. Share the `/task/[id]` receipts.

## 10 · Submit

Use `docs/SUBMISSION.md` (fill in the mainnet addresses and links).
