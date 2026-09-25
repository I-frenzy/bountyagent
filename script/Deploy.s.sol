// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {BountyEngine} from "../src/BountyEngine.sol";
import {PreimageVerifier} from "../src/verifiers/PreimageVerifier.sol";
import {BackdoorVerifier} from "../src/verifiers/BackdoorVerifier.sol";
import {TestVectorVerifier} from "../src/verifiers/TestVectorVerifier.sol";
import {VulnerableTarget} from "../src/demo/VulnerableTarget.sol";
import {PopcountReference} from "../src/demo/PopcountReference.sol";
import {VerifierEvaluator} from "../src/erc8183/VerifierEvaluator.sol";
import {IERC8183} from "../src/erc8183/IERC8183.sol";
import {CommerceDeployer} from "./DeployCommerce.s.sol";

/**
 * Deploy the full BountyAgent stack to Arc.
 *
 *   forge script script/Deploy.s.sol:Deploy \
 *     --rpc-url arc_mainnet --broadcast --private-key $PRIVATE_KEY
 *
 * ERC-8183: set COMMERCE_ADDRESS to plug the evaluator into an existing
 * ERC-8183 instance (e.g. Arc testnet's 0x0747EEf0706327138c69792bF28Cd525089e4583).
 * Leave it unset to deploy our own admin-less instance (Arc mainnet has none).
 *
 * USDC is Arc's native gas asset, so the deployer just needs a little USDC.
 */
contract Deploy is Script {
    /// USDC's ERC-20 interface on Arc (mainnet and testnet).
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address commerce = vm.envOr("COMMERCE_ADDRESS", address(0));

        vm.startBroadcast(pk);
        BountyEngine engine = new BountyEngine();
        PreimageVerifier preimage = new PreimageVerifier();
        BackdoorVerifier backdoor = new BackdoorVerifier();
        TestVectorVerifier testVector = new TestVectorVerifier();
        VulnerableTarget target = new VulnerableTarget();
        PopcountReference popcount = new PopcountReference();
        bool ownCommerce = commerce == address(0);
        if (ownCommerce) commerce = CommerceDeployer.deploy(ARC_USDC, vm.addr(pk));
        VerifierEvaluator evaluator = new VerifierEvaluator(IERC8183(commerce));
        vm.stopBroadcast();

        console2.log("BountyEngine       :", address(engine));
        console2.log("PreimageVerifier   :", address(preimage));
        console2.log("BackdoorVerifier   :", address(backdoor));
        console2.log("TestVectorVerifier :", address(testVector));
        console2.log("VulnerableTarget   :", address(target));
        console2.log("PopcountReference  :", address(popcount));
        console2.log(ownCommerce ? "AgenticCommerce    : (ours, admin renounced)" : "AgenticCommerce    : (existing)");
        console2.log("  address          :", commerce);
        console2.log("VerifierEvaluator  :", address(evaluator));
        console2.log("owner (provenance) :", engine.owner());
    }
}
