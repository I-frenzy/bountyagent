// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {BountyEngine} from "../src/BountyEngine.sol";
import {PreimageVerifier} from "../src/verifiers/PreimageVerifier.sol";
import {BackdoorVerifier} from "../src/verifiers/BackdoorVerifier.sol";
import {VulnerableTarget} from "../src/demo/VulnerableTarget.sol";

/**
 * Deploy the full BountyAgent stack to Arc.
 *
 *   forge script script/Deploy.s.sol:Deploy \
 *     --rpc-url arc_testnet --broadcast --private-key $PRIVATE_KEY
 *
 * USDC is Arc's native gas asset, so the deployer just needs a little USDC.
 */
contract Deploy is Script {
    function run()
        external
        returns (
            BountyEngine engine,
            PreimageVerifier preimage,
            BackdoorVerifier backdoor,
            VulnerableTarget target
        )
    {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);
        engine = new BountyEngine();
        preimage = new PreimageVerifier();
        backdoor = new BackdoorVerifier();
        target = new VulnerableTarget();
        vm.stopBroadcast();

        console2.log("BountyEngine     :", address(engine));
        console2.log("PreimageVerifier :", address(preimage));
        console2.log("BackdoorVerifier :", address(backdoor));
        console2.log("VulnerableTarget :", address(target));
        console2.log("owner (provenance):", engine.owner());
    }
}
