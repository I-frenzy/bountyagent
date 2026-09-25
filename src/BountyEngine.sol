// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IBountyVerifier} from "./IBountyVerifier.sol";
import {IIdentityRegistry, IReputationRegistry} from "./erc8004/IERC8004.sol";

/**
 * @title BountyEngine
 * @notice An outcome-based labor marketplace for Arc — for AI agents and people
 *         alike — with two settlement modes:
 *
 *   VERIFIED  — the flagship. The creator attaches an on-chain *verifier*
 *               predicate. Solvers commit to an answer (commit-reveal, so results
 *               can't be front-run or plagiarised), then reveal; the engine calls
 *               the verifier and, if the answer passes, settles the escrowed
 *               native USDC to the solver *in the same transaction*. No human
 *               judge, no trust — the chain itself is the arbiter.
 *
 *   CURATED   — for open-ended / subjective work a contract can't judge. Anyone
 *               submits results; the task's validator approves winners. Trust the
 *               validator, not this contract. The money is escrowed up front, and
 *               a post-deadline reclaim protects creators from an absent validator.
 *
 * MULTI-CLAIM — a bounty can pay up to `maxWinners` solvers an equal share
 *               (`reward / maxWinners`). Each address wins at most once. In
 *               verified mode the first `maxWinners` valid reveals are paid, and
 *               only commits made in a block *before* the first payout count — so
 *               nobody can copy an answer once it has been revealed.
 *
 * Arc uses USDC as its native gas asset, so `msg.value` *is* USDC (18-decimal
 * native view). Sub-second finality + native-USDC fees make sub-dollar
 * micro-bounties economical.
 *
 * No admin, no pause, no upgradeability. `owner()` is identity-only (for Tally
 * provenance) and has zero power over funds. Beta exposure is bounded instead by
 * hard caps: MAX_REWARD per task and MAX_DURATION per deadline.
 */
contract BountyEngine {
    // --- Provenance (identity only; no privileges) -------------------------
    address public immutable owner;

    // --- ERC-8004 (identity + reputation); address(0) disables it ------------
    IIdentityRegistry public immutable identityRegistry;
    IReputationRegistry public immutable reputationRegistry;
    /// Gas reserved for recording a win on the reputation registry. A payout
    /// reverts if it can't give the registry this much, so nobody can starve
    /// the call to deny a winner their record — but a registry failure never
    /// blocks the payout itself.
    uint256 public constant FEEDBACK_GAS = 400_000;
    string public constant FEEDBACK_TAG = "bountyagent";
    /// Gas cap for each identity lookup (ownerOf / getAgentWallet) on the payout path.
    uint256 public constant LOOKUP_GAS = 60_000;

    // --- Limits ------------------------------------------------------------
    /// Every task must expire, so a junk submission/commit can never lock an
    /// escrow forever (cancelTask is blocked once anyone engages).
    uint64 public constant MIN_DURATION = 10 minutes;
    /// Beta cap: bounds how long funds can sit in escrow.
    uint64 public constant MAX_DURATION = 30 days;
    /// Verified mode: commits close at the deadline, but a solver who committed
    /// in time gets this long to reveal before the creator may reclaim.
    uint64 public constant REVEAL_GRACE = 15 minutes;
    /// Beta cap: maximum bounty per task (100 USDC, native 18-decimal view).
    uint256 public constant MAX_REWARD = 100 ether;
    /// Curated: distinct submitters per task (keeps getSubmissions bounded).
    uint256 public constant MAX_SUBMISSIONS = 50;
    /// Multi-claim: maximum number of paid winners per task.
    uint16 public constant MAX_WINNERS = 50;

    // --- Reentrancy guard (transient storage, EIP-1153) --------------------
    bool private transient _locked;

    modifier nonReentrant() {
        if (_locked) revert Reentrant();
        _locked = true;
        _;
        _locked = false;
    }

    // --- Types -------------------------------------------------------------
    enum Mode {
        Curated, // validator picks winners
        Verified // on-chain verifier auto-settles
    }
    enum Status {
        Open,
        Completed, // at least one winner was paid; no more payouts
        Cancelled // nobody was paid; the creator was refunded
    }

    struct Task {
        address creator;
        uint64 createdAt;
        address validator; // curated only (address(0) in verified)
        uint64 resolveDeadline; // after it (+REVEAL_GRACE if verified) creator may reclaim
        address verifier; // verified only (address(0) in curated)
        uint64 createdBlock;
        address winner; // first winner (the only one when maxWinners == 1); see getWinners
        uint64 settledBlock; // block the task left Open; 0 while open
        Mode mode;
        Status status;
        uint16 maxWinners; // equal shares of `reward`
        uint16 paidCount; // winners paid so far
        uint64 firstPaidBlock; // block of the first payout; 0 before it
        uint256 reward; // total bounty; never zeroed — status + paidCount guard payouts
        string spec; // human/agent-readable requirements (URI or inline)
        bytes taskData; // verified: opaque data passed to the verifier
    }

    struct Submission {
        address agent;
        uint64 submittedAt;
        string resultURI;
    }

    // --- Errors ------------------------------------------------------------
    error NoBounty();
    error RewardTooHigh();
    error BadWinnerCount();
    error UnevenShares();
    error EmptySpec();
    error DeadlineTooSoon();
    error DeadlineTooFar();
    error NoVerifier();
    error VerifierNotContract();
    error NoTask();
    error NotCurated();
    error NotVerified();
    error NotOpen();
    error DeadlinePassed();
    error EmptyResult();
    error SelfSubmit();
    error TooManySubmissions();
    error NotValidator();
    error WinnerNeverSubmitted();
    error AlreadyWon();
    error NothingPaidYet();
    error EmptyCommitment();
    error SelfSolve();
    error CommitsClosed();
    error NoCommit();
    error RevealTooEarly();
    error BadReveal();
    error InvalidAnswer();
    error NotCreator();
    error AlreadyEngaged();
    error NotExpired();
    error TransferFailed();
    error Reentrant();
    error NoIdentityRegistry();
    error NotAgentOwner();
    error InsufficientGasForFeedback();

    // --- Storage -----------------------------------------------------------
    uint256 public taskCount;
    mapping(uint256 => Task) private _tasks;
    mapping(uint256 => address[]) private _winners;
    mapping(uint256 => mapping(address => bool)) public hasWon;
    /// Profile link: the ERC-8004 agent (profile) an address has claimed.
    mapping(address => uint256) public agentIdOf;

    // curated submissions
    mapping(uint256 => Submission[]) private _submissions;
    mapping(uint256 => mapping(address => uint256)) private _submissionOf; // index+1

    // verified commit-reveal
    mapping(uint256 => mapping(address => bytes32)) public commitmentOf;
    mapping(uint256 => mapping(address => uint256)) public commitBlockOf;
    mapping(uint256 => uint256) public commitCount;

    // --- Events ------------------------------------------------------------
    event TaskCreated(
        uint256 indexed taskId,
        address indexed creator,
        Mode mode,
        uint256 reward,
        address validatorOrVerifier,
        uint64 resolveDeadline,
        uint16 maxWinners,
        string spec
    );
    event ResultSubmitted(uint256 indexed taskId, address indexed agent, uint256 index, string resultURI);
    event AnswerCommitted(uint256 indexed taskId, address indexed agent, bytes32 commitment);
    event AnswerRevealed(uint256 indexed taskId, address indexed agent, bytes answer);
    /// One per paid winner; `amount` is that winner's share.
    event WinnerPaid(uint256 indexed taskId, address indexed winner, uint256 amount, Mode mode);
    /// The task left Open: all shares paid, finalized early, cancelled or expired.
    event TaskClosed(uint256 indexed taskId, Status status, uint16 winners, uint256 refunded);
    event AgentLinked(address indexed account, uint256 indexed agentId);
    /// A paid win was written to the ERC-8004 reputation registry (or not, with the reason).
    event ReputationRecorded(uint256 indexed taskId, address indexed winner, uint256 indexed agentId, bool ok);

    constructor(IIdentityRegistry identity_, IReputationRegistry reputation_) {
        owner = msg.sender;
        identityRegistry = identity_;
        reputationRegistry = reputation_;
    }

    // =======================================================================
    //                              CREATE
    // =======================================================================

    /// @notice Post a CURATED task; a validator approves up to `maxWinners` winners.
    function createTask(string calldata spec, address validator, uint64 resolveDeadline, uint16 maxWinners)
        external
        payable
        returns (uint256 taskId)
    {
        taskId = _open(spec, resolveDeadline, maxWinners);
        Task storage t = _tasks[taskId];
        t.mode = Mode.Curated;
        t.validator = validator == address(0) ? msg.sender : validator;
        _announce(taskId, t, t.validator, spec);
    }

    /// @notice Post a VERIFIED task; the first `maxWinners` valid answers auto-settle.
    /// @param verifier   contract implementing IBountyVerifier (STATICCALLed).
    /// @param taskData   opaque data handed to the verifier (e.g. target hash).
    function createVerifiedTask(
        string calldata spec,
        address verifier,
        bytes calldata taskData,
        uint64 resolveDeadline,
        uint16 maxWinners
    ) external payable returns (uint256 taskId) {
        if (verifier == address(0)) revert NoVerifier();
        if (verifier.code.length == 0) revert VerifierNotContract();
        taskId = _open(spec, resolveDeadline, maxWinners);
        Task storage t = _tasks[taskId];
        t.mode = Mode.Verified;
        t.verifier = verifier;
        t.taskData = taskData;
        _announce(taskId, t, verifier, spec);
    }

    function _announce(uint256 taskId, Task storage t, address validatorOrVerifier, string calldata spec) private {
        emit TaskCreated(
            taskId, t.creator, t.mode, t.reward, validatorOrVerifier, t.resolveDeadline, t.maxWinners, spec
        );
    }

    function _open(string calldata spec, uint64 resolveDeadline, uint16 maxWinners) private returns (uint256 taskId) {
        if (msg.value == 0) revert NoBounty();
        if (msg.value > MAX_REWARD) revert RewardTooHigh();
        if (maxWinners == 0 || maxWinners > MAX_WINNERS) revert BadWinnerCount();
        if (msg.value % maxWinners != 0) revert UnevenShares();
        if (bytes(spec).length == 0) revert EmptySpec();
        if (resolveDeadline < block.timestamp + MIN_DURATION) revert DeadlineTooSoon();
        if (resolveDeadline > block.timestamp + MAX_DURATION) revert DeadlineTooFar();
        taskId = ++taskCount;
        Task storage t = _tasks[taskId];
        t.creator = msg.sender;
        t.reward = msg.value;
        t.maxWinners = maxWinners;
        t.createdAt = uint64(block.timestamp);
        t.createdBlock = uint64(block.number);
        t.resolveDeadline = resolveDeadline;
        t.status = Status.Open;
        t.spec = spec;
    }

    // =======================================================================
    //                          CURATED FLOW
    // =======================================================================

    function submitResult(uint256 taskId, string calldata resultURI) external {
        Task storage t = _openTask(taskId);
        if (t.mode != Mode.Curated) revert NotCurated();
        if (block.timestamp > t.resolveDeadline) revert DeadlinePassed();
        if (bytes(resultURI).length == 0) revert EmptyResult();
        if (msg.sender == t.creator || msg.sender == t.validator) revert SelfSubmit();

        uint256 slot = _submissionOf[taskId][msg.sender];
        uint256 index;
        if (slot == 0) {
            if (_submissions[taskId].length >= MAX_SUBMISSIONS) revert TooManySubmissions();
            _submissions[taskId].push(
                Submission({agent: msg.sender, submittedAt: uint64(block.timestamp), resultURI: resultURI})
            );
            index = _submissions[taskId].length - 1;
            _submissionOf[taskId][msg.sender] = index + 1;
        } else {
            index = slot - 1;
            _submissions[taskId][index].resultURI = resultURI;
            _submissions[taskId][index].submittedAt = uint64(block.timestamp);
        }
        emit ResultSubmitted(taskId, msg.sender, index, resultURI);
    }

    /// @notice Validator approves one winner, who is paid one share immediately.
    ///         The task completes once all `maxWinners` shares are paid.
    function completeTask(uint256 taskId, address winner) external nonReentrant {
        Task storage t = _openTask(taskId);
        if (t.mode != Mode.Curated) revert NotCurated();
        if (msg.sender != t.validator) revert NotValidator();
        if (_submissionOf[taskId][winner] == 0) revert WinnerNeverSubmitted();
        _payWinner(taskId, t, winner);
    }

    /**
     * @notice Validator ends a multi-claim task early, after paying at least one
     *         winner: the unpaid shares go back to the creator now instead of
     *         after the deadline.
     */
    function finalizeTask(uint256 taskId) external nonReentrant {
        Task storage t = _openTask(taskId);
        if (t.mode != Mode.Curated) revert NotCurated();
        if (msg.sender != t.validator) revert NotValidator();
        if (t.paidCount == 0) revert NothingPaidYet();
        _closeWithRefund(taskId, t);
    }

    // =======================================================================
    //                       VERIFIED FLOW (commit-reveal)
    // =======================================================================

    /**
     * @notice Step 1 — commit to an answer without revealing it.
     * @param commitment keccak256(abi.encode(answer, salt, msg.sender)).
     *
     * Binding the commitment to the sender + requiring the reveal in a strictly
     * later block means no one can watch your reveal in the mempool and steal
     * the payout: they have no prior matching commit, and they cannot commit and
     * reveal in the same block. Commits close once any winner has been paid.
     */
    function commitAnswer(uint256 taskId, bytes32 commitment) external {
        Task storage t = _openTask(taskId);
        if (t.mode != Mode.Verified) revert NotVerified();
        if (block.timestamp > t.resolveDeadline) revert DeadlinePassed();
        if (t.paidCount != 0) revert CommitsClosed();
        if (commitment == bytes32(0)) revert EmptyCommitment();
        if (msg.sender == t.creator) revert SelfSolve();

        if (commitmentOf[taskId][msg.sender] == bytes32(0)) commitCount[taskId] += 1;
        commitmentOf[taskId][msg.sender] = commitment;
        commitBlockOf[taskId][msg.sender] = block.number;
        emit AnswerCommitted(taskId, msg.sender, commitment);
    }

    /**
     * @notice Step 2 — reveal the answer; if the verifier accepts it, you are
     *         paid a share atomically. The first `maxWinners` valid revealers win.
     *         Reveals stay open past the deadline until the creator reclaims,
     *         which cannot happen before `resolveDeadline + REVEAL_GRACE`.
     */
    function revealAndClaim(uint256 taskId, bytes calldata answer, bytes32 salt) external nonReentrant {
        Task storage t = _openTask(taskId);
        if (t.mode != Mode.Verified) revert NotVerified();

        bytes32 commitment = commitmentOf[taskId][msg.sender];
        if (commitment == bytes32(0)) revert NoCommit();
        uint256 commitBlock = commitBlockOf[taskId][msg.sender];
        if (block.number <= commitBlock) revert RevealTooEarly();
        // Multi-claim anti-copy: once an answer has been revealed (first payout),
        // only commits from strictly earlier blocks can still win — a copier who
        // saw the first reveal, even in the mempool, committed too late.
        if (t.paidCount != 0 && commitBlock >= t.firstPaidBlock) revert CommitsClosed();
        if (keccak256(abi.encode(answer, salt, msg.sender)) != commitment) revert BadReveal();

        // Verifier is STATICCALLed (view) — it cannot reenter or mutate state.
        // A broken/reverting verifier is treated as "not valid", never a brick.
        bool ok = false;
        try IBountyVerifier(t.verifier).verify(t.taskData, answer, msg.sender, commitBlock) returns (bool r) {
            ok = r;
        } catch {}
        if (!ok) revert InvalidAnswer();

        emit AnswerRevealed(taskId, msg.sender, answer);
        _payWinner(taskId, t, msg.sender);
    }

    // =======================================================================
    //                         REFUND / CANCEL
    // =======================================================================

    /**
     * @notice Creator reclaims before anyone has engaged (zero curated
     *         submissions / zero verified commits) — no worker can be rug-pulled.
     */
    function cancelTask(uint256 taskId) external nonReentrant {
        Task storage t = _openTask(taskId);
        if (msg.sender != t.creator) revert NotCreator();
        uint256 engaged = t.mode == Mode.Curated ? _submissions[taskId].length : commitCount[taskId];
        if (engaged != 0) revert AlreadyEngaged();
        _closeWithRefund(taskId, t);
    }

    /**
     * @notice After `resolveDeadline`, the creator reclaims whatever is unpaid —
     *         even if solvers engaged. This is the anti-lockup guarantee.
     *         In VERIFIED mode the creator must also wait out REVEAL_GRACE, so a
     *         solver who committed just before the deadline can still reveal and
     *         be paid — the creator cannot race a rightful winner.
     *         In CURATED mode it protects the creator from an absent validator.
     */
    function reclaimExpired(uint256 taskId) external nonReentrant {
        Task storage t = _openTask(taskId);
        if (msg.sender != t.creator) revert NotCreator();
        uint256 reclaimAt = t.mode == Mode.Verified
            ? uint256(t.resolveDeadline) + REVEAL_GRACE
            : uint256(t.resolveDeadline);
        if (block.timestamp <= reclaimAt) revert NotExpired();
        _closeWithRefund(taskId, t);
    }

    // =======================================================================
    //                   PROFILES (ERC-8004 identity) + REPUTATION
    // =======================================================================

    /**
     * @notice Link your ERC-8004 identity (your profile) to your address, so
     *         your wins here are recorded on it. You must own the agent NFT or
     *         be its registered agent wallet. Pass 0 to unlink.
     */
    function linkAgent(uint256 agentId) external {
        if (address(identityRegistry) == address(0)) revert NoIdentityRegistry();
        if (agentId != 0 && !_controls(msg.sender, agentId)) revert NotAgentOwner();
        agentIdOf[msg.sender] = agentId;
        emit AgentLinked(msg.sender, agentId);
    }

    /// True if `account` owns agent `agentId` or is its agent wallet. Never reverts.
    function _controls(address account, uint256 agentId) private view returns (bool) {
        try identityRegistry.ownerOf{gas: LOOKUP_GAS}(agentId) returns (address o) {
            if (o == account) return true;
        } catch {
            return false; // agent doesn't exist
        }
        try identityRegistry.getAgentWallet{gas: LOOKUP_GAS}(agentId) returns (address w) {
            return w == account;
        } catch {
            return false;
        }
    }

    /**
     * Writes a paid win to the ERC-8004 reputation registry, as feedback *from
     * this contract*: value = USDC earned (6 decimals), tag1 = "bountyagent",
     * tag2 = "verified" (checked by a contract) or "curated" (chosen by a
     * person). Readers who filter by this contract's address get a record that
     * can't be faked with reviews. Never blocks the payout: the call is capped,
     * wrapped, and skipped if the winner no longer controls the linked agent.
     */
    function _recordReputation(uint256 taskId, Task storage t, address winner, uint256 share) private {
        if (address(reputationRegistry) == address(0)) return;
        uint256 agentId = agentIdOf[winner];
        if (agentId == 0) return;
        // Make sure the lookups and the registry get their full budgets (63/64
        // rule) BEFORE any of them run, so a caller can't starve a call into
        // failing and silently drop the winner's record.
        if (gasleft() < ((FEEDBACK_GAS + 2 * LOOKUP_GAS) * 64) / 63 + 20_000) revert InsufficientGasForFeedback();
        if (!_controls(winner, agentId)) {
            emit ReputationRecorded(taskId, winner, agentId, false);
            return;
        }
        bool ok;
        try reputationRegistry.giveFeedback{gas: FEEDBACK_GAS}(
            agentId,
            int128(int256(share / 1e12)), // native 18-dec USDC → 6-dec USDC
            6,
            FEEDBACK_TAG,
            t.mode == Mode.Verified ? "verified" : "curated",
            "",
            "",
            bytes32(taskId)
        ) {
            ok = true;
        } catch {}
        emit ReputationRecorded(taskId, winner, agentId, ok);
    }

    // =======================================================================
    //                              INTERNAL / VIEWS
    // =======================================================================

    function _openTask(uint256 taskId) private view returns (Task storage t) {
        t = _tasks[taskId];
        if (t.creator == address(0)) revert NoTask();
        if (t.status != Status.Open) revert NotOpen();
    }

    /// Pays one share to `winner`; completes the task on the last share.
    function _payWinner(uint256 taskId, Task storage t, address winner) private {
        if (hasWon[taskId][winner]) revert AlreadyWon();
        hasWon[taskId][winner] = true;
        _winners[taskId].push(winner);
        if (t.paidCount == 0) {
            t.winner = winner;
            t.firstPaidBlock = uint64(block.number);
        }
        t.paidCount += 1;
        uint256 share = t.reward / t.maxWinners;
        bool last = t.paidCount == t.maxWinners;
        if (last) {
            t.status = Status.Completed;
            t.settledBlock = uint64(block.number);
        }

        emit WinnerPaid(taskId, winner, share, t.mode);
        if (last) emit TaskClosed(taskId, Status.Completed, t.paidCount, 0);
        _recordReputation(taskId, t, winner, share);
        _pay(winner, share);
    }

    /// Closes the task and refunds the unpaid shares to the creator.
    function _closeWithRefund(uint256 taskId, Task storage t) private {
        uint256 refund = t.reward - (t.reward / t.maxWinners) * t.paidCount;
        t.status = t.paidCount == 0 ? Status.Cancelled : Status.Completed;
        t.settledBlock = uint64(block.number);
        emit TaskClosed(taskId, t.status, t.paidCount, refund);
        _pay(t.creator, refund);
    }

    function _pay(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function getTask(uint256 taskId) external view returns (Task memory) {
        return _tasks[taskId];
    }

    function getWinners(uint256 taskId) external view returns (address[] memory) {
        return _winners[taskId];
    }

    /// @notice USDC still held for a task (0 once it has closed).
    function remainingEscrow(uint256 taskId) external view returns (uint256) {
        Task storage t = _tasks[taskId];
        if (t.status != Status.Open) return 0;
        return t.reward - (t.reward / t.maxWinners) * t.paidCount;
    }

    function getSubmissions(uint256 taskId) external view returns (Submission[] memory) {
        return _submissions[taskId];
    }

    function submissionCount(uint256 taskId) external view returns (uint256) {
        return _submissions[taskId].length;
    }

    function hasSubmitted(uint256 taskId, address agent) external view returns (bool) {
        return _submissionOf[taskId][agent] != 0;
    }

    /// @notice Helper so off-chain solvers compute the exact commitment the
    ///         contract expects. Pure — free to call.
    function computeCommitment(bytes calldata answer, bytes32 salt, address solver)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(answer, salt, solver));
    }
}
