// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IBountyVerifier} from "../IBountyVerifier.sol";
import {IERC8183} from "./IERC8183.sol";

/**
 * @title VerifierEvaluator
 * @notice A trustless evaluator for ERC-8183 jobs.
 *
 * ERC-8183 escrows a job's budget and lets a single *evaluator* approve the
 * work — and the standard itself says that evaluator is trusted. Set this
 * contract as a job's evaluator and attach a BountyAgent verifier instead: the
 * job completes, and the provider is paid, exactly when the verifier accepts
 * the provider's answer. No person decides.
 *
 * Flow (all on the ERC-8183 contract `commerce`, plus three calls here):
 *   1. client: commerce.createJob(provider, evaluator = this, ...)
 *   2. client: configure(jobId, verifier, taskData)   // while the job is Open
 *   3. provider: commerce.setBudget(jobId, amount)     // provider sees the rules first
 *      client:   USDC.approve(commerce, amount)       // approve EXACTLY the budget —
 *                commerce.fund(jobId)                 // the provider can change it until funding
 *   4. provider: commit(jobId, keccak256(abi.encode(answer, salt, provider)))
 *   5. provider: commerce.submit(jobId, deliverable, "")
 *   6. provider: settle(jobId, answer, salt)            // a later block than the commit
 *        → verifier accepts → commerce.complete(jobId, keccak256(answer), "")
 *
 * Settle before the job's `expiredAt`: after it, anyone may call the ERC-8183
 * `claimRefund`, which has no grace period for submitted work.
 *
 * Guarantees:
 *  - The rules are fixed before the job is funded: `configure` only works while
 *    the job is Open, only for its client, and only once.
 *  - This contract never rejects. A wrong answer just reverts, so the provider
 *    can fix it and retry until the job expires; a missing verdict leaves the
 *    job to ERC-8183's normal expiry refund.
 *  - The `reason` recorded on completion is keccak256(answer): an on-chain
 *    attestation of exactly which answer the verifier accepted.
 *  - Only the provider can settle, and the commit comes first, so verifiers
 *    that draw fresh inputs from `blockhash(commitBlock + 1)` work here too.
 */
contract VerifierEvaluator {
    IERC8183 public immutable commerce;

    struct Config {
        address verifier;
        bytes taskData;
    }

    mapping(uint256 => Config) private _configOf;
    mapping(uint256 => bytes32) public commitmentOf;
    mapping(uint256 => uint256) public commitBlockOf;

    bool private transient _locked;

    event Configured(uint256 indexed jobId, address indexed verifier, bytes taskData);
    event AnswerCommitted(uint256 indexed jobId, address indexed provider, bytes32 commitment);
    event AnswerVerified(uint256 indexed jobId, address indexed provider, bytes answer);

    error NotClient();
    error NotProvider();
    error NotEvaluator();
    error WrongStatus();
    error AlreadyConfigured();
    error NotConfigured();
    error VerifierNotContract();
    error EmptyCommitment();
    error NoCommit();
    error RevealTooEarly();
    error BadReveal();
    error InvalidAnswer();
    error Reentrant();

    modifier nonReentrant() {
        if (_locked) revert Reentrant();
        _locked = true;
        _;
        _locked = false;
    }

    constructor(IERC8183 commerce_) {
        commerce = commerce_;
    }

    /// @notice Attach the verifier and its parameters to a job. Client only,
    ///         once, while the job is still Open (before funding).
    function configure(uint256 jobId, address verifier, bytes calldata taskData) external {
        IERC8183.Job memory job = commerce.getJob(jobId);
        if (msg.sender != job.client) revert NotClient();
        if (job.evaluator != address(this)) revert NotEvaluator();
        if (job.status != IERC8183.JobStatus.Open) revert WrongStatus();
        if (_configOf[jobId].verifier != address(0)) revert AlreadyConfigured();
        if (verifier.code.length == 0) revert VerifierNotContract();

        _configOf[jobId] = Config({verifier: verifier, taskData: taskData});
        emit Configured(jobId, verifier, taskData);
    }

    /// @notice Provider commits to an answer without revealing it. May be
    ///         repeated (e.g. to fix a wrong answer); each commit restarts the wait.
    function commit(uint256 jobId, bytes32 commitment) external {
        IERC8183.Job memory job = commerce.getJob(jobId);
        if (msg.sender != job.provider) revert NotProvider();
        if (job.status != IERC8183.JobStatus.Funded && job.status != IERC8183.JobStatus.Submitted) {
            revert WrongStatus();
        }
        if (_configOf[jobId].verifier == address(0)) revert NotConfigured();
        if (commitment == bytes32(0)) revert EmptyCommitment();

        commitmentOf[jobId] = commitment;
        commitBlockOf[jobId] = block.number;
        emit AnswerCommitted(jobId, msg.sender, commitment);
    }

    /// @notice Reveal the answer; if the verifier accepts it, the job completes
    ///         and ERC-8183 pays the provider.
    function settle(uint256 jobId, bytes calldata answer, bytes32 salt) external nonReentrant {
        IERC8183.Job memory job = commerce.getJob(jobId);
        if (msg.sender != job.provider) revert NotProvider();
        if (job.status != IERC8183.JobStatus.Submitted) revert WrongStatus();

        bytes32 commitment = commitmentOf[jobId];
        if (commitment == bytes32(0)) revert NoCommit();
        uint256 commitBlock = commitBlockOf[jobId];
        if (block.number <= commitBlock) revert RevealTooEarly();
        if (keccak256(abi.encode(answer, salt, msg.sender)) != commitment) revert BadReveal();

        Config storage c = _configOf[jobId];
        // A verifier revert (e.g. too little gas, seed not yet available) bubbles
        // up: no verdict, nothing changes, the provider can simply try again.
        bool ok = IBountyVerifier(c.verifier).verify(c.taskData, answer, msg.sender, commitBlock);
        if (!ok) revert InvalidAnswer();

        emit AnswerVerified(jobId, msg.sender, answer);
        commerce.complete(jobId, keccak256(answer), "");
    }

    function configOf(uint256 jobId) external view returns (address verifier, bytes memory taskData) {
        Config storage c = _configOf[jobId];
        return (c.verifier, c.taskData);
    }
}
