// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {BountyEngine} from "../src/BountyEngine.sol";
import {IIdentityRegistry, IReputationRegistry} from "../src/erc8004/IERC8004.sol";
import {PreimageVerifier} from "../src/verifiers/PreimageVerifier.sol";

/// F7 — one bounty, several paid winners.
contract MultiClaimTest is Test {
    BountyEngine engine;
    PreimageVerifier preimage;

    address creator = makeAddr("creator");
    address validator = makeAddr("validator");
    address a = makeAddr("a");
    address b = makeAddr("b");
    address c = makeAddr("c");
    address copier = makeAddr("copier");

    uint64 constant DURATION = 1 days;
    bytes constant SECRET = "orbit";

    function setUp() public {
        engine = new BountyEngine(IIdentityRegistry(address(0)), IReputationRegistry(address(0)));
        preimage = new PreimageVerifier();
        vm.deal(creator, 1000 ether);
    }

    function _dl() internal view returns (uint64) {
        return uint64(block.timestamp + DURATION);
    }

    function _curated(uint256 reward, uint16 winners) internal returns (uint256 id) {
        vm.prank(creator);
        id = engine.createTask{value: reward}("label 3 images", validator, _dl(), winners);
    }

    function _verified(uint256 reward, uint16 winners) internal returns (uint256 id) {
        vm.prank(creator);
        id = engine.createVerifiedTask{value: reward}(
            "find the word", address(preimage), abi.encode(keccak256(SECRET)), _dl(), winners
        );
    }

    function _submit(uint256 id, address who) internal {
        vm.prank(who);
        engine.submitResult(id, "work");
    }

    function _commit(uint256 id, address who) internal {
        vm.prank(who);
        engine.commitAnswer(id, keccak256(abi.encode(SECRET, bytes32(uint256(uint160(who))), who)));
    }

    function _reveal(uint256 id, address who) internal {
        vm.prank(who);
        engine.revealAndClaim(id, SECRET, bytes32(uint256(uint160(who))));
    }

    // =====================================================================
    //                             CREATION
    // =====================================================================

    function test_WinnerCountBounds() public {
        uint16 max = engine.MAX_WINNERS();
        vm.startPrank(creator);
        vm.expectRevert(BountyEngine.BadWinnerCount.selector);
        engine.createTask{value: 1 ether}("x", validator, _dl(), 0);
        vm.expectRevert(BountyEngine.BadWinnerCount.selector);
        engine.createTask{value: 51 ether}("x", validator, _dl(), max + 1);
        engine.createTask{value: 50 ether}("x", validator, _dl(), max);
        vm.stopPrank();
    }

    function test_SharesMustBeEven() public {
        vm.prank(creator);
        vm.expectRevert(BountyEngine.UnevenShares.selector);
        engine.createTask{value: 10 ether + 1}("x", validator, _dl(), 3);
    }

    // =====================================================================
    //                              CURATED
    // =====================================================================

    function test_CuratedPaysEachWinnerAShare() public {
        uint256 id = _curated(3 ether, 3);
        _submit(id, a);
        _submit(id, b);
        _submit(id, c);

        vm.startPrank(validator);
        engine.completeTask(id, a);
        assertEq(a.balance, 1 ether);
        assertEq(engine.remainingEscrow(id), 2 ether);
        assertEq(uint256(engine.getTask(id).status), uint256(BountyEngine.Status.Open), "still open");

        engine.completeTask(id, b);
        vm.expectEmit(true, false, false, true);
        emit BountyEngine.TaskClosed(id, BountyEngine.Status.Completed, 3, 0);
        engine.completeTask(id, c);
        vm.stopPrank();

        assertEq(b.balance, 1 ether);
        assertEq(c.balance, 1 ether);
        assertEq(address(engine).balance, 0);
        BountyEngine.Task memory t = engine.getTask(id);
        assertEq(uint256(t.status), uint256(BountyEngine.Status.Completed));
        assertEq(t.paidCount, 3);
        assertEq(t.winner, a, "first winner");
        assertEq(t.reward, 3 ether, "total kept for display");
        address[] memory w = engine.getWinners(id);
        assertEq(w.length, 3);
        assertEq(w[2], c);
    }

    function test_CuratedSameWinnerTwiceReverts() public {
        uint256 id = _curated(2 ether, 2);
        _submit(id, a);
        vm.startPrank(validator);
        engine.completeTask(id, a);
        vm.expectRevert(BountyEngine.AlreadyWon.selector);
        engine.completeTask(id, a);
        vm.stopPrank();
    }

    function test_FinalizeEarlyRefundsUnpaidShares() public {
        uint256 id = _curated(5 ether, 5);
        _submit(id, a);
        _submit(id, b);
        vm.startPrank(validator);
        engine.completeTask(id, a);
        engine.completeTask(id, b);
        uint256 before = creator.balance;
        vm.expectEmit(true, false, false, true);
        emit BountyEngine.TaskClosed(id, BountyEngine.Status.Completed, 2, 3 ether);
        engine.finalizeTask(id);
        vm.stopPrank();

        assertEq(creator.balance, before + 3 ether);
        assertEq(address(engine).balance, 0);
        assertEq(uint256(engine.getTask(id).status), uint256(BountyEngine.Status.Completed));

        vm.prank(validator);
        vm.expectRevert(BountyEngine.NotOpen.selector);
        engine.completeTask(id, a);
    }

    function test_FinalizeRules() public {
        uint256 id = _curated(2 ether, 2);
        _submit(id, a);
        vm.prank(validator);
        vm.expectRevert(BountyEngine.NothingPaidYet.selector);
        engine.finalizeTask(id);
        vm.prank(validator);
        engine.completeTask(id, a);
        vm.prank(creator);
        vm.expectRevert(BountyEngine.NotValidator.selector);
        engine.finalizeTask(id);

        uint256 v = _verified(2 ether, 2);
        vm.prank(creator);
        vm.expectRevert(BountyEngine.NotCurated.selector);
        engine.finalizeTask(v);
    }

    function test_CuratedReclaimAfterDeadlineRefundsRemainder() public {
        uint256 id = _curated(3 ether, 3);
        _submit(id, a);
        vm.prank(validator);
        engine.completeTask(id, a);
        vm.warp(block.timestamp + DURATION + 1);
        uint256 before = creator.balance;
        vm.prank(creator);
        engine.reclaimExpired(id);
        assertEq(creator.balance, before + 2 ether);
        assertEq(uint256(engine.getTask(id).status), uint256(BountyEngine.Status.Completed), "someone was paid");
    }

    function test_CancelMultiBeforeEngagementRefundsAll() public {
        uint256 id = _curated(4 ether, 4);
        uint256 before = creator.balance;
        vm.prank(creator);
        engine.cancelTask(id);
        assertEq(creator.balance, before + 4 ether);
        assertEq(uint256(engine.getTask(id).status), uint256(BountyEngine.Status.Cancelled));
    }

    // =====================================================================
    //                              VERIFIED
    // =====================================================================

    function test_VerifiedFirstNValidRevealsArePaid() public {
        uint256 id = _verified(3 ether, 3);
        _commit(id, a);
        _commit(id, b);
        _commit(id, c);
        vm.roll(block.number + 1);
        _reveal(id, a);
        _reveal(id, b);
        _reveal(id, c);
        assertEq(a.balance + b.balance + c.balance, 3 ether);
        assertEq(uint256(engine.getTask(id).status), uint256(BountyEngine.Status.Completed));
    }

    // The core anti-copy rule: a copier who sees the first reveal — even in the
    // mempool, and gets their commit into the same block ahead of it — can't win.
    function test_CopierCommittingInFirstRevealBlockCannotWin() public {
        uint256 id = _verified(2 ether, 2);
        _commit(id, a);
        vm.roll(block.number + 1);

        _commit(id, copier); // same block as a's reveal, ordered before it
        _reveal(id, a);
        vm.roll(block.number + 1);

        vm.prank(copier);
        vm.expectRevert(BountyEngine.CommitsClosed.selector);
        engine.revealAndClaim(id, SECRET, bytes32(uint256(uint160(copier))));
    }

    function test_NoNewCommitsOrRecommitsAfterFirstPayout() public {
        uint256 id = _verified(2 ether, 2);
        _commit(id, a);
        _commit(id, b);
        vm.roll(block.number + 1);
        _reveal(id, a);

        vm.prank(copier);
        vm.expectRevert(BountyEngine.CommitsClosed.selector);
        engine.commitAnswer(id, keccak256("x"));

        // b committed in time, but can't refresh the commit after the answer is out
        vm.prank(b);
        vm.expectRevert(BountyEngine.CommitsClosed.selector);
        engine.commitAnswer(id, keccak256("refresh"));

        // b's original, earlier commit still wins the second share
        vm.roll(block.number + 1);
        _reveal(id, b);
        assertEq(b.balance, 1 ether);
    }

    function test_VerifiedSameSolverCannotWinTwice() public {
        uint256 id = _verified(2 ether, 2);
        _commit(id, a);
        vm.roll(block.number + 1);
        _reveal(id, a);
        vm.prank(a);
        vm.expectRevert(BountyEngine.AlreadyWon.selector);
        engine.revealAndClaim(id, SECRET, bytes32(uint256(uint160(a))));
    }

    function test_VerifiedReclaimRemainderAfterGrace() public {
        uint256 id = _verified(4 ether, 4);
        _commit(id, a);
        vm.roll(block.number + 1);
        _reveal(id, a);
        vm.warp(block.timestamp + DURATION + engine.REVEAL_GRACE() + 1);
        uint256 before = creator.balance;
        vm.prank(creator);
        engine.reclaimExpired(id);
        assertEq(creator.balance, before + 3 ether);
        assertEq(address(engine).balance, 0);
    }

    function test_FirstPaidBlockRecorded() public {
        uint256 id = _verified(2 ether, 2);
        _commit(id, a);
        vm.roll(block.number + 7);
        _reveal(id, a);
        assertEq(engine.getTask(id).firstPaidBlock, block.number);
        assertEq(engine.getTask(id).winner, a);
    }

    // =====================================================================
    //                              FUZZ
    // =====================================================================

    /// Any number of winners paid, then the remainder reclaimed: every wei is
    /// accounted for exactly once.
    function testFuzz_SharesAndRemainderConserve(uint16 winners, uint16 paid, uint96 share) public {
        winners = uint16(bound(winners, 1, engine.MAX_WINNERS()));
        paid = uint16(bound(paid, 0, winners));
        share = uint96(bound(share, 1, engine.MAX_REWARD() / winners));
        uint256 reward = uint256(share) * winners;

        uint256 id = _curated(reward, winners);
        for (uint16 i = 0; i < paid; i++) {
            address w = address(uint160(0x1000 + i));
            _submit(id, w);
            vm.prank(validator);
            engine.completeTask(id, w);
            assertEq(w.balance, share);
        }
        if (paid < winners) {
            vm.warp(block.timestamp + DURATION + 1);
            uint256 before = creator.balance;
            vm.prank(creator);
            engine.reclaimExpired(id);
            assertEq(creator.balance - before, reward - uint256(share) * paid);
        }
        assertEq(address(engine).balance, 0);
    }
}
