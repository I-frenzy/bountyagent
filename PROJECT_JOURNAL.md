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
- **Live right now (2026-09-25):**
  - Repo: **https://github.com/I-frenzy/bountyagent** (public, CI green)
  - dApp: **https://bountyagent.vercel.app** (Vercel, `ifrenzys-projects`) —
    the *deployed* site is still the old build; the new one builds cleanly and
    needs `vercel login && vercel --prod` (CLI login expired, see §7)
  - Contracts: v3 stack on **Arc testnet**, every flow rehearsed for real —
    `deployments/arc-testnet.json` / `-rehearsal.json`
  - Mainnet: runbook ready (`docs/MAINNET.md`), dry-run passes against real
    mainnet state; waiting on the user's funded wallet
- **What's left:** the user's steps in `docs/MAINNET.md` (fund, deploy, verify,
  rehearse, Vercel env + deploy, Tally, agent secret, seed bounties), then the
  DoraHacks submission from `docs/SUBMISSION.md`. See §8.

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

### 3.8 — Re-audit, research, and the pivot to "evaluator" (2026-09-24/25)
A fresh read of the contract found the **H-1 lockup was still reachable**: the
UI defaulted to no deadline, and with no deadline one junk submission blocked
`cancelTask` forever. Deadlines became mandatory (10 min–30 days), with a
15-minute reveal grace so a creator can't race a solver who committed in time.

Research then reshaped the plan: Arc mainnet went live Sep 16; Arc recommends
**ERC-8183** for agent jobs, whose evaluator is explicitly *trusted*; **ERC-8004**
registries are live on Arc mainnet. Positioning (user-approved): BountyAgent is
**the trustless evaluator for Arc's agent economy**, not a rival marketplace.
The plan lives in `ROADMAP.md`; the user added **multi-winner bounties** and
**People mode** (keep the escrow — pay-later boards let posters never pay),
then **profiles with X/links**, **link previews**, and **clickable wins**.

### 3.9 — Contract v3 and the new primitives
- **v3:** reward kept after payout (the UI no longer needs event scans),
  `createdBlock`/`settledBlock`/`firstPaidBlock` recorded (receipts read exact
  blocks — no indexer), beta caps, custom errors, transient reentrancy guard,
  solc 0.8.30 / Cancun (Arc runs it — confirmed on testnet).
- **Implementation bounties (`TestVectorVerifier`):** pay for deployed code
  that matches a reference on fixed + fresh random inputs within a gas budget.
  Two design catches: (1) fresh inputs from the *previous* block could be
  ground for free by simulation — so the engine now passes `commitBlock` and
  inputs come from `blockhash(commitBlock + 1)`; (2) no factory needed — the
  solver commits to its contract's *predicted* address, then deploys, then
  reveals. Candidates must be pure (bytecode opcode scan).
- **`VerifierEvaluator` (ERC-8183):** Arc testnet runs the **ERC's reference
  `AgenticCommerce`**, not `erc-8183/base-contracts` (layout checked on-chain),
  so that's what we target and vendor (CC0). Its admin can set fees to 100% and
  upgrade → our mainnet instance renounces every role at deploy.
- **Multi-winner:** equal shares; anti-copy rule — only commits from a block
  *before* the first payout can win (mutation-tested: removing it lets a copier
  win).
- **ERC-8004:** `linkAgent`; on every payout the engine writes feedback *from
  its own address* (verified/curated tags), gas-capped and wrapped so it can
  never block a payout, and a starved call reverts rather than silently dropping
  the record. 9 fork tests against the real mainnet registries.

### 3.10 — Security pass and CI
CI runs Foundry tests (incl. mainnet-fork tests), coverage, Slither and Aderyn
on every push (Aderyn doesn't run on Windows; Slither needs Python — GitHub
Actions runs both for free). Every High/Medium triaged in `SECURITY.md`; one
real fix (events before payouts). 146 tests; branch coverage engine 98%,
evaluator and implementation verifier 100%.

### 3.11 — The web, rebuilt around people and proof
People mode (submit from the page, audience labels, "pay each winner × N",
finish early, USDC guide); ERC-8004 profiles (name, bio, person/agent, X /
web / GitHub / Farcaster — https-only, rebuilt from handles); link previews via
an SSRF-hardened `/api/preview` (X and YouTube via oEmbed; an IPv4-in-IPv6
bypass was found and closed); `/task/[id]` receipts (winning work, decoded
answers, every step with fee/block/tx grouped by transaction); expandable wins
on profiles; leaderboard; `/run`, `/erc-8183`, `/verifiers`; a proof band on
the home page. Bugs caught by testing in a real browser against local forks and
testnet: mainnet addresses could never load (`process.env[name]` isn't inlined
by Next.js), a phone-width header overflow, and a load race that could show the
previous network's data.

### 3.12 — Testnet rehearsal and the agent side
The full stack was redeployed on testnet with the evaluator plugged into **Arc
testnet's own ERC-8183 contract**, and `worker/rehearsal.js` ran every flow for
real: 29 transactions, $0.14 total fees — including ERC-8183 job #186717
completed with **no human evaluator** and an implementation bounty won by
deploying at a pre-committed address and passing 19 on-chain tests. The
reference agent was rebuilt (`worker/core.js`: resumable deterministic salts,
multi-winner aware, skips people-labelled and dust bounties, auto-creates its
ERC-8004 profile), gained a scheduled mode (GitHub Actions, dormant until the
user adds the key as a secret), and an **MCP server**: an agent driven only
over MCP found a bounty, checked a wrong and a right answer for free, and won.

### 3.13 — Mainnet, the self-audit, and the site outage (2026-09-25/26)
The full stack went live on **Arc mainnet** (addresses in
`deployments/arc-mainnet.json`) and the reference agent was switched on there.
A full self-audit followed (`docs/AUDIT.md`): every mainnet contract matches
the repo source byte-for-byte, the escrow invariant holds on-chain, and the
agent had already won two bounties with both wins written to ERC-8004. No
critical or high finding.

Then the user reported the site "not loading". What was really going on:

- **Symptom.** Testnet worked. Clicking **Mainnet** white-screened ("Application
  error: a client-side exception"). Because the network choice is saved in
  `localStorage`, anyone who ever picked Mainnet got the crash on *every* visit.
  The hosted MCP (`/api/mcp?network=mainnet`) failed every call the same way.
- **Root cause.** The `NEXT_PUBLIC_*_MAINNET` values stored in Vercel start with
  an invisible **BOM (U+FEFF)**: `"﻿0x9A7a…"`. Seen on both the engine
  (`CONTRACT`) and the `TARGET` variable, so probably all eight. viem's
  `InvalidAddressError` on that one bad string took down the whole page. The
  likeliest source is piping the values into `vercel env add` from Windows
  PowerShell 5.1, which prepends a BOM to piped text.
- **Fix 1 (`0da2f3d`).** `addr()` in `web/src/lib/arc.ts` strips whitespace and
  zero-width marks and only accepts a 20-byte hex address, otherwise it falls
  back. One dirty variable can no longer crash the app.
- **Fix 2 (`b766634`).** Mainnet now has the live deploy's addresses built in
  as fallbacks, the same as testnet. The site needs **no** mainnet env vars at
  all; the Vercel variables are optional overrides.
- **Verified locally** with no mainnet vars (board shows the real engine
  `0x9A7a…0Ade`: 4 bounties, 2 open, 2 completed, matching the chain) and with
  deliberately BOM-poisoned vars, including a BOM plus trailing space (page and
  mainnet MCP both work). Typecheck clean.
- **Not live yet — the Vercel problem.** The Vercel project is **not connected
  to the GitHub repo**: GitHub shows no deployments and no Vercel status on any
  commit, so pushes never deploy. The site only changes through the Vercel CLI,
  and the CLI on this machine is logged out (`vercel whoami` starts a device
  login). Until someone runs `vercel login` + `vercel --prod` from `web/`, the
  live site keeps serving the old, crashing build. Tracked in GitHub issue #1.

Lesson: config that can be derived from the repo (immutable contract addresses)
should live in the repo, with env vars as optional overrides. That removes a
whole class of deploy-time mistakes.

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
- **Read state, not history:** Arc's RPC caps `eth_getLogs` ranges. v1 worked
  around it with a recent-window scan + localStorage cache; v3 removes the need:
  the full reward and winners stay in storage (read via Multicall3), and the
  engine records the exact blocks of creation and payout, so receipts fetch
  logs from those few blocks only — no indexer.
- **Evaluator, not marketplace:** ERC-8183 already defines jobs and escrow;
  what it lacks is a trustless evaluator. Plugging into Arc's own standard is
  worth more than competing with it.
- **People mode keeps the escrow:** a pay-later model would drop the one
  guarantee a contract adds (the money exists) and bring back "the poster
  never paid".
- **Profiles on ERC-8004, fully on-chain:** the registration file is a base64
  data URI (the standard's recommendation) — no IPFS or server to go down —
  and only data URIs are read, so the browser never fetches arbitrary URLs.
- **Reputation written by the engine:** feedback filtered by the engine's
  address is a record no review can fake; the leaderboard adds distinct
  posters to blunt self-dealing.

---

## 5. What's real vs. what's still a claim

**Proven on-chain, reproducibly** (testnet rehearsal, `deployments/arc-testnet-rehearsal.json`):
- Code-checked auto-settlement with zero human involvement (backdoor CTF,
  preimage, and an implementation bounty passing 19 on-chain tests).
- An ERC-8183 job on Arc testnet's own contract completed by `VerifierEvaluator`.
- Wins written to the real ERC-8004 reputation registry by the engine.
- Multi-winner payouts and early finalize with exact refunds.
- An AI agent winning a bounty purely over MCP.
- Front-running resistance (tested both attack shapes: no prior commit, and
  same-block commit+reveal).
- Curated submit → validator payout.
- Anti-lockup `reclaimExpired` after a deadline.
- Real, inspectable curated-task deliverables (a genuine security finding,
  a genuine explainer) — not placeholder text.

**Still honest limitations (stated in the README, not hidden):**
- Curated mode trusts its validator; the timeout bounds the downside, it
  doesn't remove the trust.
- Three verifier templates; creators can bring their own, but a broken one can
  make a bounty unwinnable (the UI marks unknown verifiers).
- The implementation verifier is property testing, not proof.
- Reputation can be wash-traded by a poster paying their own alt (mitigated by
  "distinct posters", not prevented).
- Not yet on mainnet at the time of writing.

---

## 6. Live addresses & links (Arc testnet, chain 5042002)

Current (v3, 2026-09-25) — full list in `deployments/arc-testnet.json`:

| | |
|---|---|
| BountyEngine | `0x6f525E678aEf9088c0b5eA227FAaed850E206D08` |
| TestVectorVerifier | `0x1952Bb6EebbA7D029EA3cf3e8427afA31dC1911A` |
| VerifierEvaluator (ERC-8183) | `0x382B40F21c4A278a2e7d156d6310D7389ca71C58` → Arc's AgenticCommerce `0x0747…4583` |
| ERC-8004 Identity / Reputation (testnet) | `0x8004A818…BD9e` / `0x8004B663…8713` |
| ERC-8004 Identity / Reputation (mainnet) | `0x8004A169…a432` / `0x8004BAa1…9b63` |
| Reference agent profile | ERC-8004 #896857 (testnet) |

The v1 engine (`0x9A7a…0Ade`) and its verifiers are superseded.
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
- Foundry originally pinned `solc 0.8.20` + `evm_version = "paris"` to avoid
  `PUSH0`. Arc's docs now confirm an Osaka baseline, so contract v3 moved to
  `solc 0.8.30` + `evm_version = "cancun"` (transient-storage reentrancy
  guard). Confirm on the testnet rehearsal before mainnet.
- The public Arc RPC rate-limits hard (HTTP 429): the pre-v3 board, which
  makes several calls per task, drew 40× 429s on a single page load. Batch
  reads through Multicall3.
- **On a fork of Arc mainnet, anvil's well-known test accounts carry EIP-7702
  delegations** (sweeper bots): ERC-8004 `_safeMint` rejects them. Clear with
  `cast rpc anvil_setCode <addr> 0x` on the fork.
- **Vercel CLI login has expired** on this machine; `vercel whoami` hangs
  (it starts a device-login flow). Needs the user: `vercel login`, then
  `vercel --prod` from `web/`.
- **The Vercel project is not connected to GitHub.** Pushing to `main` does
  *not* deploy the site; only `vercel --prod` does. Check which build is live by
  comparing the `app/page-<hash>.js` chunk name before and after a deploy.
  Connect the repo (Vercel → Settings → Git) so pushes deploy on their own.
- **Windows PowerShell 5.1 prepends a BOM (U+FEFF) to text piped into native
  programs.** That is how the Vercel mainnet env vars got an invisible prefix
  that crashed the site (§3.13). Type env values into the dashboard, or pipe
  from `cmd`/Git Bash, never from PowerShell.
- **Arc's explorer is Blockscout** (verify with `--verifier blockscout`, no
  key) and rate-limits per IP for hours after bursts — `script/verify.sh`
  skips already-verified contracts so it can simply be rerun.
- `npx` can fail with `ECOMPROMISED` (its lock timer expires on this slow
  network); `npm install --prefix <dir>` avoids the lock. Aderyn has no
  Windows build — it runs in CI.
- `forge script` dry runs used to write `deployments/*.json`; the script now
  writes only on a real broadcast. And `forge` auto-loads `.env` (the burned
  testnet key) — the deploy script refuses an env key on mainnet by default.

---

## 8. What's left

All code for the grant is built, tested and rehearsed. The contracts are live on
Arc mainnet and the reference agent runs there (§3.13).

**Done:** deployer and agent wallets funded; mainnet deploy
(`deployments/arc-mainnet.json`); `WORKER_PRIVATE_KEY` secret +
`ARC_NETWORK=mainnet`, so the scheduled agent is live and has won 2 bounties;
self-audit (`docs/AUDIT.md`); the mainnet site crash fixed in code (`0da2f3d`,
`b766634`).

**Still needs the user** (step by step in **`docs/MAINNET.md`**):

1. **Redeploy the site — urgent, the live Mainnet view is down.** The fixes are
   on GitHub but not on Vercel, because the Vercel project isn't connected to
   the repo. From `web/`: `vercel login`, then `vercel --prod`. Then connect the
   repo (Vercel → Settings → Git) so pushes deploy on their own. Optionally
   delete or retype the BOM-prefixed `NEXT_PUBLIC_*_MAINNET` vars; they're no
   longer needed. Tracked in GitHub issue #1.
2. Key hygiene (`docs/AUDIT.md` F-1): treat the key pasted in chat as
   compromised; keep only trivial gas on `0xDFE783…`.
3. Verify the contracts on `explorer.arc.io` by hand in a browser (the API is
   behind a Cloudflare challenge; see `docs/MAINNET.md` §4).
4. Mainnet rehearsal with tiny amounts (`worker/rehearsal.js`,
   `ARC_NETWORK=mainnet`) → `deployments/arc-mainnet-rehearsal.json`.
5. Tally registration from the deployer wallet.
6. Seed 10–15 launch bounties; record the demo video (script in
   `docs/SUBMISSION.md`); submit on DoraHacks before **Oct 14** (aim for Oct 12).
7. Also: `script/verify.sh testnet` once the explorer's rate limit resets;
   rotate the Gemini key if one is added.

---

*This file is a narrative supplement to `README.md` (which stays the
technical reference) — update both when something material changes, but keep
the reasoning and history here rather than duplicating it into the README.*
