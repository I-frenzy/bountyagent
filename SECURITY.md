# Security

BountyAgent holds real USDC on Arc mainnet. This page covers how to report a
problem, what protects user funds, and how every automated finding was triaged.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability**
on this repository. Don't open a public issue for anything that could put funds
at risk. You'll get a reply within 72 hours.

## What protects funds

- **No admin.** `BountyEngine` has no owner powers, no pause, no upgrade path.
  `owner()` exists only for provenance (Tally) and controls nothing.
- **Our ERC-8183 instance is admin-less too.** `AgenticCommerce` is deployed
  behind a proxy and the deployer renounces every role in the same script
  (`script/DeployCommerce.s.sol`): fees are fixed at 0, no hooks can be added,
  no upgrades. The reference implementation's admin could otherwise raise fees
  to 100% or upgrade the contract.
- **Every escrow expires.** Deadlines are mandatory (10 min – 30 days), so one
  junk submission can't lock funds forever; a verified solver who committed in
  time gets a 15-minute reveal grace before the creator can reclaim.
- **Beta caps.** At most 100 USDC per bounty and 50 submitters per curated task,
  enforced in the contract. They bound what any undiscovered bug could cost.
- **Multi-claim bounties can't be copied or double-paid.** A bounty split among
  N winners pays each address at most once; in verified mode only commits made in
  a block *before* the first payout can win, so an answer seen in the first
  reveal (even in the mempool) can't be reused. Unpaid shares always go back to
  the creator — early via the validator's `finalizeTask`, or after the deadline.
- **Checks-effects-interactions + transient reentrancy guards** on every payout.

## Known limits (by design, disclosed)

- **Curated mode trusts its validator.** The deadline bounds the downside; it
  doesn't remove the trust.
- **Verifiers are chosen by the creator.** A malicious verifier can't take funds
  (it's called read-only, and a revert counts as "invalid"), but it can make a
  task unwinnable. The UI marks audited templates.
- **TestVectorVerifier is property testing.** Code that's wrong on a small
  fraction of inputs could pass one random draw; creators should list edge cases
  as fixed inputs. Random inputs come from `blockhash(commitBlock + 1)`, which
  Arc's (permissioned) validators could in principle influence.
- **ERC-8183 (reference) behaviour:** a provider can change the budget until the
  job is funded, so clients must approve exactly the agreed amount (the UI does);
  after `expiredAt` anyone can trigger the refund, so providers must settle first.
- **Arc blocklist:** Arc reverts transfers to or from blocklisted addresses. If a
  creator is blocklisted after posting, their own refund can't be delivered.

## Automated analysis — triage

CI runs Foundry tests, coverage, [Slither](https://github.com/crytic/slither)
and [Aderyn](https://github.com/Cyfrin/aderyn) on every push
(`.github/workflows/ci.yml`). Every High/Medium finding was reviewed by hand:

| Tool · finding | Where | Verdict |
|---|---|---|
| Slither `arbitrary-send-eth`, forge-lint `arbitrary-send-eth` | `BountyEngine._pay` | **By design** — paying the winner/creator is the product. State is final before the call; guarded. |
| Slither `arbitrary-send-erc20` | `AgenticCommerce.fund` | **False positive** — `from` is `job.client`, and only the client can call `fund`. |
| Slither `weak-prng` | `TestVectorVerifier` | **Accepted** — it selects test inputs, not money; the seed is fixed after the commit. Modulo bias is irrelevant here. |
| Slither `reentrancy-no-eth` / `reentrancy-benign` | `AgenticCommerce` hooks | **Not reachable** — hooks must be whitelisted by an admin; ours has none, so only "no hook" is allowed (tested). Functions are also `nonReentrant`. |
| Aderyn H-2, forge-lint `reentrancy-*` | Engine verifier call; evaluator `getJob` | **False positive** — these calls go through `view` interfaces (STATICCALL) and can't change state; payouts are guarded (re-entry tested with attacker contracts). |
| forge-lint `reentrancy-events` | Engine payouts | **Fixed** — events are now emitted before the transfer. |
| Aderyn H-1 "locks Ether" | `AgenticCommerce` | **False positive** — only the payable upgrade function accepts value, and with admin renounced it always reverts, returning the funds. |
| Slither `uninitialized-local` | `revealAndClaim.ok` | **Cleaned up** — initialized explicitly. |
| `return-bomb` | `TestVectorVerifier._matches` | **Accepted** — the candidate's gas cap bounds how much it can return; a bomb only fails the solver's own reveal. |
| forge-lint `divide-before-multiply` | Engine share math | **Safe** — creation requires `reward % maxWinners == 0`, so `reward / maxWinners` is exact. |
| `calls-loop`, `revert-in-loop`, `timestamp`, `unsafe-typecast` | various | **Accepted** — loops are bounded (≤ 64 vectors); deadlines are minute-scale; `uint64` timestamps/blocks can't overflow in practice. |

## Tests

Unit, attack, fuzz (10,000 runs) and handler-based invariant tests. The
invariants: the engine's balance always equals the unpaid shares of open
bounties, every USDC in is either escrowed or paid out exactly once, and each
bounty pays exactly one payout per winner (no duplicates, never more than
`maxWinners`) plus at most one refund. Attack tests
cover malicious verifiers (revert, gas burn, return bomb, state writes, garbage
return), re-entrant and rejecting recipients, copied commitments, low-gas
griefing, lookup-table and stateful cheats, and a malicious ERC-8183 contract.
Branch coverage: `VerifierEvaluator` 100%, `TestVectorVerifier` 100%,
`BountyEngine` 97%.
