# BountyAgent — internal security audit

**Date:** 2026-09-25 · **Scope:** the full repo and the **live Arc mainnet
deployment** (chain 5042) · **Method:** manual code review, on-chain state
verification, bytecode-vs-source matching, full test + static-analysis review.

> This is a self-audit by the build. It is **not** a substitute for an
> independent third-party audit before scaling beyond the beta caps. The
> in-contract caps (100 USDC/bounty, 30-day deadlines, no admin) exist precisely
> to bound risk until such a review is done.

## Verdict

**No critical or high-severity vulnerability that can lose user funds was
found.** The engine has no admin, no pause and no upgrade path; every payout
follows checks-effects-interactions under a reentrancy guard; the escrow
conserves exactly. The live mainnet deployment matches the audited source
**byte-for-byte**, and the on-chain escrow invariant holds. Findings are
operational/provenance (key hygiene) and informational.

## What was verified

### 1. Integrity
- Local working tree is level with `origin/main`; no uncommitted logic changes.
- **No secret is committed.** `.env`, `worker/.env`, `web/.env.local` are all
  gitignored; the broadcast logs contain only public tx hashes/calldata (Foundry
  never writes keys); the key pasted in chat this session is not in the repo.
- **Deployed bytecode == repo source, for every mainnet contract** (built
  locally and compared):
  - `BountyEngine` — identical after normalising the `owner` immutable (0 body diff).
  - `VerifierEvaluator` — identical.
  - `PreimageVerifier`, `BackdoorVerifier`, `TestVectorVerifier`, `PopcountReference` — exact.
  - `AgenticCommerce` implementation — identical apart from the UUPS `__self`
    immutable (its own address), which is correct.

### 2. Live on-chain state (Arc mainnet, chain 5042)
- `BountyEngine` `0x9A7a66fc35b9237FD88E7f9fccC82A830eF90Ade`: `owner` = deployer,
  ERC-8004 registries = the canonical `0x8004A169…` / `0x8004BAa1…`, `MAX_REWARD`
  = 100 USDC.
- `owner()` gates **nothing** (only an immutable + constructor assignment). A
  compromised owner key cannot touch funds.
- `AgenticCommerce` proxy `0x6e5fBdaf…`: **both admin roles renounced**,
  `platformFeeBP` = 0, `evaluatorFeeBP` = 0, payment token = USDC, implementation
  `0x52fe87…`. With `DEFAULT_ADMIN_ROLE` renounced, `_authorizeUpgrade` can never
  pass → **non-upgradeable**; no hook can be whitelisted.
- `VerifierEvaluator` `0xdBAdd9Ec…` points at the proxy.
- **Escrow invariant holds:** engine balance (0.02 USDC) == the sum of open-task
  remaining escrow (two open bounties × 0.01). Two bounties completed and paid,
  two open with escrow intact.
- **End-to-end works on mainnet:** the hosted agent (`0x3Df8…3718`, ERC-8004
  #223) solved two verified bounties and was auto-paid, and the engine wrote both
  wins to the ERC-8004 reputation registry (`getSummary` = 2 verified wins).

### 3. Contract logic (`BountyEngine`)
- **CEI + reentrancy:** in `_payWinner`, all state (`hasWon`, `paidCount`,
  `status`, `settledBlock`, winners) is written before the external calls
  (`_recordReputation`, then `_pay`). `completeTask`, `revealAndClaim`,
  `cancelTask`, `reclaimExpired`, `finalizeTask` are all `nonReentrant`.
- **Reputation cannot block or hijack a payout:** the identity/reputation
  registries are `immutable` (the canonical contracts, not attacker-controlled);
  each call is gas-capped and `try/catch`-wrapped; a payout without the gas
  budget reverts rather than silently dropping the record.
- **Share math conserves:** `reward % maxWinners == 0` is enforced, so
  `reward/maxWinners` is exact and `refund = share × (maxWinners − paidCount)`.
- **Multi-winner anti-copy holds even inside the first-reveal block:** commits
  close the instant `paidCount != 0`, and `commitBlock >= firstPaidBlock` rejects
  a same-block copier.
- **Anti-lockup:** every task must have a 10 min–30 day deadline; verified
  reclaim waits an extra 15-min reveal grace so a committed solver can't be raced.
- **Payment safety:** `_pay` reverts on a failed transfer — a rejecting winner
  only fails its own payout; the task stays open for others (tested).

### 4. Web surface
- **No XSS vector:** no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or
  `new Function`. All user text renders as React nodes; links are built from a
  strict `https://` match with `rel="nofollow ugc noopener noreferrer"`; profile
  links pass https-only validators.
- **`/api/preview` (the one server that fetches user URLs) is SSRF-hardened:**
  https-only, default port, no credentials; the host must resolve only to public
  IPs (private / loopback / link-local / CGNAT / multicast / IPv4-in-IPv6 all
  refused, re-checked on every redirect); 5 s timeout, 512 KB cap, text/html only;
  returns short plain text + an https image URL. Unit-checked with 27 IP cases.
- **`/api/mcp` is read-only** — it never reads a key or signs.

### 5. Tests & static analysis
- 146/146 Foundry tests pass, incl. 9 fork tests against the real ERC-8004
  mainnet registries. Branch coverage: evaluator 100%, TestVectorVerifier 100%,
  engine 98%.
- CI (tests, coverage, Slither, Aderyn) is green on the mainnet commit. Every
  Slither/Aderyn High/Medium is a previously-triaged false positive or
  by-design item (see `SECURITY.md`): `arbitrary-send-eth` (paying the winner is
  the product; state final before the call), `arbitrary-send-erc20` (`from` is
  the job's client, client-only), `weak-prng` (selects test inputs, not money),
  `divide-before-multiply` (exact shares), `reentrancy-no-eth` (hooks
  unreachable — admin renounced), `uninitialized-local` (benign `bool ok` default),
  Aderyn H-1/H-2 (view-call false positives).

## Findings

| # | Severity | Finding | Fund risk | Action |
|---|---|---|---|---|
| F-1 | Medium (provenance/ops) | The mainnet `owner()`/deployer `0xDFE783…` is a key that was handled in plaintext (the testnet `PRIVATE_KEY`; a mainnet key was also pasted in chat this session). | **None** — `owner` has zero privileges and AgenticCommerce admin is renounced. | Treat the pasted key as compromised. Keep only trivial gas in `0xDFE783…`. For clean Tally provenance, ideally register from / redeploy owner as a never-exposed wallet (optional — owner is powerless). |
| F-2 | Low | The agent hot-wallet key (`0x3Df8…`) lives in GitHub Actions secrets and auto-spends on mainnet every 5 min. | Bounded to that wallet's balance (~0.035 USDC). | By design and correctly scoped. Top it up in tiny amounts; never reuse it elsewhere; it can only spend gas and earn — it has no withdrawal power over the engine. |
| F-3 | Low/Info | `spec` / `taskData` length is uncapped. | None — the creator pays the calldata gas (self-limiting). | Consider a length cap in a future engine to keep `getTask` reads cheap. |
| F-4 | Info — **resolved 2026-09-26** | `script/verify.sh`'s automated path is blocked by a Cloudflare challenge on `/api` (see `docs/MAINNET.md`). | None. | Done: all 8 contracts verified manually through the Blockscout web UI (not behind the same challenge) — Standard JSON input, compiler `v0.8.30+commit.73712a01`, constructor args auto-detected. Anyone can now read the source directly on `explorer.arc.io`; this audit had already confirmed bytecode == source independently. |
| F-5 | Info | `GEMINI_API_KEY` is unset on the agent → curated work uses the deterministic analyzer. | None. | Fine. If you add a key, rotate the old one first. |
| F-6 | High (availability) — *found 2026-09-26, after this audit* | The live site's **Mainnet view and hosted MCP were down**: the Vercel `NEXT_PUBLIC_*_MAINNET` values carry an invisible BOM (U+FEFF), and viem's `InvalidAddressError` crashed the page. Saved network choice made it crash on every visit. | **None** — contracts and escrow unaffected; only the website/MCP failed to read them. | Fixed in code (`0da2f3d` sanitizes env addresses; `b766634` builds in the mainnet addresses so env vars are optional). **Not yet live:** the Vercel project isn't connected to GitHub, so a manual `vercel login` + `vercel --prod` is needed, then connect the repo. See `PROJECT_JOURNAL.md` §3.13 and GitHub issue #1. |

## Recommended follow-ups (none block operation at beta caps)
0. ~~Redeploy the website and connect the Vercel project to the GitHub repo~~ —
   **done 2026-09-26** (see GitHub issue #1, closed). Connecting Vercel↔GitHub
   for auto-deploy on push still needs a one-time GitHub authorization from the
   repo owner (blocked on `vercel git connect`: "need admin or write access").
1. Rotate any wallet controlled by the key pasted in chat; move real balances to a fresh wallet.
2. ~~Complete public explorer verification of all eight contracts~~ — **done
   2026-09-26**, see F-4.
3. Before lifting the 100 USDC / 30-day beta caps, get an independent audit.
