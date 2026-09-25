// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {BountyEngine} from "../src/BountyEngine.sol";
import {PreimageVerifier} from "../src/verifiers/PreimageVerifier.sol";
import {BackdoorVerifier} from "../src/verifiers/BackdoorVerifier.sol";
import {TestVectorVerifier} from "../src/verifiers/TestVectorVerifier.sol";
import {VulnerableTarget} from "../src/demo/VulnerableTarget.sol";
import {PopcountReference} from "../src/demo/PopcountReference.sol";
import {VerifierEvaluator} from "../src/erc8183/VerifierEvaluator.sol";
import {IERC8183} from "../src/erc8183/IERC8183.sol";
import {CommerceDeployer} from "./DeployCommerce.s.sol";
import {IIdentityRegistry, IReputationRegistry} from "../src/erc8004/IERC8004.sol";

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
 * On Arc testnet/mainnet it writes deployments/arc-<network>.json, which the
 * worker, the rehearsal and the MCP server read.
 *
 * USDC is Arc's native gas asset, so the deployer just needs a little USDC.
 */
contract Deploy is Script {
    /// USDC's ERC-20 interface on Arc (mainnet and testnet).
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    struct Deployed {
        BountyEngine engine;
        PreimageVerifier preimage;
        BackdoorVerifier backdoor;
        TestVectorVerifier testVector;
        VulnerableTarget target;
        PopcountReference popcount;
        VerifierEvaluator evaluator;
        address commerce;
        bool ownCommerce;
        address identity;
        address reputation;
    }

    /// ERC-8004 registries per chain (canonical deployments, checked on-chain).
    /// Elsewhere (e.g. a local chain) set IDENTITY_REGISTRY / REPUTATION_REGISTRY,
    /// or leave them unset to deploy with profiles + reputation disabled.
    function _erc8004() internal view returns (address identity, address reputation) {
        if (block.chainid == 5042) {
            return (0x8004A169FB4a3325136EB29fA0ceB6D2e539a432, 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63);
        }
        if (block.chainid == 5042002) {
            return (0x8004A818BFB912233c491871b3d84c89A494BD9e, 0x8004B663056A597Dffe9eCcC1965A193B7388713);
        }
        return (vm.envOr("IDENTITY_REGISTRY", address(0)), vm.envOr("REPUTATION_REGISTRY", address(0)));
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        Deployed memory d;
        d.commerce = vm.envOr("COMMERCE_ADDRESS", address(0));
        d.ownCommerce = d.commerce == address(0);
        (d.identity, d.reputation) = _erc8004();

        vm.startBroadcast(pk);
        d.engine = new BountyEngine(IIdentityRegistry(d.identity), IReputationRegistry(d.reputation));
        d.preimage = new PreimageVerifier();
        d.backdoor = new BackdoorVerifier();
        d.testVector = new TestVectorVerifier();
        d.target = new VulnerableTarget();
        d.popcount = new PopcountReference();
        if (d.ownCommerce) d.commerce = CommerceDeployer.deploy(ARC_USDC, vm.addr(pk));
        d.evaluator = new VerifierEvaluator(IERC8183(d.commerce));
        vm.stopBroadcast();

        _log(d);
        _record(d);
    }

    function _log(Deployed memory d) internal pure {
        console2.log("BountyEngine       :", address(d.engine));
        console2.log("PreimageVerifier   :", address(d.preimage));
        console2.log("BackdoorVerifier   :", address(d.backdoor));
        console2.log("TestVectorVerifier :", address(d.testVector));
        console2.log("VulnerableTarget   :", address(d.target));
        console2.log("PopcountReference  :", address(d.popcount));
        console2.log(d.ownCommerce ? "AgenticCommerce    : (ours, admin renounced)" : "AgenticCommerce    : (existing)");
        console2.log("  address          :", d.commerce);
        console2.log("VerifierEvaluator  :", address(d.evaluator));
        console2.log("ERC-8004 identity  :", d.identity);
        console2.log("ERC-8004 reputation:", d.reputation);
    }

    /// Writes deployments/arc-<network>.json on Arc testnet/mainnet.
    function _record(Deployed memory d) internal {
        // Only a real deployment is recorded — a dry run must never write fake addresses.
        bool broadcasting =
            vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
        if (!broadcasting) {
            console2.log("dry run: deployments file not written");
            return;
        }
        string memory name = block.chainid == 5042 ? "mainnet" : block.chainid == 5042002 ? "testnet" : "";
        if (bytes(name).length == 0) return;

        string memory c = "contracts";
        vm.serializeAddress(c, "BountyEngine", address(d.engine));
        vm.serializeAddress(c, "PreimageVerifier", address(d.preimage));
        vm.serializeAddress(c, "BackdoorVerifier", address(d.backdoor));
        vm.serializeAddress(c, "TestVectorVerifier", address(d.testVector));
        vm.serializeAddress(c, "VulnerableTarget", address(d.target));
        vm.serializeAddress(c, "PopcountReference", address(d.popcount));
        if (d.ownCommerce) vm.serializeAddress(c, "AgenticCommerce", d.commerce);
        string memory contracts = vm.serializeAddress(c, "VerifierEvaluator", address(d.evaluator));

        string memory x = "external";
        if (!d.ownCommerce) vm.serializeAddress(x, "AgenticCommerce (ERC-8183, existing)", d.commerce);
        vm.serializeAddress(x, "ERC-8004 IdentityRegistry", d.identity);
        vm.serializeAddress(x, "ERC-8004 ReputationRegistry", d.reputation);
        string memory external_ = vm.serializeAddress(x, "USDC (ERC-20 view)", ARC_USDC);

        string memory root = "root";
        vm.serializeString(root, "network", string.concat("arc-", name));
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeAddress(root, "deployer", d.engine.owner());
        vm.serializeString(root, "contracts", contracts);
        string memory json = vm.serializeString(root, "external", external_);
        vm.writeJson(json, string.concat("deployments/arc-", name, ".json"));
        console2.log(string.concat("wrote deployments/arc-", name, ".json"));
    }
}
