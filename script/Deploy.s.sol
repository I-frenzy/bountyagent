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
 * Deploy the BountyAgent stack to Arc or to BOT Chain.
 *
 *   forge script script/Deploy.s.sol:Deploy \
 *     --rpc-url arc_mainnet --broadcast --private-key $PRIVATE_KEY
 *
 * ERC-8183: set COMMERCE_ADDRESS to plug the evaluator into an existing
 * ERC-8183 instance (e.g. Arc testnet's 0x0747EEf0706327138c69792bF28Cd525089e4583).
 * Leave it unset to deploy our own admin-less instance (Arc mainnet has none).
 *
 * BOT Chain (677): the core stack only. ERC-8004 is disabled (the addresses
 * that hold the canonical registries elsewhere are stubs on this chain), and
 * the ERC-8183 module is skipped unless COMMERCE_ADDRESS names an existing
 * instance, because its payment token (Arc's USDC) does not exist there. Use
 * --legacy: the chain prices gas as a flat 20 gwei.
 *
 * It writes deployments/<network>.json (arc-testnet, arc-mainnet or
 * bot-mainnet), which the worker, the rehearsal and the MCP server read.
 *
 * The native coin pays for gas and is what bounties are denominated in:
 * USDC on Arc, BOT on BOT Chain.
 */
contract Deploy is Script {
    /// USDC's ERC-20 interface on Arc (mainnet and testnet).
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    uint256 constant BOT_CHAIN = 677;

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
        bool skipCommerce;
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
        // BOT Chain: the canonical ERC-8004 addresses hold stubs, so run without them.
        if (block.chainid == BOT_CHAIN) return (address(0), address(0));
        return (vm.envOr("IDENTITY_REGISTRY", address(0)), vm.envOr("REPUTATION_REGISTRY", address(0)));
    }

    function run() external {
        // Either PRIVATE_KEY in the env, or (safer, for mainnet) a Foundry
        // keystore / hardware wallet: `--account <name>` or `--ledger` plus `--sender`.
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        // forge auto-loads .env, which may hold a throwaway testnet key: on mainnet,
        // refuse an env key unless explicitly allowed, so the real deployment
        // can't silently come from the wrong wallet.
        if ((block.chainid == 5042 || block.chainid == BOT_CHAIN) && pk != 0 && !vm.envOr("ALLOW_ENV_KEY_ON_MAINNET", false)) {
            revert("mainnet: deploy with --account <keystore> or --ledger (or set ALLOW_ENV_KEY_ON_MAINNET=true)");
        }
        address deployer = pk != 0 ? vm.addr(pk) : msg.sender;
        Deployed memory d;
        d.commerce = vm.envOr("COMMERCE_ADDRESS", address(0));
        d.ownCommerce = d.commerce == address(0);
        // BOT Chain has no ERC-20 payment token for our own ERC-8183 instance.
        d.skipCommerce = block.chainid == BOT_CHAIN && d.ownCommerce;
        (d.identity, d.reputation) = _erc8004();

        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast();
        d.engine = new BountyEngine(IIdentityRegistry(d.identity), IReputationRegistry(d.reputation));
        d.preimage = new PreimageVerifier();
        d.backdoor = new BackdoorVerifier();
        d.testVector = new TestVectorVerifier();
        d.target = new VulnerableTarget();
        d.popcount = new PopcountReference();
        if (!d.skipCommerce) {
            if (d.ownCommerce) d.commerce = CommerceDeployer.deploy(ARC_USDC, deployer);
            d.evaluator = new VerifierEvaluator(IERC8183(d.commerce));
        }
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
        if (d.skipCommerce) {
            console2.log("AgenticCommerce    : (skipped on this network)");
        } else {
            console2.log(d.ownCommerce ? "AgenticCommerce    : (ours, admin renounced)" : "AgenticCommerce    : (existing)");
            console2.log("  address          :", d.commerce);
            console2.log("VerifierEvaluator  :", address(d.evaluator));
        }
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
        string memory name = block.chainid == 5042
            ? "arc-mainnet"
            : block.chainid == 5042002 ? "arc-testnet" : block.chainid == BOT_CHAIN ? "bot-mainnet" : "";
        if (bytes(name).length == 0) return;

        string memory c = "contracts";
        vm.serializeAddress(c, "BountyEngine", address(d.engine));
        vm.serializeAddress(c, "PreimageVerifier", address(d.preimage));
        vm.serializeAddress(c, "BackdoorVerifier", address(d.backdoor));
        vm.serializeAddress(c, "TestVectorVerifier", address(d.testVector));
        vm.serializeAddress(c, "VulnerableTarget", address(d.target));
        string memory contracts = vm.serializeAddress(c, "PopcountReference", address(d.popcount));
        if (!d.skipCommerce) {
            if (d.ownCommerce) vm.serializeAddress(c, "AgenticCommerce", d.commerce);
            contracts = vm.serializeAddress(c, "VerifierEvaluator", address(d.evaluator));
        }

        string memory x = "external";
        if (!d.skipCommerce && !d.ownCommerce) {
            vm.serializeAddress(x, "AgenticCommerce (ERC-8183, existing)", d.commerce);
        }
        vm.serializeAddress(x, "ERC-8004 IdentityRegistry", d.identity);
        string memory external_ = vm.serializeAddress(x, "ERC-8004 ReputationRegistry", d.reputation);
        if (!d.skipCommerce) external_ = vm.serializeAddress(x, "USDC (ERC-20 view)", ARC_USDC);

        string memory root = "root";
        vm.serializeString(root, "network", name);
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeAddress(root, "deployer", d.engine.owner());
        vm.serializeString(root, "contracts", contracts);
        string memory json = vm.serializeString(root, "external", external_);
        vm.writeJson(json, string.concat("deployments/", name, ".json"));
        console2.log(string.concat("wrote deployments/", name, ".json"));
    }
}
