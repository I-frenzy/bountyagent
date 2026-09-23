// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

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
 *               judge, no trust — the chain itself is the arbiter. A valid solver
 *               is paid atomically on reveal, so nothing the creator does can
 *               ever rug a rightful winner.
 *
 *   CURATED   — for open-ended / subjective work a contract can't judge. Agents
 *               submit results; the task's validator approves a winner. Trust the
 *               validator, not this contract. A post-deadline reclaim protects
 *               creators from funds locked by an absent validator.
 *
 * Arc uses USDC as its native gas asset, so `msg.value` *is* USDC. Sub-second
 * finality + native-USDC fees make sub-dollar micro-bounties economical.
 *
 * `owner()` is identity-only (for Tally provenance) and has zero power over funds.
 */
contract BountyEngine {
    // --- Provenance (identity only; no privileges) -------------------------
    address public immutable owner;

    // --- Reentrancy guard --------------------------------------------------
    uint256 private _lock = 1;
    modifier nonReentrant() {
        require(_lock == 1, "reentrant");
        _lock = 2;
        _;
        _lock = 1;
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
        address validator; // curated only (address(0) in verified)
        address verifier; // verified only (address(0) in curated)
        uint256 reward; // escrowed native USDC (zeroed on settle/refund)
        uint64 createdAt;
        uint64 resolveDeadline; // 0 = none; after it, creator may reclaim
        Mode mode;
        Status status;
        address winner;
        string spec; // human/agent-readable requirements (URI or inline)
        bytes taskData; // verified: opaque data passed to the verifier
    }

    struct Submission {
        address agent;
        uint64 submittedAt;
        string resultURI;
    }

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
    event AnswerRevealed(uint256 indexed taskId, address indexed agent, bool valid);
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
        taskId = _open(spec);
        Task storage t = _tasks[taskId];
        t.mode = Mode.Curated;
        t.validator = validator == address(0) ? msg.sender : validator;
        t.resolveDeadline = resolveDeadline;
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
        require(verifier != address(0), "no verifier");
        require(verifier.code.length > 0, "verifier not a contract");
        taskId = _open(spec);
        Task storage t = _tasks[taskId];
        t.mode = Mode.Verified;
        t.verifier = verifier;
        t.taskData = taskData;
        t.resolveDeadline = resolveDeadline;
        emit TaskCreated(taskId, msg.sender, Mode.Verified, msg.value, verifier, resolveDeadline, spec);
    }

    function _open(string calldata spec) private returns (uint256 taskId) {
        require(msg.value > 0, "no bounty");
        require(bytes(spec).length > 0, "empty spec");
        taskId = ++taskCount;
        Task storage t = _tasks[taskId];
        t.creator = msg.sender;
        t.reward = msg.value;
        t.createdAt = uint64(block.timestamp);
        t.status = Status.Open;
        t.spec = spec;
    }

    // =======================================================================
    //                          CURATED FLOW
    // =======================================================================

    function submitResult(uint256 taskId, string calldata resultURI) external {
        Task storage t = _tasks[taskId];
        require(t.creator != address(0), "no task");
        require(t.mode == Mode.Curated, "not curated");
        require(t.status == Status.Open, "not open");
        require(bytes(resultURI).length > 0, "empty result");
        require(msg.sender != t.creator && msg.sender != t.validator, "self-submit");

        uint256 slot = _submissionOf[taskId][msg.sender];
        if (slot == 0) {
            _submissions[taskId].push(
                Submission({agent: msg.sender, submittedAt: uint64(block.timestamp), resultURI: resultURI})
            );
            uint256 index = _submissions[taskId].length - 1;
            _submissionOf[taskId][msg.sender] = index + 1;
            emit ResultSubmitted(taskId, msg.sender, index, resultURI);
        } else {
            uint256 index = slot - 1;
            _submissions[taskId][index].resultURI = resultURI;
            _submissions[taskId][index].submittedAt = uint64(block.timestamp);
            emit ResultSubmitted(taskId, msg.sender, index, resultURI);
        }
    }

    function completeTask(uint256 taskId, address winner) external nonReentrant {
        Task storage t = _tasks[taskId];
        require(t.creator != address(0), "no task");
        require(t.mode == Mode.Curated, "not curated");
        require(t.status == Status.Open, "not open");
        require(msg.sender == t.validator, "not validator");
        require(_submissionOf[taskId][winner] != 0, "winner never submitted");

        uint256 reward = t.reward;
        t.status = Status.Completed;
        t.winner = winner;
        t.reward = 0;

        _pay(winner, reward);
        emit TaskCompleted(taskId, winner, reward, Mode.Curated);
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
        Task storage t = _tasks[taskId];
        require(t.creator != address(0), "no task");
        require(t.mode == Mode.Verified, "not verified");
        require(t.status == Status.Open, "not open");
        require(commitment != bytes32(0), "empty commitment");
        require(msg.sender != t.creator, "self-solve");

        if (commitmentOf[taskId][msg.sender] == bytes32(0)) commitCount[taskId] += 1;
        commitmentOf[taskId][msg.sender] = commitment;
        commitBlockOf[taskId][msg.sender] = block.number;
        emit AnswerCommitted(taskId, msg.sender, commitment);
    }

    /**
     * @notice Step 2 — reveal the answer; if the verifier accepts it, the
     *         escrow settles to you atomically. First valid revealer wins.
     */
    function revealAndClaim(uint256 taskId, bytes calldata answer, bytes32 salt) external nonReentrant {
        Task storage t = _tasks[taskId];
        require(t.creator != address(0), "no task");
        require(t.mode == Mode.Verified, "not verified");
        require(t.status == Status.Open, "not open");

        bytes32 commitment = commitmentOf[taskId][msg.sender];
        require(commitment != bytes32(0), "no commit");
        require(block.number > commitBlockOf[taskId][msg.sender], "reveal too early");
        require(keccak256(abi.encode(answer, salt, msg.sender)) == commitment, "bad reveal");

        // Verifier is STATICCALLed (view) — it cannot reenter or mutate state.
        // A broken/reverting verifier is treated as "not valid", never a brick.
        bool ok;
        try IBountyVerifier(t.verifier).verify(t.taskData, answer, msg.sender) returns (bool r) {
            ok = r;
        } catch {
            ok = false;
        }
        emit AnswerRevealed(taskId, msg.sender, ok);
        require(ok, "invalid answer");

        uint256 reward = t.reward;
        t.status = Status.Completed;
        t.winner = msg.sender;
        t.reward = 0;

        _pay(msg.sender, reward);
        emit TaskCompleted(taskId, msg.sender, reward, Mode.Verified);
    }

    // =======================================================================
    //                         REFUND / CANCEL
    // =======================================================================

    /**
     * @notice Creator reclaims before any agent has engaged (zero curated
     *         submissions / zero verified commits) — no worker can be rug-pulled.
     */
    function cancelTask(uint256 taskId) external nonReentrant {
        Task storage t = _tasks[taskId];
        require(t.creator != address(0), "no task");
        require(t.status == Status.Open, "not open");
        require(msg.sender == t.creator, "not creator");
        uint256 engaged = t.mode == Mode.Curated ? _submissions[taskId].length : commitCount[taskId];
        require(engaged == 0, "already engaged");

        uint256 refund = t.reward;
        t.status = Status.Cancelled;
        t.reward = 0;
        _pay(t.creator, refund);
        emit TaskRefunded(taskId, refund, false);
    }

    /**
     * @notice After `resolveDeadline`, an unresolved task's creator reclaims the
     *         bounty — even if agents engaged. This is the anti-lockup guarantee.
     *         In VERIFIED mode this can never rug a rightful winner: a valid
     *         solver is paid atomically on reveal *before* any deadline matters.
     *         In CURATED mode it protects the creator from an absent validator.
     */
    function reclaimExpired(uint256 taskId) external nonReentrant {
        Task storage t = _tasks[taskId];
        require(t.creator != address(0), "no task");
        require(t.status == Status.Open, "not open");
        require(msg.sender == t.creator, "not creator");
        require(t.resolveDeadline != 0 && block.timestamp > t.resolveDeadline, "not expired");

        uint256 refund = t.reward;
        t.status = Status.Cancelled;
        t.reward = 0;
        _pay(t.creator, refund);
        emit TaskRefunded(taskId, refund, true);
    }

    // =======================================================================
    //                              INTERNAL / VIEWS
    // =======================================================================

    function _pay(address to, uint256 amount) private {
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "transfer failed");
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
