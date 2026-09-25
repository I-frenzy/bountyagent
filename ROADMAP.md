# BountyAgent — Roadmap (mainnet launched)

> Status: **live on Arc mainnet** (2026-09-25). F1–F8 shipped, security-passed,
> and deployed for real — see the Progress log below for what's done, and §9
> for what's left before submission. See `PROJECT_JOURNAL.md` for history and
> reasoning, and `docs/SUBMISSION.md` for the DoraHacks draft.

**Hard deadline:** Arc Microgrants closes **Oct 14 2026, 23:59 ET** (decisions by
Oct 21). Requires a **live Arc mainnet deployment**, public repo, and a short
description of what it uses Arc for. Judged on: relevance to Arc, technical
credibility, build quality, and whether it's worth taking further.

**Decided: everything ships on Arc mainnet** (chain 5042). Testnet is only a
rehearsal environment — every feature, demo, and proof in the submission is
mainnet.

---

## 0. Done — deadline fix (H-1 lockup), uncommitted

- Contract: deadline now mandatory (10 min – 90 days); submissions/commits close
  at the deadline; verified-mode reclaim waits a 15-min `REVEAL_GRACE` so a
  last-minute committer can still reveal and be paid.
- 37/37 Foundry tests (11 new, incl. the original junk-engagement attack).
- UI: required "Closes in" picker (1h / **24h** / 3d / 7d) replaces the
  default-off toggle; rows show "Closes in …"; reclaim respects the grace.
- Worker skips expired tasks; e2e passes a deadline.
- ⚠️ Needs redeploy — live testnet engine is still the old one.

---

## 1. Research findings that shape everything

1. **Arc mainnet is live (Sep 16 2026)**, chain 5042. Measured 2026-09-24:
   base fee 20 gwei, gas price 20.1 gwei.
2. **Arc recommends ERC-8183** (agentic job escrow). Its evaluator is a
   *trusted* party — the spec itself says so. BountyAgent's verifiers are
   exactly a *trustless* ERC-8183 evaluator.
3. **ERC-8004 is live on Arc mainnet** (verified on-chain, v2.0.0, UUPS proxies)
   at the canonical *mainnet* addresses — different from testnet:
   - Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (`name()` = "AgentIdentity")
   - Reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`
   - No canonical ValidationRegistry on mainnet — not needed by our design.
   - Testnet equivalents: `0x8004A818…BD9e`, `0x8004B663…8713`, `0x8004Cb1B…4272`.
4. **ERC-8183 is NOT on Arc mainnet** (testnet only, `0x0747EEf0…4583`).
   → We deploy our own instance on mainnet from `erc-8183/base-contracts`
   (MIT), configured **non-upgradeable, zero platform/evaluator fees, no
   admin**, so it's credibly neutral. Label it clearly as a BountyAgent-deployed
   instance of the standard; switch to an official one if Circle ships it.
5. **Arc targets Osaka** (EIP-7702 available) → the `paris` pin is obsolete.
6. Arc quirks: transfers to/from blocklisted addresses revert; timestamps can
   repeat across blocks (order by block number — engine already does);
   `PREVRANDAO` is always 0; native USDC = 18 decimals (ERC-20 view at
   `0x3600…0000` = 6); single-confirmation finality.
7. Circle Agent Stack (Agent Wallets, Nanopayments, service directory) is
   testnet-only on Arc for now — not used.
8. **Closest competitor on Arc:** `xseven0908/arc-agent-work-market` — ERC-8004
   + ERC-8183, *testnet only*, self-described "not for real assets", evaluator
   still trusted. Our differences: mainnet, and the contract itself is the
   evaluator.

---

## Progress

- ✅ §0 deadline fix — committed `4cc8f63`.
- ✅ §2 contract v3 — committed `da43802`. Verifier allowlist is a UI item
  (frontend phase), not a contract change.
- ✅ §3 cleanup — presets replaced, demo challenges labelled, fake `npx`
  command replaced with real steps.
- ✅ F3 `TestVectorVerifier` + `PopcountReference` demo. **No factory needed:**
  the solver commits to its candidate's *predicted* address, then sends deploy
  and reveal back to back. Fresh inputs come from `blockhash(commitBlock + 1)`
  (not the previous block, which a solver could grind for free by simulation),
  so `IBountyVerifier.verify` now also receives `commitBlock`. Candidates must
  be pure (bytecode opcode scan) and compiled without CBOR metadata.
- ✅ F1 `VerifierEvaluator` + vendored ERC-8183 reference `AgenticCommerce`
  (CC0). Finding: Arc testnet runs the **ERC's reference** (layout checked
  on-chain), not `erc-8183/base-contracts` — so we target and deploy that one.
  Its admin can set fees to 100% and upgrade; our mainnet instance renounces
  every admin role at deploy (`script/DeployCommerce.s.sol`, tested). Its
  provider can bump the budget until funding → UI must approve exactly the
  budget. No grace after expiry → providers must settle before `expiredAt`.
- 95 tests total. `script/Deploy.s.sol` deploys the whole stack (simulated OK).
- ✅ Security pass: CI (tests, coverage, Slither, Aderyn) on every push; every
  High/Medium finding triaged in SECURITY.md (one real fix: events before
  payouts). Coverage: evaluator 100%, TestVector 100%, engine 97% branches.
- ✅ F7 multi-claim in the engine: equal shares, one win per address,
  `finalizeTask`, remainder refunds; verified anti-copy rule (commit block must
  precede the first payout) — mutation-tested: removing it lets a copier win.
  15 new tests + invariants rewritten for multi-winner. 124 tests. UI still
  posts single-winner bounties; multi-winner controls come with F8.
- ✅ F8 People mode (web): submit box on poster-decided bounties; audience
  label (Anyone/People/Agents) + board filter; "Pay each winner × N winners"
  with live total and the 100 USDC cap; Pay / Finish & refund unpaid; plain-
  language labels ("Code checks it" / "You decide"); "How to get USDC on Arc"
  guide; our agent skips people-labelled bounties. Tested end to end in a
  browser on a local anvil chain (post as account 0 → submit as account 1 →
  pay → finish early): balances exact to the wei. Board now reads via
  Multicall3 (no event scan, no cache).
- Fixed on the way: **mainnet addresses could never load** — `arc.ts` read
  `process.env[name]` dynamically, which Next.js doesn't inline client-side.
  Also: header overflowed on phones (490px on a 375px screen) → compact controls.
- ⚠️ Don't redeploy the web app until the contracts are redeployed: the new
  ABI doesn't match the old testnet engine the site still points to.
- ✅ F2 ERC-8004: profiles (name, bio, person/agent, X/web/GitHub/Farcaster
  links) stored on-chain as ERC-8004 identities; engine writes every win to
  the ERC-8004 reputation registry from its own address (verified / curated
  tags). 9 fork tests against the REAL Arc mainnet registries + 13 failure-mode
  tests. Finding: anvil's well-known accounts carry EIP-7702 sweeper
  delegations on Arc mainnet, so ERC-8004 `_safeMint` rejects them on a fork.
- ✅ Link previews (X posts, YouTube via oEmbed; any https page via OG tags)
  through an SSRF-hardened `/api/preview`.
- ✅ F6 (early): `/task/[id]` receipt pages — winning work, decoded answers,
  every on-chain step with fee/block/tx grouped by transaction — and
  expandable wins on profiles. (Leaderboard still to do.)
- ✅ Testnet rehearsal: full v3 stack redeployed (evaluator on Arc testnet's own
  ERC-8183); every flow run for real — 29 tx, $0.14 fees
  (`deployments/arc-testnet-rehearsal.json`).
- ✅ Reference agent v2 (`worker/core.js`, resumable salts, multi-winner aware,
  implementation solver, auto ERC-8004 profile) + scheduled runs (GitHub
  Actions; dormant until the user adds the secret).
- ✅ F5 MCP: local server (signs locally) won a bounty driven purely over MCP;
  hosted read-only `/api/mcp`.
- ✅ F6 leaderboard; `/run`, `/erc-8183`, `/verifiers`; home proof band (F4);
  unknown-verifier warning; production build passes.
- ✅ Mainnet readiness: deploy script writes `deployments/arc-<network>.json`
  (real broadcasts only), keystore/Ledger support, refuses the env key on
  mainnet; dry run passes against real mainnet state; `script/verify.sh`;
  runbook `docs/MAINNET.md`; submission draft `docs/SUBMISSION.md`.
- ⏳ Remaining = the user's steps in `docs/MAINNET.md` (wallet, deploy,
  Vercel login + env, Tally, agent secret, seed bounties, demo, submit).
- Finding (2026-09-25): the current board draws **40× HTTP 429** from the
  public Arc RPC on one page load → the Multicall data layer (§6) is required,
  not optional.

## 2. Contract v3 (before mainnet) — must-have

- Keep original `reward` (don't zero it; status already guards double-pay).
- Store `createdBlock` and `settledBlock` in `Task` (pack with the uint64s) →
  the UI fetches the exact block's logs for tx hashes/receipts. No indexer and
  no wide `getLogs` needed.
- Newer solc, drop `paris`, custom errors, transient-storage reentrancy guard.
- Cap curated submissions per task (~50) — unbounded array is a view-DoS.
- Verifier allowlist ("audited template") surfaced in UI; unknown verifiers get
  the hazard hatch.
- **Beta exposure caps (hard, in-contract):** `MAX_REWARD = 100 USDC`,
  `MAX_DURATION` reduced to 30 days. Documented as beta limits; a later engine
  can lift them.
- No admin, no pause, no upgradeability (stated openly; caps bound the blast
  radius instead).

## 3. Subtract / tone down

- Presets: "Summarize the linked Arc docs" (links nothing), "BTC sentiment"
  (unjudgeable) → replace with checkable tasks.
- Demo challenges are trivial (1337 is in the spec; preimage has 8 candidates) —
  label as demos.
- Home page "Run an agent" shows `npx bountyagent-worker`, which **doesn't exist
  on npm** → replace with the real MCP/SDK instructions (F5).
- No protocol fee.

---

## 4. Positioning (decided)

> **BountyAgent is the trustless evaluator for Arc's agent economy — work a
> contract can check gets paid by the contract, no human in the loop.**

Infrastructure that completes Arc's own recommended standard (ERC-8183's
evaluator is trusted; ours isn't), not a rival marketplace.

## 5. Features (decided: Tier 1, all on mainnet)

| # | Feature | Done when |
|---|---|---|
| F1 | **ERC-8183 `VerifierEvaluator`** + our mainnet ERC-8183 instance | An 8183 job on **mainnet** completes with zero human action via our adapter |
| F2 | **ERC-8004 identity + verified track record** (canonical mainnet registries) | Worker has a mainnet 8004 identity; each verified win writes a reputation entry; profile UI shows it. Weighted by bounty size + creator diversity (anti wash-trading), stated openly |
| F3 | **Test-vector verifier** ("implement this interface, pass these vectors") | ✅ Built (no factory needed; seed = `blockhash(commitBlock+1)`). Remaining: one real example solved end-to-end on mainnet |
| F4 | **Arc cost & speed receipts** | See §6 — real receipt data only |
| F5 | **MCP server + agent SDK** | A Claude agent with only our MCP server and a funded key finds and wins a mainnet bounty |
| F6 | **Task permalinks + agent leaderboard** | Shareable `/task/[id]` shows the full lifecycle with receipts |
| F7 | **Multi-claim bounties** (added 2026-09-25, inspired by Bountycaster) | One pool pays up to N winners an equal share, in both modes — see below |
| F8 | **People mode: bounties for humans** (added 2026-09-25) | A person with a wallet can post, submit, and get paid entirely from the website, with no agent involved — see below |

### F7 — Multi-claim bounties (contract change → lands before the testnet rehearsal)
- Creator sets `maxWinners` (1–50); the bounty is split equally
  (`reward % maxWinners == 0`, so no dust). `maxWinners = 1` is today's behaviour.
- **Curated:** the validator approves winners one at a time; each address can
  win once; each approval pays one share immediately. The task completes when
  all shares are paid. The validator can also **finalize early**, which refunds
  the unpaid shares to the creator (so a poster who's happy with 3 of 5 doesn't
  wait for the deadline). After the deadline, the creator reclaims unpaid shares.
- **Verified:** the first N valid revealers are paid. **Commits close at the
  first successful reveal**: once an answer is public, nobody new can commit to
  it (and re-committing is blocked), so later winners must have committed
  before seeing any answer. Verifiers can use the `solver` argument to require
  a different answer per solver (e.g. per-agent data).
- Storage: `paidCount`, `hasWon[task][addr]`, `getWinners(task)`; `reward`
  stays the total. The invariant becomes: engine balance == Σ (reward −
  paid) over open tasks. New attack tests: duplicate winner, over-paying,
  post-reveal copying, early finalize by a non-validator, rounding.

### F8 — People mode (escrow kept — see decision below)
Bountycaster shows the demand: people post and do bounties themselves, and the
poster decides who gets paid. BountyAgent's Curated mode already *is* this —
poster (or a validator they name) decides — but today only an agent can submit,
from code. F8 makes it usable by people:
- **Submit from the site:** on any Curated bounty, a "Submit your work" box
  (text or link), signed with the person's wallet.
- **Posting for people:** a "Who is this for: Anyone / People / Agents" choice.
  It's a label stored in the spec, not enforced — a contract can't tell a person
  from a bot, and we say so.
- **Reviewing:** the poster sees submissions and taps **Pay** (exists), or
  pays several with F7.
- **Plain language:** People-mode pages avoid "commit/reveal/verifier"; a short
  "How to get USDC on Arc" guide; mobile-first.
- Later (Tier 2): post by tagging a bot on X/Farcaster (the Bountycaster
  pattern), and sign-in wallets (Circle wallets / passkeys) for people who have
  no crypto wallet.

**Decision (recommended, pending user confirmation): keep the escrow.**
Bountycaster is pay-later on trust: the poster can simply never pay, and the
only recourse is emailing support. People mode keeps everything that makes it
easy — the poster still decides — but the money is locked when the bounty is
posted, so a person who does the work knows it's really there, and the deadline
refunds the poster if nobody's work is chosen. A pay-later mode would remove the
one thing a contract adds here and bring back "the poster never paid".

Tier 2 (roadmap section of the submission, not built now): gasless "first
dollar" relay (needs earliest-committer-wins — a relayer could withhold a
reveal), pooled bounties, EURC + StableFX, cross-chain funding via
CCTP/Gateway, sealed curated submissions, ZK verifiers, Circle Agent Wallets,
F3 "ratchet" improvement bounties.

---

## 6. Frontend & UX plan (keep the "Ledger" design system)

Design rules stay: monochrome, Geist/Geist Mono, square corners, **white only
for what the chain decided or what spends money**, hazard hatch for risk.
Mainnet becomes the **default network**; testnet is labelled "Sandbox".

### Pages
| Route | Purpose | Contents |
|---|---|---|
| `/` | Pitch + live proof | Hero keeps **"The chain is the judge."**; new subline: *"The trustless evaluator for Arc's agent economy. Work a contract can check is paid by the contract — in the same transaction."* Proof band (live mainnet numbers, see Receipts). Settlement receipt gains row `05 RECORD — win written to the agent's ERC-8004 reputation`. Two CTAs: **Post a bounty** / **Run an agent**. Board below with filters (Open/Settled · Verified/Curated · verifier type). |
| `/task/[id]` | Shareable proof of one bounty | Header: amount, status stamp, mode, verifier (name, "audited template" badge or hazard hatch, source link), decoded `taskData`. **Lifecycle receipt**: Posted → Commits (n) → Revealed → Verified → Paid, each with block, tx link, fee in USDC. Revealed answer shown after settlement. Curated: submissions + validator. Share button; Open Graph image (`next/og`) so links unfurl as a receipt card on X/Discord. |
| `/agents` | Leaderboard | Rank, agent (ERC-8004 name + ID + address), verified wins, USDC earned, unique creators paid by, median post→paid time. Header note: "verified wins only". |
| `/agents/[address]` | Agent profile | ERC-8004 identity card (name, ID, metadata/capabilities), stats, win history (links to task pages), reputation entries read from the mainnet registry. |
| `/erc-8183` | For judges & builders | What the VerifierEvaluator is, why ERC-8183's evaluator gap matters, a code snippet to use it from any 8183 job, mainnet addresses, and a "create an 8183 job with our evaluator" flow. |
| `/verifiers` | Catalog | Each template: what it checks, `taskData` encoding, source, audit status, example bounty. |
| `/run` | Agent onboarding | MCP config snippet for Claude Desktop/Code (copy button), SDK install, reference worker, safety notes (use a dedicated hot wallet with a small balance). |

### Receipts (F4) — measured correctly
Reveal and payout happen in **the same transaction**, so "reveal→payout time" is
meaningless (and Arc timestamps can repeat). Show instead:
- **Settled in 1 transaction · final on inclusion.**
- **Lifecycle fees** in USDC (post + commit + reveal) and as % of the bounty
  (~$0.008 total today → 0.8% of a $1 bounty).
- **Time to solve:** post block → payout block (block timestamps).
- Proof band on `/`: total USDC paid · bounties settled · median time-to-solve
  · average lifecycle fee · agents with ERC-8004 identity.

### Data layer
- Board/leaderboard read tasks via **Multicall3** (`getTask(1..N)`), made
  possible by v3 keeping `reward`.
- Receipts: `getLogs` on the exact `createdBlock`/`settledBlock` (v3), then
  `getTransactionReceipt` for gas × price. Cached per task (immutable once settled).
- No indexer for the grant. Revisit (Ponder/Envio) past a few thousand tasks.

### Polish
Mobile pass at 375px, keyboard/a11y on the new pages, empty/loading/error states,
mainnet hazard warnings kept on every money-spending action.

---

## 7. Security & testing plan

### Threat model
Assets: escrowed USDC. Actors: creator, solver agents, validator, front-runner,
malicious verifier author, malicious 8183 provider/client, compromised hot key.

### Attack tests to add (Foundry)
| Area | Attack | Expected |
|---|---|---|
| Escrow | Reentrancy from a malicious winner/creator contract into reveal/complete/cancel/reclaim | Blocked; balances exact |
| Escrow | Winner/creator contract that reverts on receive | Only that party's payout fails; nothing else bricks |
| Verified | Copy another agent's commitment hash | Useless — commitment binds `msg.sender` |
| Verified | Re-commit to reset the block, same-block commit+reveal | Blocked |
| Verified | Deadline edges incl. repeated timestamps across blocks | Correct at `==` boundaries |
| Verifier | Reverts / burns all gas / returndata bomb / tries to write state | Treated as invalid; task stays open; no brick |
| Verifier | Revealer supplies low gas so the verifier runs out (63/64 rule) | Whole tx reverts; no state change |
| Curated | Submission spam past the cap | Rejected at cap |
| Caps | Reward > `MAX_REWARD`, duration > 30d | Revert |
| F1 | Someone other than the job's client configures evaluator params; answer ≠ submitted deliverable hash; wrong job state; reentrancy via the 8183 contract | All revert |
| F3 | Hard-coded lookup-table solution; copying deployed code before reveal; code that behaves differently under STATICCALL | Fails the fresh vectors / atomic deploy+reveal prevents copying |
| F2 | Wash-trading reputation (creator pays own alt) | Can't be prevented on-chain — weighting + disclosure; test the weighting math |

### Invariants (handler-based fuzzing, random actors)
- Engine balance == Σ reward of Open tasks.
- A task is paid at most once; status only moves Open → Completed/Cancelled.
- Every Completed verified task has a winner whose reveal passed the verifier.

### Tooling
Slither + Aderyn (zero unresolved high/medium), `forge coverage` ≥ 95% branches
on engine/evaluator/verifiers, 10k fuzz runs, plus AI review passes as an
**extra** layer (not a substitute for human review). Ask the Arc builder
community for a peer review of the final contracts.

### "Safe for real USDC" — launch gates (all must pass before announcing)
1. All tests, invariants and static analysis green.
2. **Mainnet dress rehearsal:** every flow (both modes, cancel, reclaim, F1, F3)
   executed on mainnet with ~$0.10 bounties, checked on the explorer.
3. Source verified on the explorer; Tally `OWNER_PROVEN`.
4. Beta caps live (100 USDC / 30 days); no admin/pause/upgrade — documented.
5. Keys: deployer = the user's own wallet (hardware wallet ideally); worker hot
   wallet holds ≤ $5; Gemini key rotated; secrets only in host env vars.
6. `SECURITY.md` with a disclosure contact and an incident plan: stop posting
   to the affected engine in the UI, deploy a fix, open tasks remain
   reclaimable after their deadline (≤ 30 days).

---

## 8. Hosting & costs

### Where things run
| Component | Where | Cost |
|---|---|---|
| Web dApp | Vercel (existing project) | $0 (Hobby) |
| Remote MCP server — **read-only** + unsigned-tx builder | Route in the same Next.js app (`/api/mcp`, streamable HTTP) | $0 |
| Local MCP server / SDK — **signing** tools, uses the agent owner's own key | npm package (`npx`), runs on the agent owner's machine | $0 |
| Reference worker (our demo agent) | **Vercel serverless function** (`/api/agent/tick`) — see below | $0 |
| Worker schedule | GitHub Actions cron every 5 min (free for public repos) + Vercel daily cron backstop | $0 |
| RPC | Arc public RPC + a free-tier fallback (Alchemy / QuickNode / dRPC) | $0 |
| LLM for curated tasks | Gemini free tier (rotated key) | $0 |
| Domain | **None** — stays on `bountyagent.vercel.app` (decided) | $0 |

**Total hosting: $0/month.**

### Free worker design (decided: no always-on server)
Arc's sub-second blocks let one function call do the whole job: find open task
→ solve → commit → wait one block → reveal → paid, in ~2–3 s (well inside
Vercel Hobby's 30 s limit; Hobby crons are once-a-day only, hence the triggers below).
- **Triggers:** (1) the website pings `/api/agent/tick` right after a bounty is
  posted → our agent reacts in seconds; (2) a GitHub Actions cron every 5 min
  sweeps bounties posted by others (via MCP/SDK/direct calls); (3) Vercel's
  daily cron as a last-resort backstop.
- **No storage needed:** the salt is derived deterministically
  (`HMAC(agentKey, taskId ‖ answer)`), so if a call dies between commit and
  reveal, the next tick recomputes the same salt, sees the on-chain commitment
  already matches, and just reveals.
- **Abuse-safe public endpoint:** ticks are idempotent (settled/attempted tasks
  are skipped); the agent ignores bounties below a minimum reward (e.g. $0.10)
  so nobody can drain its gas with dust bounties; a per-tick cap limits work
  per call; Gemini calls use a fast model with a timeout so curated work fits
  in 30 s.
- The hot key lives in Vercel encrypted env vars; the wallet holds ≤ $5.
- The standalone `worker/agent-worker.js` stays for local runs (e.g. the demo
  video), sharing the same solver code.

Security rule: **no hosted service ever holds a user's key.** The remote MCP
only reads and builds unsigned transactions; signing happens locally. (The only
hosted key is our own demo agent's small hot wallet.)

### Mainnet USDC budget (at 20.1 gwei)
| Item | Est. |
|---|---|
| Deploy everything (engine, verifiers, target, factory, evaluator, 8183 instance) | ~$0.15–0.25 |
| Dress rehearsal (~50 tx) | ~$0.10 |
| ERC-8004 registration(s) | ~$0.01 |
| Worker gas float | ~$2 |
| Seed bounties for launch (10–15 bounties, the rewards themselves) | ~$15–25 |
| **Total** | **~$20–30 USDC**, $0 hosting |

The user's own mainnet wallet will be funded with this USDC on Arc (confirmed;
bridge via CCTP/Gateway or withdraw from an exchange that supports Arc).
Needed by **Oct 2** (mainnet deploy).

---

## 9. Build order (target: submit Oct 12, 2-day buffer)

All contract work lands first → one audit pass, one mainnet deploy.

| Dates | Work |
|---|---|
| Sep 25 | ✅ Contract v3, cleanup, F3, F1, attack tests + invariants, CI with Slither/Aderyn, SECURITY.md (5 days ahead) |
| Sep 26–27 | **F7 multi-claim** in the engine + tests + re-run security pass — then contracts frozen |
| Sep 28 | Testnet rehearsal of the full set (incl. F1 against the canonical testnet 8183) |
| Sep 29–Oct 1 | F8 People mode (submit box, audience label, plain-language pages) + F2 prep |
| Oct 2 | **Mainnet deploy** from the user's wallet; verify sources; Tally; mainnet dress rehearsal (launch gate 2) |
| Oct 2–4 | F2 ERC-8004 on mainnet (registration, reputation writes, profile) |
| Oct 4–6 | Frontend: §6 pages, receipts/proof band, Multicall data layer, mainnet default |
| Oct 6–8 | F5 local + remote MCP, SDK; worker → Vercel `/api/agent/tick` (deterministic salts, multi-RPC, min-reward filter) + GitHub Actions 5-min cron |
| Oct 9–10 | Seed mainnet bounties; invite external agents; demo video |
| Oct 11 | README + journal + `SECURITY.md`; DoraHacks draft |
| Oct 12 | Submit. Oct 13–14 buffer. |
