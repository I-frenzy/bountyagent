// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title BountyEngine
 * @notice A machine-to-machine, outcome-based labor marketplace for Arc.
 *
 * Task creators lock a native-USDC bounty in escrow alongside a task spec.
 * Autonomous agents discover the task off-chain, do the work, and submit a
 * result payload on-chain. The task's validator picks the winning submission,
 * and the escrowed USDC settles directly to the winning agent's wallet.
 *
 * Arc uses USDC as its native gas asset, so `msg.value` *is* USDC. Sub-second
 * finality + native-USDC fees make sub-dollar micro-bounties economical, which
 * is what makes an agent labor market viable here and not on a typical L1.
 *
 * The contract holds no privileges over funds beyond the escrow rules below —
 * `owner()` is identity-only (for provenance verification via Tally) and can
 * never move a creator's escrow.
 */
contract BountyEngine {
    // --- Provenance (identity only; no privileges) -------------------------
    address public immutable owner;

    // --- Reentrancy guard (inline; no external deps) -----------------------
    uint256 private _lock = 1;
    modifier nonReentrant() {
        require(_lock == 1, "reentrant");
        _lock = 2;
        _;
        _lock = 1;
    }

    // --- Types -------------------------------------------------------------
    enum Status {
        Open, // accepting submissions
        Completed, // a winner was paid
        Cancelled // refunded to creator (only allowed with zero submissions)
    }

    struct Task {
        address creator;
        address validator; // who may approve a winner (defaults to creator)
        uint256 reward; // escrowed native USDC
        uint64 createdAt;
        uint64 deadline; // 0 = no deadline
        Status status;
        address winner; // set on completion
        string spec; // task requirements (IPFS URI or inline text)
    }

    struct Submission {
        address agent;
        uint64 submittedAt;
        string resultURI; // proof/result payload (IPFS URI or inline text)
    }

    // --- Storage -----------------------------------------------------------
    uint256 public taskCount;
    mapping(uint256 => Task) private _tasks;
    mapping(uint256 => Submission[]) private _submissions;
    // taskId => agent => (index+1) into _submissions[taskId]; 0 = none yet
    mapping(uint256 => mapping(address => uint256)) private _submissionOf;

    // --- Events ------------------------------------------------------------
    event TaskCreated(
        uint256 indexed taskId,
        address indexed creator,
        address indexed validator,
        uint256 reward,
        uint64 deadline,
        string spec
    );
    event ResultSubmitted(
        uint256 indexed taskId,
        address indexed agent,
        uint256 submissionIndex,
        string resultURI
    );
    event TaskCompleted(uint256 indexed taskId, address indexed winner, uint256 reward);
    event TaskCancelled(uint256 indexed taskId, uint256 refund);

    constructor() {
        owner = msg.sender;
    }

    // --- Create ------------------------------------------------------------
    /**
     * @notice Post a task and lock its native-USDC bounty in escrow.
     * @param spec       Task requirements (IPFS URI or short inline text).
     * @param validator  Who may approve the winning submission. address(0)
     *                   means the creator validates their own task.
     * @param deadline   Optional unix time after which the creator may reclaim
     *                   the bounty if (and only if) no agent has submitted.
     *                   Pass 0 to disable.
     * @return taskId    The id of the newly created task.
     */
    function createTask(string calldata spec, address validator, uint64 deadline)
        external
        payable
        returns (uint256 taskId)
    {
        require(msg.value > 0, "no bounty");
        require(bytes(spec).length > 0, "empty spec");
        require(deadline == 0 || deadline > block.timestamp, "deadline in past");

        taskId = ++taskCount;
        Task storage t = _tasks[taskId];
        t.creator = msg.sender;
        t.validator = validator == address(0) ? msg.sender : validator;
        t.reward = msg.value;
        t.createdAt = uint64(block.timestamp);
        t.deadline = deadline;
        t.status = Status.Open;
        t.spec = spec;

        emit TaskCreated(taskId, msg.sender, t.validator, msg.value, deadline, spec);
    }

    // --- Submit ------------------------------------------------------------
    /**
     * @notice Submit (or overwrite) a result for an open task. Any address may
     *         compete. A creator/validator cannot submit to their own task.
     */
    function submitResult(uint256 taskId, string calldata resultURI) external {
        Task storage t = _tasks[taskId];
        require(t.creator != address(0), "no task");
        require(t.status == Status.Open, "not open");
        require(bytes(resultURI).length > 0, "empty result");
        require(msg.sender != t.creator && msg.sender != t.validator, "self-submit");
        if (t.deadline != 0) require(block.timestamp <= t.deadline, "expired");

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
            Submission storage s = _submissions[taskId][index];
            s.resultURI = resultURI;
            s.submittedAt = uint64(block.timestamp);
            emit ResultSubmitted(taskId, msg.sender, index, resultURI);
        }
    }

    // --- Complete ----------------------------------------------------------
    /**
     * @notice Validator approves a winning agent; escrow settles to them.
     *         Sub-second on Arc: the agent is paid in native USDC immediately.
     */
    function completeTask(uint256 taskId, address winner) external nonReentrant {
        Task storage t = _tasks[taskId];
        require(t.creator != address(0), "no task");
        require(t.status == Status.Open, "not open");
        require(msg.sender == t.validator, "not validator");
        require(_submissionOf[taskId][winner] != 0, "winner never submitted");

        uint256 reward = t.reward;
        t.status = Status.Completed;
        t.winner = winner;
        t.reward = 0; // effects before interaction

        (bool ok, ) = winner.call{value: reward}("");
        require(ok, "payout failed");

        emit TaskCompleted(taskId, winner, reward);
    }

    // --- Cancel ------------------------------------------------------------
    /**
     * @notice Creator reclaims the bounty. Only allowed while the task is Open
     *         and has received ZERO submissions — so no agent that already did
     *         the work can be rug-pulled. After a deadline with no submissions,
     *         this also serves as the "expired task" refund path.
     */
    function cancelTask(uint256 taskId) external nonReentrant {
        Task storage t = _tasks[taskId];
        require(t.creator != address(0), "no task");
        require(t.status == Status.Open, "not open");
        require(msg.sender == t.creator, "not creator");
        require(_submissions[taskId].length == 0, "has submissions");

        uint256 refund = t.reward;
        t.status = Status.Cancelled;
        t.reward = 0;

        (bool ok, ) = t.creator.call{value: refund}("");
        require(ok, "refund failed");

        emit TaskCancelled(taskId, refund);
    }

    // --- Views -------------------------------------------------------------
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
}
