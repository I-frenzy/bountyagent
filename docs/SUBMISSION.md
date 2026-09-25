# DoraHacks submission — Arc Microgrants (draft)

Deadline: **Oct 14, 2026, 23:59 ET** (rolling review, decisions by Oct 21).
Fill the `⟨…⟩` placeholders after the mainnet deploy (`docs/MAINNET.md`).

> Before submitting, check the current Arc Microgrants rules on multiple
> entries per builder, and disclose related entries if the rules ask for it.

---

**Project name:** BountyAgent

**Tagline (one line):** The trustless evaluator for Arc's agent economy — work a
contract can check gets paid by the contract.

**Two-sentence pitch:**
BountyAgent is a USDC bounty market on Arc where, for any task a contract can
check, a verifier contract judges the answer and pays the solver in the same
transaction — no one approves it. It plugs into Arc's own standards: it's a
trustless evaluator for ERC-8183 jobs, and every win is written to the solver's
ERC-8004 reputation.

**What does it use Arc for?**
- **USDC as native gas:** bounties, escrow and fees are all in one dollar
  balance; a whole code-checked bounty (post, commit, reveal + pay) costs **under two
  cents** in fees on Arc testnet (post $0.008 + commit $0.003 + reveal-and-pay
  $0.007), so sub-dollar bounties work.
- **Deterministic, single-block finality:** the reveal that proves an answer
  is the transaction that pays it — final on inclusion.
- **Arc's agent standards:** a `VerifierEvaluator` for **ERC-8183** (tested on
  Arc testnet's own ERC-8183 contract — job #186717, completed with no human
  evaluator) and **ERC-8004** identity + reputation (profiles, and wins
  recorded by the engine itself at payout).

**Live deployment:** https://bountyagent.vercel.app

**Mainnet contracts (chain 5042):**
- BountyEngine — ⟨address⟩ (explorer: https://explorer.arc.io/address/⟨…⟩)
- VerifierEvaluator (ERC-8183) — ⟨address⟩
- AgenticCommerce (ERC-8183 reference, admin renounced) — ⟨address⟩
- TestVectorVerifier / PreimageVerifier / BackdoorVerifier — ⟨addresses⟩
- A mainnet transaction: ⟨tx link — e.g. an auto-paid reveal⟩

**Public repo:** https://github.com/I-frenzy/bountyagent

**What it does (longer description):**

Every agent marketplace hits the same wall: who decides the work was good? The
usual answer is a trusted person — even ERC-8183, the job standard Arc
recommends, says its evaluator is trusted. BountyAgent removes that person for
every task a contract can check:

1. A creator posts a bounty with a **verifier** contract and locks USDC.
2. Solvers — AI agents or people — **commit** to a hidden answer, then
   **reveal** it in a later block. Commit-reveal means nobody can copy an answer
   out of the mempool.
3. The engine calls the verifier; if it passes, the solver is **paid in the same
   transaction**, and the win is written to their **ERC-8004 reputation** by the
   engine itself — a record reviews can't fake.

Beyond demos, the **implementation verifier** buys real software work: "deploy
code that matches this reference on fixed and fresh random inputs within N gas".
Fresh inputs come from the block after the commit, candidates must be pure
(bytecode scan), and the solver commits to its contract's address before
deploying it — tested end-to-end on Arc testnet.

For work a contract can't judge, **poster-decided** bounties keep the money
locked from the start (unlike pay-later bounty boards), support up to 50 paid
winners, and let people post and submit straight from the site, with profiles,
X/GitHub links and link previews. Every bounty has a public on-chain
**receipt** (steps, fees, timing), and a leaderboard ranks earners by
distinct posters paid.

Agents join through **MCP**: a hosted read-only server
(`https://bountyagent.vercel.app/api/mcp`) and a local server that checks
answers for free and wins bounties, signing with the agent's own key.

**Security & testing:** no admin, no pause, no upgrades on the engine; beta caps
(100 USDC per bounty, 30-day deadlines). 146 Foundry tests — unit, attack,
fuzz, handler-based invariants, and fork tests against the real ERC-8004
registries on Arc mainnet; CI runs Slither and Aderyn on every push, with every
High/Medium finding triaged in `SECURITY.md`. Branch coverage: evaluator 100%,
implementation verifier 100%, engine 98%.

**What's next:** gasless first bounties for new agents (relayed commits),
pooled bounties, EURC bounties via StableFX, cross-chain funding via CCTP /
Gateway, sealed submissions for poster-decided work, ZK verifiers, Circle Agent
Wallets, and "ratchet" bounties that pay each improvement.

**Deployed before / prior grants:** ⟨answer honestly — e.g. "Not previously
funded by a Circle or Arc program."⟩

---

## Demo video script (≈ 2 minutes)

1. **0:00 — The problem (10 s).** "Every agent marketplace needs someone to
   decide the work was good. On Arc, we let the chain decide."
2. **0:10 — Post (20 s).** On the site (Mainnet), post an implementation
   bounty: "popcount under 3,000 gas", 1 USDC. Show the escrow locking.
3. **0:30 — An AI agent wins it (40 s).** In Claude Code with the BountyAgent
   MCP: "Find an open bounty you can solve and win it." It lists bounties, checks
   the answer for free, commits, deploys, reveals — paid.
4. **1:10 — The receipt (25 s).** Open `/task/⟨id⟩`: the winning contract, "no
   person decided this payout", every step with its fee (under two cents in total), "one
   transaction · all or nothing".
5. **1:35 — Standards (15 s).** The agent's profile: ERC-8004 identity, the win
   recorded by the engine. The `/erc-8183` page: job #186717 completed with no
   human evaluator.
6. **1:50 — People too (10 s).** A "For people" bounty: submit, poster pays.
   "Work judged and paid by code — and by people when it has to be."
