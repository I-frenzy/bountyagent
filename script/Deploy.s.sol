// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {BountyEngine} from "../src/BountyEngine.sol";

/**
 * Deploy BountyEngine to Arc.
 *
 *   forge script script/Deploy.s.sol:Deploy \
 *     --rpc-url arc_testnet --broadcast --private-key $PRIVATE_KEY
 *
 * Swap --rpc-url arc_mainnet for the mainnet deploy. Because USDC is Arc's
 * native gas asset, the deployer wallet just needs a little USDC (~0.20 USDC
 * covers deploy + many test cycles).
 */
contract Deploy is Script {
    function run() external returns (BountyEngine engine) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);
        engine = new BountyEngine();
        vm.stopBroadcast();
        console2.log("BountyEngine deployed at:", address(engine));
        console2.log("owner (provenance):", engine.owner());
    }
}
