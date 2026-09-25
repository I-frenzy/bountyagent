// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IBountyVerifier} from "../IBountyVerifier.sol";

interface ITarget {
    function check(uint256 input) external view returns (bool);
}

/**
 * @title BackdoorVerifier
 * @notice Trustless task: "find a SMALL input that passes the target's guard"
 *         (i.e. discover the backdoor).
 *         taskData = abi.encode(address target, uint256 maxInput)
 *         answer   = abi.encode(uint256 input)
 * Passes iff input <= maxInput AND target.check(input) == true. The `maxInput`
 * cap rules out the "intended" large values, so only the backdoor qualifies.
 */
contract BackdoorVerifier is IBountyVerifier {
    function verify(bytes calldata taskData, bytes calldata answer, address)
        external
        view
        override
        returns (bool)
    {
        (address target, uint256 maxInput) = abi.decode(taskData, (address, uint256));
        uint256 input = abi.decode(answer, (uint256));
        if (input > maxInput) return false;
        return ITarget(target).check(input);
    }
}
