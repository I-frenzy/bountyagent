// SPDX-License-Identifier: CC0-1.0
// Vendored verbatim from the ERC-8183 reference implementation
// (https://eips.ethereum.org/EIPS/eip-8183, "Reference Implementation"),
// Same design and job layout as the instance Arc testnet runs at
// 0x0747EEf0706327138c69792bF28Cd525089e4583.
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

interface IACPHook is IERC165 {
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
}
