// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * @title IBountyVerifier
 * @notice A pluggable, on-chain predicate that decides — with zero human
 *         trust — whether a submitted answer solves a task.
 *
 * `verify` MUST be a view function: callers (BountyEngine, VerifierEvaluator)
 * use STATICCALL, so a verifier can never mutate state or re-enter them.
 *
 * A verifier SHOULD revert (not return false) when it cannot reach a verdict,
 * e.g. it was given too little gas; callers treat a revert as "no decision".
 */
interface IBountyVerifier {
    /**
     * @param taskData     opaque task parameters, set by the creator at post time.
     * @param answer       the solver's revealed answer.
     * @param solver       who is claiming (a verifier may bind the answer to them).
     * @param commitBlock  block in which `solver` committed to `answer`. The caller
     *                     guarantees it; verifiers that need unpredictable inputs
     *                     derive them from `blockhash(commitBlock + 1)`, which did
     *                     not exist when the solver locked in their answer.
     */
    function verify(bytes calldata taskData, bytes calldata answer, address solver, uint256 commitBlock)
        external
        view
        returns (bool);
}
