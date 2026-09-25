// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AgenticCommerce} from "../src/erc8183/AgenticCommerce.sol";

/**
 * @notice Deploys the ERC-8183 reference `AgenticCommerce` the way BountyAgent
 *         runs it on Arc mainnet (which has no official ERC-8183 instance):
 *
 *   1. implementation + ERC1967 proxy, initialized with USDC as payment token;
 *   2. the deployer immediately renounces ADMIN_ROLE and DEFAULT_ADMIN_ROLE.
 *
 * After step 2 nobody can change fees (they stay 0), whitelist hooks, or
 * upgrade the contract — the escrow is as neutral as the code itself.
 *
 * Used by both script/Deploy.s.sol and the tests, so what's tested is exactly
 * what gets deployed. Internal, so it runs in the caller's context: the caller
 * (the broadcaster, or the test contract) is the one that initializes and then
 * renounces.
 */
library CommerceDeployer {
    /// @param deployer the account sending the transactions (the broadcaster in
    ///        a script, the test contract in tests). It receives the admin roles
    ///        on initialize and renounces them; it is also the (unused, fee 0) treasury.
    function deploy(address usdc, address deployer) internal returns (address) {
        AgenticCommerce impl = new AgenticCommerce();
        AgenticCommerce commerce = AgenticCommerce(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(AgenticCommerce.initialize, (usdc, deployer))))
        );
        commerce.renounceRole(commerce.ADMIN_ROLE(), deployer);
        commerce.renounceRole(commerce.DEFAULT_ADMIN_ROLE(), deployer);
        return address(commerce);
    }
}
