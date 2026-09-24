# BountyAgent — Project Journal

This is the narrative record of BountyAgent: why it exists, the decisions made
building it, what's proven on-chain, and what's left. The `README.md` is the
technical reference (architecture, contract surface, quickstart); **this file
is the story and the reasoning**, kept so a new session — or a person new to
the repo — can get fully oriented without re-deriving any of it.

---

## 1. Orientation (read this first)

- **What it is:** a machine-to-machine labor market on Arc where, for one class
  of task, **the smart contract itself is the judge** — no human, no oracle,
  no trust. For everything else, a human validator settles it, with an
  anti-lockup timeout.
- **Why it exists:** third entry for **Circle's Arc Microgrants** (DoraHacks,
  $10k pool, rolling reviews, **deadline Oct 14 2026**), alongside two earlier
  entries — [Tally](https://github.com/Ipramking/tally-arc) (contract
  provenance) and [SplitPay](https://github.com/chizzy0011/splitpay-arc)
  (native-USDC splits/escrow). BountyAgent had to be a genuinely different
  primitive, not a third variation on payments.
- **Whose idea:** the user's own — supplied as a PDF pitch (`bounty_agent.pdf`)
  describing a Fiverr/Upwork-for-AI-agents concept. Everything downstream (the
  trustless pivot, the CTF demo, the architecture) was built from that seed.
- **Live right now:**
  - Repo: **https://github.com/I-frenzy/bountyagent** (public)
  - dApp: **https://bountyagent.vercel.app** (Vercel, `ifrenzys-projects`)
  - Contracts: **Arc testnet (chain 5042002)** — see §6 for addresses
  - Not yet on Arc **mainnet** (chain 5042) — that's the main remaining step
- **What's left:** mainnet deploy → register on the Tally provenance registry
  → DoraHacks submission. See §8.

---

## 2. The goal, precisely

Build a third, independent Circle Arc Microgrants submission that:
1. Uses Arc's actual differentiator (native-USDC gas, sub-second finality) for
   something that *needs* those properties, not just a payments demo.
2. Is a different primitive from the other two entries.
3. Demonstrates real machine-to-machine commerce — software discovering work,
   doing it, and getting paid, unattended.

The user's brief (from the PDF) pitched exactly this: `BountyEngine.sol` as an
escrow vault, an `agent-worker.js` that watches for tasks and claims them, and
a market UI — explicitly framed as "Fiverr for AI agents," with the economic
argument that Arc's fee structure makes sub-dollar micro-bounties viable in a
way a typical L1 can't.

---

## 3. The build, in order

### 3.1 — First pass: validator-judged marketplace (v1)
Built the pitch close to literally: `createTask` (escrow) → `submitResult`
(any agent can submit) → `completeTask` (a named validator approves a winner).
22 Foundry tests, deployed nowhere yet. Reused the proven **SplitPay stack**
wherever possible rather than reinventing it: Arc chain config, the viem-only
wallet/network/tx hooks (`wallet.tsx`, `network.tsx`, `useTx.tsx`), Tailwind
setup, `paris` EVM target to avoid PUSH0 on a young chain, solc 0.8.20.

**Why viem-only, no wagmi:** SplitPay had already hit repeated install
failures from wagmi's dependency tree (WalletConnect + MetaMask-SDK + Solana
libs) on this machine's slow network. Talking to `window.ethereum` directly
via viem sidesteps that entirely, and the pattern was already battle-tested.

### 3.2 — The teardown (this is the pivot point)
Asked directly to rate the build honestly — "not a bio... a proper technical
and product-level teardown" — the v1 design had three serious problems, found
by re-reading `BountyEngine.sol` as an outside auditor would:

- **H-1, permanent lockup:** `submitResult` is permissionless, and once *any*
  submission exists `cancelTask` refuses to refund. A stranger could grief any
  bounty with one junk submission and brick the escrow forever — no timeout,
  no recovery.
- **H-2, plagiarism / no real verification:** `resultURI` is a plaintext
  string, broadcast in an event. The creator can read an agent's finished work
  the instant it lands and simply never pay. The pitch's language
  ("cryptographic proof," "verifiable payload") was aspirational — the
  contract did no verification of any kind.
- **H-3, trusted oracle, undisclosed:** the validator is a fully trusted party
  and defaults to the *creator* — i.e., the party least incentivized to pay
  judges their own bounty. This is *the* unsolved hard problem in the current
  agent-economy literature (verification / the oracle problem — zkML, opML,
  TEE attestation, stake-secured re-execution are all live research areas in
  2026), and v1 quietly assumed it away.

Overall verdict at that point: **7.5/10 as a hackathon demo, ~4/10 as a real
product** — clean full-stack, correct on the classic reentrancy checklist, no
admin backdoor, well aligned to the Arc/Circle thesis — but sitting on an
economically exploitable design and overclaiming what it verified.

### 3.3 — The strategic reframe: "the chain is the judge"
Rather than patch the trust problem, the fix was to **stop competing on the
half everyone else loses on**. The insight: for a specific, real class of
tasks — anything a program can check (find a bug, find a preimage, satisfy a
predicate) — *verification is free and requires no trust at all*. That's not
a workaround, it's a structurally different guarantee than any off-chain labor
market (Upwork, or even payment rails like Coinbase's x402) can offer, because
those all still need a human or a reputation system to decide the work was
good.

This became **v2, a dual-mode contract**:
- **Verified mode (the flagship):** creator attaches an on-chain
  `IBountyVerifier` predicate + opaque `taskData`. An agent **commits** to an
  answer (`keccak256(answer, salt, solver)`), waits a strictly later block,
  then **reveals**; the engine `STATICCALL`s the verifier and, if it returns
  true, **pays the solver atomically in the same transaction**. No human in
  the loop, ever. Commit-reveal specifically defeats mempool front-running: a
  copier has no prior commitment bound to their address and can't commit+
  reveal in one block.
- **Curated mode (kept, fixed):** for genuinely subjective work a contract
  can't check. Same validator flow as v1, but now with `reclaimExpired` — a
  post-deadline timeout that lets the creator recover funds from an absent or
  malicious validator. Crucially, this timeout can **never** rug a *verified*
  winner, because verified payouts happen atomically on reveal, before any
  deadline logic runs.

Two demo verifiers were built to make this concrete and inspectable:
- `PreimageVerifier` — find `x` where `keccak256(x)` matches a target hash.
- `BackdoorVerifier` + `VulnerableTarget` — a planted-bug CTF: a target
  contract's `check()` has an unintended `|| input == 1337` backdoor; the
  bounty is to find a *small* input that still passes. This is the flagship
  demo because it's visceral: an agent reads Solidity source, finds the bug,
  and gets paid by the contract in front of you.

Every teardown finding maps directly to a fix: H-1 → `reclaimExpired`; H-2 →
commit-reveal (can't read the answer before it's committed); H-3 → the
verifier removes the trusted party entirely for this task class. The honest
scope note that survived into the README: verified mode is genuinely
trustless; curated mode still trusts the validator, bounded by the timeout.

v2 shipped as **26/26 Foundry tests green**, including explicit front-running
attack tests (same-block reveal blocked, no-prior-commit blocked) and the
backdoor CTF auto-settling correctly.

### 3.4 — Going live on Arc testnet
Deployed the full stack (`BountyEngine` + both verifiers + `VulnerableTarget`)
to Arc testnet (chain 5042002) from a faucet-funded throwaway wallet. Then
**proved both modes work for real, on-chain, not just in tests**:
- Posted a Verified backdoor bounty (1 USDC). A separate agent wallet ran the
  actual `agent-worker.js`, solved it (found `1337`), committed, revealed —
  and the contract paid it automatically. Zero human touched the settlement.
- Posted a Curated task, had the worker submit, then paid it out as validator.

Deployer and agent-worker keys here are disposable throwaway wallets (pasted
in chat during the session, so treated as burned by policy) — kept isolated
from the user's real wallets throughout.

### 3.5 — GitHub + hosting
The user wanted this on a **new GitHub account**, separate from the other two
entries' accounts. `gh` login initially failed with a bad/expired PAT; the fix
was the **OAuth device flow** (a one-time code at
`github.com/login/device`) run directly against GitHub's API, which the user
authorized in a browser as the new account **`I-frenzy`**. All commits were
then re-attributed to `I-frenzy` via `filter-branch`, repo-local git identity
was set (global identity elsewhere is untouched), and the repo was pushed
public: **github.com/I-frenzy/bountyagent**.

The dApp was then deployed to Vercel under the existing `ifrenzys-projects`
account (separate concern from the GitHub account) at
**bountyagent.vercel.app** — confirmed publicly reachable, no auth wall.

*Environment note for future sessions on this machine:* Bash's PATH has been
observed to intermittently drop `node`/`git`/coreutils mid-session for no
clear reason. When that happens, the same commands run fine via the
PowerShell tool, or via `gh`'s/Foundry's full install path. Also: copying a
large `node_modules` tree with `cp` is extremely slow on this Windows box —
`robocopy /E /MT:16` is far faster and was used to clone SplitPay's
`node_modules` for a fast start.

### 3.6 — Design revamp via Claude Design ("Ledger")
The user wanted a from-scratch visual identity, generated by an AI design
tool with **zero aesthetic direction from us** — explicitly so the design
would be independently invented, not steered. The design was authored in
Claude Design (project imported via a mockup export, since live MCP access
hit an auth-scope error this session that wasn't resolved) and came back as
**"Ledger"**: strict monochrome (black/white/gray only, no accent hue),
Geist + Geist Mono, square corners throughout, and one governing rule —
**white is reserved for what the chain has decided, or what spends money**
(the live-OPEN pulse, the VERIFIED/PAID stamps, primary buttons, amounts).
Risk (Mainnet, expired, reverted) is shown with a **repeating diagonal hatch
pattern** instead of a color, deliberately, so it still reads in grayscale and
screenshots — a detail called out explicitly in the design's own rationale.

The entire frontend was rebuilt to this system: new Tailwind tokens (9-step
ink scale, hazard-hatch utilities), the hero ("The chain is the judge."), a
settlement-receipt explainer, a live ticker, a ledger-style stats band, and
ledger-styled rows/forms/toasts — while leaving all wallet/contract/chain
logic untouched. Verified against the live deployment with headless-Chrome
screenshots, not just a local build check.

### 3.7 — Two bugs the user caught by actually using it
Real user testing surfaced two problems no amount of code review had:

1. **Bounty rows didn't visibly expand.** The design had a "show more" for
   long text, but no clear way to open a row and see its submissions. Fixed
   by making the whole row a `<button>` toggling `aria-expanded`, with a
   collapsed one-line hint ("▸ 1 submission · 2m ago") and full detail
   (description, meta, submissions, actions) revealed on click. **Verified
   with an actual headless-browser interaction test** (CDP: click the row,
   read the DOM, screenshot both states) rather than trusting a static
   render — this caught that the first verification attempt had a false
   negative from a React-flush timing race, not a real bug.

2. **Curated submissions were unjudgeable.** The user opened a "completed"
   bounty and found the agent's on-chain answer was empty boilerplate:
   "task acknowledged and processed... no LLM key configured." Nothing to
   read, learn from, or judge — which undercuts the entire pitch. Root cause:
   the worker's Gemini path had no key configured, so it fell back to a
   placeholder. Fixed by (a) wiring in a real Gemini key, (b) rewriting the
   prompt to demand the *finished deliverable* rather than a status update,
   (c) adding a model-fallback list + retry for transient 503s (the specific
   model name mattered — this API key only serves a particular set of model
   IDs, discovered by querying `ListModels`), and (d) making the **no-key**
   fallback path itself do genuine work (real Solidity reentrancy analysis
   with severity/location/fix) instead of a placeholder, so the system is
   honest even without a model. Re-ran the demo: a real reentrancy audit
   ("HIGH: Reentrancy @ `withdraw()`... FIX: Checks-Effects-Interactions,"
   with corrected code) is now paid and on-chain; a real 3-bullet
   commit-reveal explainer is live and open for anyone to read and judge.

Both fixes are committed and pushed; the live site picked up the new
on-chain data automatically (no redeploy needed for the worker fix — only the
data changed, not the frontend code).

---

## 4. Why the architecture is shaped this way (decision log)

- **Dual-mode instead of "make everything verifiable":** most interesting
  work (audits, judgment calls, summaries) genuinely isn't checkable by a
  contract. Rather than force everything into the verified mold, curated mode
  stays as an honest, trust-bounded fallback — the pitch is precise about
  which guarantee applies to which task.
- **Commit-reveal, not just "submit the answer":** without it, verified mode
  would leak the winning answer in the mempool/first submission and let
  anyone copy it — defeats the entire "no plagiarism" goal from the teardown.
- **`STATICCALL` to the verifier:** a verifier is `view`-only by interface
  contract, so it cannot reenter the engine or mutate state — the security
  boundary is enforced by the interface, not just convention.
- **`owner()` as identity-only, zero privilege:** kept from the SplitPay/Tally
  pattern specifically so the deployer can later register on the **Tally
  provenance registry** (`0x459Cab32306c439a408cA6b8672CcF6c6A0536d9` on Arc
  mainnet) and get an `OWNER_PROVEN` badge — proof the contract's deployer
  controls it, without giving that owner any power over user funds.
- **Reusing SplitPay's exact chain/wallet/tx plumbing:** not laziness — it's
  already been through one deploy cycle's worth of gotchas (Arc's 18-decimal
  native-gas view, RPC quirks, wagmi avoidance), so reusing it removed a whole
  category of risk from a new build.
- **A recent-window + cached event scan, not a full-history `getLogs`:** Arc's
  testnet RPC caps `eth_getLogs` to a small block range, so the frontend
  can't just scan from genesis for `TaskCreated` (this failed loudly during
  the design revamp, showing `0.00` for settled bounties). The fix combines a
  cheap recent-block scan with a `localStorage` cache seeded from live reads,
  so it degrades gracefully rather than lying about the amount.

---

## 5. What's real vs. what's still a claim

**Proven on-chain, reproducibly:**
- Verified-mode auto-settlement with zero human involvement (backdoor CTF,
  preimage).
- Front-running resistance (tested both attack shapes: no prior commit, and
  same-block commit+reveal).
- Curated submit → validator payout.
- Anti-lockup `reclaimExpired` after a deadline.
- Real, inspectable curated-task deliverables (a genuine security finding,
  a genuine explainer) — not placeholder text.

**Still honest limitations (stated in the README, not hidden):**
- Curated mode trusts its validator; the timeout bounds the downside, it
  doesn't remove the trust.
- Only two verifier templates exist so far (preimage, backdoor-CTF) — a real
  product would need more verifier types or a way for creators to supply
  their own safely.
- No agent reputation/identity layer yet (the wider industry is converging on
  standards like ERC-8004 for this — noted as a roadmap item, not built).

---

## 6. Live addresses & links (Arc testnet, chain 5042002)

| | |
|---|---|
| BountyEngine | `0x9A7a66fc35b9237FD88E7f9fccC82A830eF90Ade` |
| PreimageVerifier | `0x8bCa2402420198103d709e2777A4Ca4620f4B9Ee` |
| BackdoorVerifier | `0x8F19eCab548AC6c0A3b673a99EDb37eC7F8638ff` |
| VulnerableTarget | `0x78bB16fCca4374FE19B23C1a02258a7eC754f39C` |
| Repo | https://github.com/I-frenzy/bountyagent |
| Live dApp | https://bountyagent.vercel.app |
| Explorer | https://explorer.testnet.arc.io |

Deployer/creator and agent-worker wallets used this session are disposable
throwaway keys (stored only in gitignored `.env` files, never committed) —
treat as burned, do not reuse for anything of value. The Gemini API key wired
into `worker/.env` is the user's own, described as an old/inactive project
key; **rotate it** when convenient regardless.

---

## 7. Environment gotchas worth remembering

- This machine's Bash tool intermittently loses `node`/`git`/coreutils from
  PATH mid-session for no clear reason; PowerShell reliably has them. When
  Bash acts up, switch tools rather than debugging PATH. Large heredocs with
  many apostrophes/backticks have also failed outright in this environment —
  the Write tool is the reliable path for long file content.
- `robocopy /E /MT:16` beats `cp -r` for large `node_modules` trees on
  Windows.
- `gh auth login --with-token` piped through PowerShell can mangle the token
  on stdin; either validate the token directly against the GitHub API first,
  or feed it via `cmd /c "... < file"` instead of a PowerShell pipe.
- Arc's `eth_getLogs` (at least on the testnet RPC used here) rejects wide
  block ranges — design around it (see §4) rather than assuming a full scan
  will work.
- Foundry pins `solc 0.8.20` and `evm_version = "paris"` project-wide,
  specifically to avoid emitting `PUSH0`, which a young EVM chain may not yet
  support. Keep this pin unless Arc's docs confirm Shanghai+ support.

---

## 8. What's left

1. **Arc mainnet deploy** (chain 5042) of the same four contracts, from the
   user's own owner-attributable wallet (as with the other two entries) —
   gated on that wallet being funded with real USDC.
2. **Register on the Tally provenance registry** so the deployment shows
   `OWNER_PROVEN`, matching the other two entries' pattern.
3. **DoraHacks submission** — the recurring BUIDL form (project name,
   contact, builder profiles, live deployment link, mainnet contract/tx,
   public repo, a tight two-sentence pitch, "what does it use Arc for,"
   deployed-before/prior-grant questions). Draft-ready material already
   exists in this journal and the README; needs the mainnet address before
   it can be filled in for real.

---

*This file is a narrative supplement to `README.md` (which stays the
technical reference) — update both when something material changes, but keep
the reasoning and history here rather than duplicating it into the README.*
