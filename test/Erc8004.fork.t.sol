// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, Vm} from "forge-std/Test.sol";
import {BountyEngine} from "../src/BountyEngine.sol";
import {IIdentityRegistry, IReputationRegistry} from "../src/erc8004/IERC8004.sol";
import {PreimageVerifier} from "../src/verifiers/PreimageVerifier.sol";

/// The real registries' extra functions this test uses.
interface IIdentityFull is IIdentityRegistry {
    function register(string calldata agentURI) external returns (uint256);
    function tokenURI(uint256 agentId) external view returns (string memory);
    function transferFrom(address from, address to, uint256 agentId) external;
}

interface IReputationFull is IReputationRegistry {
    function getSummary(uint256 agentId, address[] calldata clients, string calldata tag1, string calldata tag2)
        external
        view
        returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals);
}

/**
 * F2 against the REAL ERC-8004 registries on Arc mainnet (a local fork — no
 * transactions are sent). Skipped unless ARC_MAINNET_RPC_URL is set.
 */
contract Erc8004ForkTest is Test {
    IIdentityFull constant IDENTITY = IIdentityFull(0x8004A169FB4a3325136EB29fA0ceB6D2e539a432);
    IReputationFull constant REPUTATION = IReputationFull(0x8004BAa17C55a88189AE136b182e5fdA19dE9b63);

    BountyEngine engine;
    PreimageVerifier preimage;
    address creator = makeAddr("creator");
    address solver = makeAddr("solver");
    uint256 agentId;
    bytes constant SECRET = "orbit";

    function setUp() public {
        string memory rpc = vm.envOr("ARC_MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        engine = new BountyEngine(IDENTITY, REPUTATION);
        preimage = new PreimageVerifier();
        vm.deal(creator, 100 ether);

        // The solver creates a profile: an ERC-8004 identity with an on-chain
        // (data URI) registration file, then links it to their address here.
        vm.startPrank(solver);
        agentId = IDENTITY.register(
            "data:application/json;base64,eyJ0eXBlIjoiaHR0cHM6Ly9laXBzLmV0aGVyZXVtLm9yZy9FSVBTL2VpcC04MDA0I3JlZ2lzdHJhdGlvbi12MSIsIm5hbWUiOiJ0ZXN0In0="
        );
        engine.linkAgent(agentId);
        vm.stopPrank();
    }

    function _verifiedWin(uint256 reward, uint16 winners) internal returns (uint256 id) {
        vm.prank(creator);
        id = engine.createVerifiedTask{value: reward}(
            "find the word", address(preimage), abi.encode(keccak256(SECRET)), uint64(block.timestamp + 1 days), winners
        );
        bytes32 salt = keccak256("s");
        vm.prank(solver);
        engine.commitAnswer(id, keccak256(abi.encode(SECRET, salt, solver)));
        vm.roll(block.number + 1);
        vm.prank(solver);
        engine.revealAndClaim(id, SECRET, salt);
    }

    /// 1 if the engine emitted ReputationRecorded(ok=true), 0 if ok=false, 2 if none.
    function _recorded() internal returns (uint256) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("ReputationRecorded(uint256,address,uint256,bool)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(engine) && logs[i].topics[0] == sig) {
                return abi.decode(logs[i].data, (bool)) ? 1 : 0;
            }
        }
        return 2;
    }

    function _summary(string memory tag2) internal view returns (uint64 count, int128 value, uint8 decimals) {
        address[] memory clients = new address[](1);
        clients[0] = address(engine);
        return REPUTATION.getSummary(agentId, clients, "bountyagent", tag2);
    }

    function test_LinkedProfileIsStored() public view {
        assertEq(engine.agentIdOf(solver), agentId);
        assertEq(IDENTITY.ownerOf(agentId), solver);
    }

    function test_OnlyOwnerCanLink() public {
        vm.prank(makeAddr("impostor"));
        vm.expectRevert(BountyEngine.NotAgentOwner.selector);
        engine.linkAgent(agentId);
    }

    function test_LinkingNonexistentAgentReverts() public {
        vm.prank(solver);
        vm.expectRevert(BountyEngine.NotAgentOwner.selector);
        engine.linkAgent(type(uint256).max);
    }

    // The heart of F2: a contract-verified win is written to the real ERC-8004
    // reputation registry, as feedback from the engine itself.
    function test_VerifiedWinIsRecordedOnErc8004() public {
        vm.recordLogs();
        _verifiedWin(2 ether, 1);
        assertEq(_recorded(), 1, "ReputationRecorded(ok = true)");

        (uint64 count, int128 value, uint8 decimals) = _summary("verified");
        assertEq(count, 1);
        assertEq(decimals, 6);
        assertEq(value, 2_000_000, "2 USDC earned, in 6 decimals");
    }

    function test_SeveralWinsAverage() public {
        _verifiedWin(2 ether, 1);
        _verifiedWin(4 ether, 1);
        (uint64 count, int128 value,) = _summary("verified");
        assertEq(count, 2);
        assertEq(value, 3_000_000, "getSummary returns the average");
    }

    function test_CuratedWinIsTaggedCurated() public {
        vm.prank(creator);
        uint256 id = engine.createTask{value: 1 ether}("translate", address(0), uint64(block.timestamp + 1 days), 1);
        vm.prank(solver);
        engine.submitResult(id, "done");
        vm.prank(creator);
        engine.completeTask(id, solver);

        (uint64 verifiedCount,,) = _summary("verified");
        (uint64 curatedCount, int128 value,) = _summary("curated");
        assertEq(verifiedCount, 0);
        assertEq(curatedCount, 1);
        assertEq(value, 1_000_000);
    }

    // If the profile changed hands, the old linker's wins are no longer
    // recorded on it — but they are still paid.
    function test_TransferredProfileIsNotCredited() public {
        vm.prank(solver);
        IDENTITY.transferFrom(solver, makeAddr("buyer"), agentId);

        uint256 before = solver.balance;
        vm.recordLogs();
        _verifiedWin(1 ether, 1);
        assertEq(_recorded(), 0, "ReputationRecorded(ok = false)");
        assertEq(solver.balance, before + 1 ether, "still paid");
        (uint64 count,,) = _summary("verified");
        assertEq(count, 0);
    }

    function test_UnlinkedWinnerIsPaidWithoutRecord() public {
        vm.prank(solver);
        engine.linkAgent(0);
        _verifiedWin(1 ether, 1);
        (uint64 count,,) = _summary("verified");
        assertEq(count, 0);
    }

    // Only the engine's own feedback counts: a fake "client" can write feedback
    // with the same tags, but it doesn't show up when filtering by the engine.
    function test_FakeFeedbackDoesNotCount() public {
        vm.prank(makeAddr("faker"));
        REPUTATION.giveFeedback(agentId, 100_000_000, 6, "bountyagent", "verified", "", "", bytes32(0));
        (uint64 count,,) = _summary("verified");
        assertEq(count, 0);
    }
}
