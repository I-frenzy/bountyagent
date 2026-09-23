// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IBountyVerifier} from "../IBountyVerifier.sol";

/**
 * @title PreimageVerifier
 * @notice Trustless task: "find a preimage of this hash."
 *         taskData = abi.encode(bytes32 targetHash)
 *         answer   = the raw preimage bytes
 * Passes iff keccak256(answer) == targetHash. Hard to find, trivial to verify —
 * the canonical shape of an on-chain-checkable bounty.
 */
contract PreimageVerifier is IBountyVerifier {
    function verify(bytes calldata taskData, bytes calldata answer, address)
        external
        pure
        override
        returns (bool)
    {
        bytes32 target = abi.decode(taskData, (bytes32));
        return keccak256(answer) == target;
    }
}
