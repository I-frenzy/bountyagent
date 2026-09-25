// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console2} from "forge-std/Test.sol";
import {BountyEngine} from "../src/BountyEngine.sol";
import {PreimageVerifier} from "../src/verifiers/PreimageVerifier.sol";

/// Drives the engine with random actors and random action sequences, while
/// tracking every USDC that goes in and out ("ghost" accounting).
contract Handler is Test {
    BountyEngine public immutable engine;
    PreimageVerifier public immutable preimage;

    address[] public actors;
    uint256 public ghostDeposited;
    uint256 public ghostPaidOut;
    mapping(uint256 => uint256) public payoutsPerTask;
    mapping(uint256 => bytes) internal secretOf; // verified tasks' solutions

    constructor(BountyEngine e, PreimageVerifier p) {
        engine = e;
        preimage = p;
        for (uint256 i = 0; i < 5; i++) {
            address a = makeAddr(string(abi.encodePacked("actor", vm.toString(i))));
            actors.push(a);
            vm.deal(a, 1_000 ether);
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _task(uint256 seed) internal view returns (uint256) {
        uint256 n = engine.taskCount();
        return n == 0 ? 0 : (seed % n) + 1;
    }

    function _salt(uint256 id, address who) internal pure returns (bytes32) {
        return keccak256(abi.encode(id, who));
    }

    // Wraps every call that can move money and records the engine's balance change.
    function _track(uint256 id, uint256 balBefore) internal {
        uint256 balAfter = address(engine).balance;
        if (balAfter < balBefore) {
            ghostPaidOut += balBefore - balAfter;
            payoutsPerTask[id] += 1;
        }
    }

    // --- actions ----------------------------------------------------------

    function createCurated(uint256 actorSeed, uint256 reward, uint256 duration) external {
        address a = _actor(actorSeed);
        reward = bound(reward, 1, engine.MAX_REWARD());
        duration = bound(duration, engine.MIN_DURATION(), engine.MAX_DURATION());
        vm.prank(a);
        engine.createTask{value: reward}("spec", address(0), uint64(block.timestamp + duration));
        ghostDeposited += reward;
    }

    function createVerified(uint256 actorSeed, uint256 reward, uint256 duration, bytes32 secretSeed) external {
        address a = _actor(actorSeed);
        reward = bound(reward, 1, engine.MAX_REWARD());
        duration = bound(duration, engine.MIN_DURATION(), engine.MAX_DURATION());
        bytes memory secret = abi.encode(secretSeed);
        vm.prank(a);
        uint256 id = engine.createVerifiedTask{value: reward}(
            "spec", address(preimage), abi.encode(keccak256(secret)), uint64(block.timestamp + duration)
        );
        secretOf[id] = secret;
        ghostDeposited += reward;
    }

    function submit(uint256 actorSeed, uint256 taskSeed) external {
        uint256 id = _task(taskSeed);
        if (id == 0) return;
        vm.prank(_actor(actorSeed));
        try engine.submitResult(id, "result") {} catch {}
    }

    function complete(uint256 taskSeed, uint256 winnerSeed) external {
        uint256 id = _task(taskSeed);
        if (id == 0) return;
        BountyEngine.Task memory t = engine.getTask(id);
        uint256 bal = address(engine).balance;
        vm.prank(t.validator);
        try engine.completeTask(id, _actor(winnerSeed)) {} catch {}
        _track(id, bal);
    }

    /// Commits either the right answer or a wrong one.
    function commit(uint256 actorSeed, uint256 taskSeed, bool correct) external {
        uint256 id = _task(taskSeed);
        if (id == 0) return;
        address a = _actor(actorSeed);
        bytes memory answer = correct ? secretOf[id] : bytes("wrong");
        vm.prank(a);
        try engine.commitAnswer(id, keccak256(abi.encode(answer, _salt(id, a), a))) {} catch {}
    }

    function reveal(uint256 actorSeed, uint256 taskSeed, bool correct) external {
        uint256 id = _task(taskSeed);
        if (id == 0) return;
        address a = _actor(actorSeed);
        bytes memory answer = correct ? secretOf[id] : bytes("wrong");
        uint256 bal = address(engine).balance;
        vm.prank(a);
        try engine.revealAndClaim(id, answer, _salt(id, a)) {} catch {}
        _track(id, bal);
    }

    function cancel(uint256 taskSeed) external {
        uint256 id = _task(taskSeed);
        if (id == 0) return;
        uint256 bal = address(engine).balance;
        vm.prank(engine.getTask(id).creator);
        try engine.cancelTask(id) {} catch {}
        _track(id, bal);
    }

    function reclaim(uint256 taskSeed) external {
        uint256 id = _task(taskSeed);
        if (id == 0) return;
        uint256 bal = address(engine).balance;
        vm.prank(engine.getTask(id).creator);
        try engine.reclaimExpired(id) {} catch {}
        _track(id, bal);
    }

    function passTime(uint256 secs, uint256 blocks) external {
        vm.warp(block.timestamp + bound(secs, 0, 10 days));
        vm.roll(block.number + bound(blocks, 1, 50));
    }
}

contract BountyEngineInvariantTest is Test {
    BountyEngine engine;
    Handler handler;

    function setUp() public {
        engine = new BountyEngine();
        handler = new Handler(engine, new PreimageVerifier());
        targetContract(address(handler));
    }

    /// Sanity: the random runs actually settle tasks (otherwise the other
    /// invariants would pass vacuously).
    function afterInvariant() public view {
        uint256 settled;
        for (uint256 id = 1; id <= engine.taskCount(); id++) {
            if (engine.getTask(id).status != BountyEngine.Status.Open) settled++;
        }
        console2.log("tasks", engine.taskCount(), "settled", settled);
        console2.log("paid out (wei)", handler.ghostPaidOut());
    }

    /// The engine holds exactly the rewards of Open tasks — no more, no less.
    function invariant_BalanceEqualsOpenEscrow() public view {
        uint256 open;
        for (uint256 id = 1; id <= engine.taskCount(); id++) {
            BountyEngine.Task memory t = engine.getTask(id);
            if (t.status == BountyEngine.Status.Open) open += t.reward;
        }
        assertEq(address(engine).balance, open);
    }

    /// Every USDC in is either still escrowed or was paid out exactly once.
    function invariant_Conservation() public view {
        assertEq(handler.ghostDeposited(), address(engine).balance + handler.ghostPaidOut());
    }

    /// No task ever pays out twice, and settled tasks paid out exactly once.
    function invariant_AtMostOnePayoutPerTask() public view {
        for (uint256 id = 1; id <= engine.taskCount(); id++) {
            BountyEngine.Task memory t = engine.getTask(id);
            uint256 n = handler.payoutsPerTask(id);
            assertLe(n, 1);
            if (t.status == BountyEngine.Status.Open) {
                assertEq(n, 0);
                assertEq(t.settledBlock, 0);
            } else {
                assertEq(n, 1);
                assertGt(t.settledBlock, 0);
            }
        }
    }

    /// Completed verified tasks always have a winner who is not the creator.
    function invariant_VerifiedWinnerIsNotCreator() public view {
        for (uint256 id = 1; id <= engine.taskCount(); id++) {
            BountyEngine.Task memory t = engine.getTask(id);
            if (t.status == BountyEngine.Status.Completed) {
                assertTrue(t.winner != address(0));
                if (t.mode == BountyEngine.Mode.Verified) assertTrue(t.winner != t.creator);
            }
        }
    }
}
