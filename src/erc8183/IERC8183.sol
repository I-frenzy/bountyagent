// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * @title IERC8183
 * @notice The subset of an ERC-8183 (Agentic Commerce) job contract that
 *         VerifierEvaluator uses. Matches the ERC's reference implementation
 *         (`AgenticCommerce`, vendored in this folder) and the instance Arc
 *         testnet runs (0x0747EEf0706327138c69792bF28Cd525089e4583) — its
 *         `getJob` layout was checked on-chain.
 */
interface IERC8183 {
    enum JobStatus {
        Open,
        Funded,
        Submitted,
        Completed,
        Rejected,
        Expired
    }

    struct Job {
        uint256 id;
        address client;
        address provider;
        address evaluator;
        string description;
        uint256 budget;
        uint256 expiredAt;
        JobStatus status;
        address hook;
    }

    function getJob(uint256 jobId) external view returns (Job memory);

    function complete(uint256 jobId, bytes32 reason, bytes calldata optParams) external;
}
