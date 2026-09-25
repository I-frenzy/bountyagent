// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * @title PopcountReference
 * @notice Reference implementation for the TestVectorVerifier demo: counts the
 *         set bits of a uint256 the slow way, one bit per loop iteration (up to
 *         256 iterations, several thousand gas).
 *
 * The bounty: "match popcount exactly, on fixed and fresh random inputs, in at
 * most N gas per call." Bit-parallel (SWAR) tricks can do it in a few hundred
 * gas; an agent has to find and deploy one.
 */
contract PopcountReference {
    function popcount(uint256 x) external pure returns (uint256 n) {
        while (x != 0) {
            n += x & 1;
            x >>= 1;
        }
    }
}
