// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IBountyVerifier} from "./IBountyVerifier.sol";

/**
 * @title BountyEngine
 * @notice A machine-to-machine, outcome-based labor marketplace for Arc with
 *         two settlement modes:
 *
 *   VERIFIED  — the flagship. The creator attaches an on-chain *verifier*
 *               predicate. Agents commit to an answer (commit-reveal, so results
 *               can't be front-run or plagiarised), then reveal; the engine calls
 *               the verifier and, if the answer passes, settles the escrowed
 *               native USDC to the solver *in the same transaction*. No human
 *               judge, no trust — the chain itself is the arbiter.
 *
 *   CURATED   — for open-ended / subjective work a contract can't judge. Agents
 *               submit results; the task's validator approves a winner. Trust the
 *               validator, not this contract. A post-deadline reclaim protects
 *               creators from funds locked by an absent validator.
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
        Curated, // validator picks a winner
        Verified // on-chain verifier auto-settles
    }
    enum Status {
        Open,
        Completed,
        Cancelled
    }

    struct Task {
        address creator;
        uint64 createdAt;
        address validator; // curated only (address(0) in verified)
        uint64 resolveDeadline; // after it (+REVEAL_GRACE if verified) creator may reclaim
        address verifier; // verified only (address(0) in curated)
        uint64 createdBlock;
        address winner;
        uint64 settledBlock; // block the task left Open (paid or refunded); 0 while open
        Mode mode;
        Status status;
        uint256 reward; // original bounty; never zeroed — `status` guards payout
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
    error EmptyCommitment();
    error SelfSolve();
    error NoCommit();
    error RevealTooEarly();
    error BadReveal();
    error InvalidAnswer();
    error NotCreator();
    error AlreadyEngaged();
    error NotExpired();
    error TransferFailed();
    error Reentrant();

    // --- Storage -----------------------------------------------------------
    uint256 public taskCount;
    mapping(uint256 => Task) private _tasks;

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
        string spec
    );
    event ResultSubmitted(uint256 indexed taskId, address indexed agent, uint256 index, string resultURI);
    event AnswerCommitted(uint256 indexed taskId, address indexed agent, bytes32 commitment);
    event AnswerRevealed(uint256 indexed taskId, address indexed agent, bytes answer);
    event TaskCompleted(uint256 indexed taskId, address indexed winner, uint256 reward, Mode mode);
    event TaskRefunded(uint256 indexed taskId, uint256 amount, bool expired);

    constructor() {
        owner = msg.sender;
    }

    // =======================================================================
    //                              CREATE
    // =======================================================================

    /// @notice Post a CURATED task; a validator will approve the winner.
    function createTask(string calldata spec, address validator, uint64 resolveDeadline)
        external
        payable
        returns (uint256 taskId)
    {
        taskId = _open(spec, resolveDeadline);
        Task storage t = _tasks[taskId];
        t.mode = Mode.Curated;
        t.validator = validator == address(0) ? msg.sender : validator;
        emit TaskCreated(taskId, msg.sender, Mode.Curated, msg.value, t.validator, resolveDeadline, spec);
    }

    /// @notice Post a VERIFIED task; a passing answer auto-settles on-chain.
    /// @param verifier   contract implementing IBountyVerifier (STATICCALLed).
    /// @param taskData   opaque data handed to the verifier (e.g. target hash).
    function createVerifiedTask(
        string calldata spec,
        address verifier,
        bytes calldata taskData,
        uint64 resolveDeadline
    ) external payable returns (uint256 taskId) {
        if (verifier == address(0)) revert NoVerifier();
        if (verifier.code.length == 0) revert VerifierNotContract();
        taskId = _open(spec, resolveDeadline);
        Task storage t = _tasks[taskId];
        t.mode = Mode.Verified;
        t.verifier = verifier;
        t.taskData = taskData;
        emit TaskCreated(taskId, msg.sender, Mode.Verified, msg.value, verifier, resolveDeadline, spec);
    }

    function _open(string calldata spec, uint64 resolveDeadline) private returns (uint256 taskId) {
        if (msg.value == 0) revert NoBounty();
        if (msg.value > MAX_REWARD) revert RewardTooHigh();
        if (bytes(spec).length == 0) revert EmptySpec();
        if (resolveDeadline < block.timestamp + MIN_DURATION) revert DeadlineTooSoon();
        if (resolveDeadline > block.timestamp + MAX_DURATION) revert DeadlineTooFar();
        taskId = ++taskCount;
        Task storage t = _tasks[taskId];
        t.creator = msg.sender;
        t.reward = msg.value;
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

    function completeTask(uint256 taskId, address winner) external nonReentrant {
        Task storage t = _openTask(taskId);
        if (t.mode != Mode.Curated) revert NotCurated();
        if (msg.sender != t.validator) revert NotValidator();
        if (_submissionOf[taskId][winner] == 0) revert WinnerNeverSubmitted();

        t.status = Status.Completed;
        t.winner = winner;
        t.settledBlock = uint64(block.number);

        _pay(winner, t.reward);
        emit TaskCompleted(taskId, winner, t.reward, Mode.Curated);
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
     * reveal in the same block.
     */
    function commitAnswer(uint256 taskId, bytes32 commitment) external {
        Task storage t = _openTask(taskId);
        if (t.mode != Mode.Verified) revert NotVerified();
        if (block.timestamp > t.resolveDeadline) revert DeadlinePassed();
        if (commitment == bytes32(0)) revert EmptyCommitment();
        if (msg.sender == t.creator) revert SelfSolve();

        if (commitmentOf[taskId][msg.sender] == bytes32(0)) commitCount[taskId] += 1;
        commitmentOf[taskId][msg.sender] = commitment;
        commitBlockOf[taskId][msg.sender] = block.number;
        emit AnswerCommitted(taskId, msg.sender, commitment);
    }

    /**
     * @notice Step 2 — reveal the answer; if the verifier accepts it, the
     *         escrow settles to you atomically. First valid revealer wins.
     *         Reveals stay open past the deadline until the creator reclaims,
     *         which cannot happen before `resolveDeadline + REVEAL_GRACE`.
     */
    function revealAndClaim(uint256 taskId, bytes calldata answer, bytes32 salt) external nonReentrant {
        Task storage t = _openTask(taskId);
        if (t.mode != Mode.Verified) revert NotVerified();

        bytes32 commitment = commitmentOf[taskId][msg.sender];
        if (commitment == bytes32(0)) revert NoCommit();
        if (block.number <= commitBlockOf[taskId][msg.sender]) revert RevealTooEarly();
        if (keccak256(abi.encode(answer, salt, msg.sender)) != commitment) revert BadReveal();

        // Verifier is STATICCALLed (view) — it cannot reenter or mutate state.
        // A broken/reverting verifier is treated as "not valid", never a brick.
        bool ok;
        try IBountyVerifier(t.verifier).verify(t.taskData, answer, msg.sender, commitBlockOf[taskId][msg.sender])
        returns (bool r) {
            ok = r;
        } catch {
            ok = false;
        }
        if (!ok) revert InvalidAnswer();

        t.status = Status.Completed;
        t.winner = msg.sender;
        t.settledBlock = uint64(block.number);

        emit AnswerRevealed(taskId, msg.sender, answer);
        _pay(msg.sender, t.reward);
        emit TaskCompleted(taskId, msg.sender, t.reward, Mode.Verified);
    }

    // =======================================================================
    //                         REFUND / CANCEL
    // =======================================================================

    /**
     * @notice Creator reclaims before any agent has engaged (zero curated
     *         submissions / zero verified commits) — no worker can be rug-pulled.
     */
    function cancelTask(uint256 taskId) external nonReentrant {
        Task storage t = _openTask(taskId);
        if (msg.sender != t.creator) revert NotCreator();
        uint256 engaged = t.mode == Mode.Curated ? _submissions[taskId].length : commitCount[taskId];
        if (engaged != 0) revert AlreadyEngaged();

        t.status = Status.Cancelled;
        t.settledBlock = uint64(block.number);
        _pay(t.creator, t.reward);
        emit TaskRefunded(taskId, t.reward, false);
    }

    /**
     * @notice After `resolveDeadline`, an unresolved task's creator reclaims the
     *         bounty — even if agents engaged. This is the anti-lockup guarantee.
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

        t.status = Status.Cancelled;
        t.settledBlock = uint64(block.number);
        _pay(t.creator, t.reward);
        emit TaskRefunded(taskId, t.reward, true);
    }

    // =======================================================================
    //                              INTERNAL / VIEWS
    // =======================================================================

    function _openTask(uint256 taskId) private view returns (Task storage t) {
        t = _tasks[taskId];
        if (t.creator == address(0)) revert NoTask();
        if (t.status != Status.Open) revert NotOpen();
    }

    function _pay(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function getTask(uint256 taskId) external view returns (Task memory) {
        return _tasks[taskId];
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

    /// @notice Helper so off-chain agents compute the exact commitment the
    ///         contract expects. Pure — free to call.
    function computeCommitment(bytes calldata answer, bytes32 salt, address solver)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(answer, salt, solver));
    }
}
