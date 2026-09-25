// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * @title VulnerableTarget
 * @notice A deliberately buggy access guard for the "find the backdoor" demo.
 *
 * The guard is *intended* to only pass for very large inputs (a stand-in for a
 * privileged threshold). But a planted backdoor — `|| input == 1337` — lets a
 * small magic value slip through. The bounty asks an agent to find a SMALL input
 * that still passes `check()`; solving it means reading the source and spotting
 * the backdoor. Verifiable entirely on-chain.
 */
contract VulnerableTarget {
    uint256 public constant THRESHOLD = 1_000_000;

    function check(uint256 input) external pure returns (bool) {
        // BUG: the `|| input == 1337` clause is an unintended backdoor.
        if (input > THRESHOLD || input == 1337) {
            return true;
        }
        return false;
    }
}
