// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title IBountyVerifier
 * @notice A pluggable, on-chain predicate that decides — with zero human
 *         trust — whether a submitted answer solves a task.
 *
 * `verify` MUST be a pure/view function: BountyEngine calls it via STATICCALL,
 * so a verifier can never mutate state or re-enter the engine. It receives the
 * task's opaque `taskData` (set by the creator at post time), the agent's
 * `answer`, and the `solver` address (so a verifier may bind an answer to who
 * submitted it, if it wants).
 */
interface IBountyVerifier {
    function verify(
        bytes calldata taskData,
        bytes calldata answer,
        address solver
    ) external view returns (bool);
}
