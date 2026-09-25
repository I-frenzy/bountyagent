// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {BountyEngine} from "../src/BountyEngine.sol";
import {PreimageVerifier} from "../src/verifiers/PreimageVerifier.sol";
import {BackdoorVerifier} from "../src/verifiers/BackdoorVerifier.sol";
import {VulnerableTarget} from "../src/demo/VulnerableTarget.sol";
import {
    RevertingVerifier,
    GasBurnerVerifier,
    ReturnBombVerifier,
    StateWritingVerifier,
    GarbageReturnVerifier,
    ReentrantAgent,
    RejectingAgent
} from "./Attackers.sol";

contract BountyEngineTest is Test {
    BountyEngine engine;
    PreimageVerifier preimage;
    BackdoorVerifier backdoor;
    VulnerableTarget target;

    address creator = makeAddr("creator");
    address validator = makeAddr("validator");
    address agentA = makeAddr("agentA");
    address agentB = makeAddr("agentB");
    address attacker = makeAddr("attacker");

    uint64 constant DURATION = 1 days;

    function setUp() public {
        engine = new BountyEngine();
        preimage = new PreimageVerifier();
        backdoor = new BackdoorVerifier();
        target = new VulnerableTarget();
        vm.deal(creator, 1000 ether);
        vm.deal(agentA, 1 ether);
        vm.deal(agentB, 1 ether);
        vm.deal(attacker, 1 ether);
    }

    // --- helpers -----------------------------------------------------------

    function _commitment(bytes memory answer, bytes32 salt, address solver) internal pure returns (bytes32) {
        return keccak256(abi.encode(answer, salt, solver));
    }

    /// A valid default deadline, one day out.
    function _dl() internal view returns (uint64) {
        return uint64(block.timestamp + DURATION);
    }

    function _postCurated() internal returns (uint256 id) {
        vm.prank(creator);
        id = engine.createTask{value: 1 ether}("audit this contract", validator, _dl());
    }

    function _postPreimage(bytes memory secret) internal returns (uint256 id) {
        vm.prank(creator);
        id = engine.createVerifiedTask{value: 1 ether}(
            "find the preimage", address(preimage), abi.encode(keccak256(secret)), _dl()
        );
    }

    function _postVerified(address verifier, bytes memory taskData) internal returns (uint256 id) {
        vm.prank(creator);
        id = engine.createVerifiedTask{value: 1 ether}("spec", verifier, taskData, _dl());
    }

    function _commitAndRoll(uint256 id, address who, bytes memory answer, bytes32 salt) internal {
        vm.prank(who);
        engine.commitAnswer(id, _commitment(answer, salt, who));
        vm.roll(block.number + 1);
    }

    // =====================================================================
    //                             CURATED
    // =====================================================================

    function test_OwnerIsDeployer() public view {
        assertEq(engine.owner(), address(this));
    }

    function test_CuratedCreateLocksEscrow() public {
        uint256 id = _postCurated();
        assertEq(address(engine).balance, 1 ether);
        BountyEngine.Task memory t = engine.getTask(id);
        assertEq(t.creator, creator);
        assertEq(t.validator, validator);
        assertEq(t.reward, 1 ether);
        assertEq(t.createdBlock, block.number);
        assertEq(t.settledBlock, 0);
        assertEq(uint256(t.mode), uint256(BountyEngine.Mode.Curated));
        assertEq(uint256(t.status), uint256(BountyEngine.Status.Open));
    }

    function test_CuratedDefaultsValidatorToCreator() public {
        vm.prank(creator);
        uint256 id = engine.createTask{value: 1 ether}("spec", address(0), _dl());
        assertEq(engine.getTask(id).validator, creator);
    }

    function test_CuratedCompletePaysWinnerAndKeepsReward() public {
        uint256 id = _postCurated();
        vm.prank(agentA);
        engine.submitResult(id, "result-a");
        vm.prank(agentB);
        engine.submitResult(id, "result-b");

        vm.roll(block.number + 5);
        uint256 before = agentB.balance;
        vm.prank(validator);
        engine.completeTask(id, agentB);

        assertEq(agentB.balance, before + 1 ether);
        assertEq(address(engine).balance, 0);
        BountyEngine.Task memory t = engine.getTask(id);
        assertEq(t.winner, agentB);
        assertEq(t.reward, 1 ether, "original reward kept for display");
        assertEq(t.settledBlock, block.number);
    }

    function test_CuratedOnlyValidatorCompletes() public {
        uint256 id = _postCurated();
        vm.prank(agentA);
        engine.submitResult(id, "a");
        vm.prank(creator);
        vm.expectRevert(BountyEngine.NotValidator.selector);
        engine.completeTask(id, agentA);
    }

    function test_CuratedWinnerMustHaveSubmitted() public {
        uint256 id = _postCurated();
        vm.prank(validator);
        vm.expectRevert(BountyEngine.WinnerNeverSubmitted.selector);
        engine.completeTask(id, agentA);
    }

    function test_CuratedCreatorAndValidatorCannotSubmit() public {
        uint256 id = _postCurated();
        vm.prank(creator);
        vm.expectRevert(BountyEngine.SelfSubmit.selector);
        engine.submitResult(id, "x");
        vm.prank(validator);
        vm.expectRevert(BountyEngine.SelfSubmit.selector);
        engine.submitResult(id, "x");
    }

    function test_CuratedCancelNoSubmissions() public {
        uint256 id = _postCurated();
        uint256 before = creator.balance;
        vm.prank(creator);
        engine.cancelTask(id);
        assertEq(creator.balance, before + 1 ether);
        assertEq(engine.getTask(id).settledBlock, block.number);
    }

    function test_CuratedCannotCancelAfterSubmission() public {
        uint256 id = _postCurated();
        vm.prank(agentA);
        engine.submitResult(id, "a");
        vm.prank(creator);
        vm.expectRevert(BountyEngine.AlreadyEngaged.selector);
        engine.cancelTask(id);
    }

    function test_CuratedReclaimExpiredWithSubmissions() public {
        uint256 id = _postCurated();
        vm.prank(agentA);
        engine.submitResult(id, "a");

        vm.warp(block.timestamp + DURATION + 1);
        uint256 before = creator.balance;
        vm.prank(creator);
        engine.reclaimExpired(id);
        assertEq(creator.balance, before + 1 ether);
        assertEq(uint256(engine.getTask(id).status), uint256(BountyEngine.Status.Cancelled));
    }

    function test_ReclaimBeforeDeadlineReverts() public {
        uint256 id = _postCurated();
        vm.prank(creator);
        vm.expectRevert(BountyEngine.NotExpired.selector);
        engine.reclaimExpired(id);
    }

    function test_CuratedSubmissionCap() public {
        uint256 id = _postCurated();
        uint256 cap = engine.MAX_SUBMISSIONS();
        for (uint256 i = 0; i < cap; i++) {
            vm.prank(address(uint160(0x10000 + i)));
            engine.submitResult(id, "r");
        }
        vm.prank(agentA);
        vm.expectRevert(BountyEngine.TooManySubmissions.selector);
        engine.submitResult(id, "r");

        // an existing submitter can still update theirs at the cap
        vm.prank(address(uint160(0x10000)));
        engine.submitResult(id, "updated");
        assertEq(engine.getSubmissions(id)[0].resultURI, "updated");
        assertEq(engine.submissionCount(id), cap);
    }

    function test_CuratedValidatorCanStillPayAfterDeadline() public {
        uint256 id = _postCurated();
        vm.prank(agentA);
        engine.submitResult(id, "a");
        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(validator);
        engine.completeTask(id, agentA); // creator hasn't reclaimed yet
        assertEq(engine.getTask(id).winner, agentA);
    }

    // =====================================================================
    //                        VERIFIED — preimage
    // =====================================================================

    function test_VerifiedCreate() public {
        uint256 id = _postPreimage("secret");
        BountyEngine.Task memory t = engine.getTask(id);
        assertEq(uint256(t.mode), uint256(BountyEngine.Mode.Verified));
        assertEq(t.verifier, address(preimage));
        assertEq(t.validator, address(0));
    }

    function test_VerifiedRejectsMissingOrNonContractVerifier() public {
        vm.startPrank(creator);
        vm.expectRevert(BountyEngine.NoVerifier.selector);
        engine.createVerifiedTask{value: 1 ether}("x", address(0), "", _dl());
        vm.expectRevert(BountyEngine.VerifierNotContract.selector);
        engine.createVerifiedTask{value: 1 ether}("x", address(0xdead), "", _dl());
        vm.stopPrank();
    }

    function test_VerifiedCommitRevealPaysSolver() public {
        bytes memory secret = "s3cr3t";
        uint256 id = _postPreimage(secret);
        bytes32 salt = keccak256("salt-a");
        _commitAndRoll(id, agentA, secret, salt);

        uint256 before = agentA.balance;
        vm.expectEmit(true, true, false, true);
        emit BountyEngine.AnswerRevealed(id, agentA, secret);
        vm.prank(agentA);
        engine.revealAndClaim(id, secret, salt);

        assertEq(agentA.balance, before + 1 ether);
        assertEq(address(engine).balance, 0);
        BountyEngine.Task memory t = engine.getTask(id);
        assertEq(t.winner, agentA);
        assertEq(t.reward, 1 ether);
        assertEq(t.settledBlock, block.number);
        assertEq(uint256(t.status), uint256(BountyEngine.Status.Completed));
    }

    function test_VerifiedRevealTooEarlyReverts() public {
        bytes memory secret = "abc";
        uint256 id = _postPreimage(secret);
        bytes32 salt = keccak256("s");
        vm.startPrank(agentA);
        engine.commitAnswer(id, _commitment(secret, salt, agentA));
        vm.expectRevert(BountyEngine.RevealTooEarly.selector); // same block as commit
        engine.revealAndClaim(id, secret, salt);
        vm.stopPrank();
    }

    function test_VerifiedBadRevealReverts() public {
        bytes memory secret = "abc";
        uint256 id = _postPreimage(secret);
        _commitAndRoll(id, agentA, secret, keccak256("s"));
        vm.prank(agentA);
        vm.expectRevert(BountyEngine.BadReveal.selector); // wrong salt
        engine.revealAndClaim(id, secret, keccak256("wrong"));
    }

    function test_VerifiedInvalidAnswerStaysOpen() public {
        uint256 id = _postPreimage("right");
        bytes memory wrong = "wrong";
        bytes32 salt = keccak256("s");
        _commitAndRoll(id, agentA, wrong, salt);
        vm.prank(agentA);
        vm.expectRevert(BountyEngine.InvalidAnswer.selector);
        engine.revealAndClaim(id, wrong, salt);
        assertEq(address(engine).balance, 1 ether);
        assertEq(uint256(engine.getTask(id).status), uint256(BountyEngine.Status.Open));
    }

    function test_VerifiedFrontRunnerWithoutCommitCannotClaim() public {
        bytes memory secret = "leaked";
        uint256 id = _postPreimage(secret);
        bytes32 salt = keccak256("s");
        _commitAndRoll(id, agentA, secret, salt);

        vm.prank(attacker); // learned `secret` from the mempool, never committed
        vm.expectRevert(BountyEngine.NoCommit.selector);
        engine.revealAndClaim(id, secret, salt);
    }

    function test_VerifiedFrontRunnerSameBlockCommitBlocked() public {
        bytes memory secret = "leaked2";
        uint256 id = _postPreimage(secret);
        bytes32 salt = keccak256("z");
        vm.startPrank(attacker);
        engine.commitAnswer(id, _commitment(secret, salt, attacker));
        vm.expectRevert(BountyEngine.RevealTooEarly.selector);
        engine.revealAndClaim(id, secret, salt);
        vm.stopPrank();
    }

    // Copying someone else's commitment hash is useless: it binds their address.
    function test_VerifiedCopiedCommitmentIsUseless() public {
        bytes memory secret = "mine";
        uint256 id = _postPreimage(secret);
        bytes32 salt = keccak256("s");
        bytes32 agentACommit = _commitment(secret, salt, agentA);
        vm.prank(agentA);
        engine.commitAnswer(id, agentACommit);
        vm.prank(attacker);
        engine.commitAnswer(id, agentACommit); // copies the hash from the mempool
        vm.roll(block.number + 1);

        vm.prank(attacker); // even with the right answer + salt
        vm.expectRevert(BountyEngine.BadReveal.selector);
        engine.revealAndClaim(id, secret, salt);

        vm.prank(agentA);
        engine.revealAndClaim(id, secret, salt);
        assertEq(engine.getTask(id).winner, agentA);
    }

    // Re-committing resets the reveal block, so it can't be used to skip the wait.
    function test_VerifiedRecommitResetsRevealBlock() public {
        bytes memory secret = "x";
        uint256 id = _postPreimage(secret);
        bytes32 salt = keccak256("s");
        _commitAndRoll(id, agentA, "wrong", salt);
        vm.startPrank(agentA);
        engine.commitAnswer(id, _commitment(secret, salt, agentA));
        vm.expectRevert(BountyEngine.RevealTooEarly.selector);
        engine.revealAndClaim(id, secret, salt);
        vm.stopPrank();
        assertEq(engine.commitCount(id), 1, "re-commit does not double count");
    }

    function test_VerifiedCreatorCannotSolve() public {
        uint256 id = _postPreimage("x");
        vm.prank(creator);
        vm.expectRevert(BountyEngine.SelfSolve.selector);
        engine.commitAnswer(id, keccak256("c"));
    }

    function test_VerifiedEmptyCommitmentRejected() public {
        uint256 id = _postPreimage("x");
        vm.prank(agentA);
        vm.expectRevert(BountyEngine.EmptyCommitment.selector);
        engine.commitAnswer(id, bytes32(0));
    }

    function test_VerifiedCannotCancelAfterCommit() public {
        uint256 id = _postPreimage("x");
        vm.prank(agentA);
        engine.commitAnswer(id, keccak256("c"));
        vm.prank(creator);
        vm.expectRevert(BountyEngine.AlreadyEngaged.selector);
        engine.cancelTask(id);
    }

    function test_VerifiedReclaimExpiredRefundsCreator() public {
        uint256 id = _postPreimage("x");
        vm.prank(agentA);
        engine.commitAnswer(id, keccak256("c")); // engaged but never solved
        vm.warp(block.timestamp + DURATION + engine.REVEAL_GRACE() + 1);
        uint256 before = creator.balance;
        vm.prank(creator);
        engine.reclaimExpired(id);
        assertEq(creator.balance, before + 1 ether);
    }

    function test_ModeMismatchReverts() public {
        uint256 curated = _postCurated();
        uint256 verified = _postPreimage("x");
        vm.prank(agentA);
        vm.expectRevert(BountyEngine.NotVerified.selector);
        engine.commitAnswer(curated, keccak256("c"));
        vm.prank(agentA);
        vm.expectRevert(BountyEngine.NotCurated.selector);
        engine.submitResult(verified, "r");
    }

    function test_UnknownTaskReverts() public {
        vm.expectRevert(BountyEngine.NoTask.selector);
        engine.commitAnswer(999, keccak256("c"));
    }

    // =====================================================================
    //                        VERIFIED — backdoor CTF
    // =====================================================================

    function _postBackdoor() internal returns (uint256 id) {
        bytes memory taskData = abi.encode(address(target), uint256(1_000_000));
        vm.prank(creator);
        id = engine.createVerifiedTask{value: 2 ether}(
            "find a small input that passes VulnerableTarget.check()", address(backdoor), taskData, _dl()
        );
    }

    function test_BackdoorSolvePaysAgent() public {
        uint256 id = _postBackdoor();
        bytes memory answer = abi.encode(uint256(1337));
        bytes32 salt = keccak256("bd");
        _commitAndRoll(id, agentA, answer, salt);

        uint256 before = agentA.balance;
        vm.prank(agentA);
        engine.revealAndClaim(id, answer, salt);
        assertEq(agentA.balance, before + 2 ether);
    }

    function test_BackdoorWrongInputRejected() public {
        uint256 id = _postBackdoor();
        bytes memory answer = abi.encode(uint256(500));
        bytes32 salt = keccak256("bd");
        _commitAndRoll(id, agentA, answer, salt);
        vm.prank(agentA);
        vm.expectRevert(BountyEngine.InvalidAnswer.selector);
        engine.revealAndClaim(id, answer, salt);
    }

    function test_BackdoorLargeInputOverCapRejected() public {
        uint256 id = _postBackdoor();
        bytes memory answer = abi.encode(uint256(2_000_000));
        bytes32 salt = keccak256("bd");
        _commitAndRoll(id, agentA, answer, salt);
        vm.prank(agentA);
        vm.expectRevert(BountyEngine.InvalidAnswer.selector);
        engine.revealAndClaim(id, answer, salt);
    }

    // Malformed answer bytes make the verifier's abi.decode revert → invalid.
    function test_BackdoorMalformedAnswerRejected() public {
        uint256 id = _postBackdoor();
        bytes memory answer = hex"01";
        bytes32 salt = keccak256("bd");
        _commitAndRoll(id, agentA, answer, salt);
        vm.prank(agentA);
        vm.expectRevert(BountyEngine.InvalidAnswer.selector);
        engine.revealAndClaim(id, answer, salt);
    }

    function test_ComputeCommitmentMatches() public view {
        bytes memory answer = abi.encode(uint256(1337));
        bytes32 salt = keccak256("x");
        assertEq(engine.computeCommitment(answer, salt, agentA), _commitment(answer, salt, agentA));
    }

    // =====================================================================
    //                   DEADLINES & CAPS (H-1: no permanent lockup)
    // =====================================================================

    function test_CreateWithoutDeadlineReverts() public {
        vm.startPrank(creator);
        vm.expectRevert(BountyEngine.DeadlineTooSoon.selector);
        engine.createTask{value: 1 ether}("spec", validator, 0);
        vm.expectRevert(BountyEngine.DeadlineTooSoon.selector);
        engine.createVerifiedTask{value: 1 ether}("spec", address(preimage), abi.encode(bytes32(0)), 0);
        vm.stopPrank();
    }

    function test_CreateDeadlineTooSoonReverts() public {
        uint64 deadline = uint64(block.timestamp + engine.MIN_DURATION() - 1);
        vm.prank(creator);
        vm.expectRevert(BountyEngine.DeadlineTooSoon.selector);
        engine.createTask{value: 1 ether}("spec", validator, deadline);
    }

    function test_CreateDeadlineTooFarReverts() public {
        uint64 deadline = uint64(block.timestamp + engine.MAX_DURATION() + 1);
        vm.prank(creator);
        vm.expectRevert(BountyEngine.DeadlineTooFar.selector);
        engine.createTask{value: 1 ether}("spec", validator, deadline);
    }

    function test_CreateDeadlineBoundsInclusive() public {
        uint64 lo = uint64(block.timestamp + engine.MIN_DURATION());
        uint64 hi = uint64(block.timestamp + engine.MAX_DURATION());
        vm.startPrank(creator);
        engine.createTask{value: 1 ether}("spec", validator, lo);
        engine.createTask{value: 1 ether}("spec", validator, hi);
        vm.stopPrank();
        assertEq(engine.taskCount(), 2);
    }

    function test_CreateRequiresBountyAndSpec() public {
        vm.startPrank(creator);
        vm.expectRevert(BountyEngine.NoBounty.selector);
        engine.createTask("spec", validator, _dl());
        vm.expectRevert(BountyEngine.EmptySpec.selector);
        engine.createTask{value: 1 ether}("", validator, _dl());
        vm.stopPrank();
    }

    function test_RewardCap() public {
        uint256 max = engine.MAX_REWARD();
        vm.startPrank(creator);
        engine.createTask{value: max}("spec", validator, _dl());
        vm.expectRevert(BountyEngine.RewardTooHigh.selector);
        engine.createTask{value: max + 1}("spec", validator, _dl());
        vm.stopPrank();
    }

    // The original H-1 attack: a stranger's junk engagement must not brick escrow.
    function test_JunkSubmissionCannotLockCuratedForever() public {
        uint256 id = _postCurated();
        vm.prank(attacker);
        engine.submitResult(id, "junk");
        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(creator);
        engine.reclaimExpired(id);
        assertEq(address(engine).balance, 0);
    }

    function test_JunkCommitCannotLockVerifiedForever() public {
        uint256 id = _postPreimage("x");
        vm.prank(attacker);
        engine.commitAnswer(id, keccak256("junk"));
        vm.warp(block.timestamp + DURATION + engine.REVEAL_GRACE() + 1);
        vm.prank(creator);
        engine.reclaimExpired(id);
        assertEq(address(engine).balance, 0);
    }

    function test_SubmitAfterDeadlineReverts() public {
        uint256 id = _postCurated();
        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(agentA);
        vm.expectRevert(BountyEngine.DeadlinePassed.selector);
        engine.submitResult(id, "late");
    }

    function test_CommitAfterDeadlineReverts() public {
        uint256 id = _postPreimage("x");
        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(agentA);
        vm.expectRevert(BountyEngine.DeadlinePassed.selector);
        engine.commitAnswer(id, keccak256("late"));
    }

    function test_VerifiedReclaimBlockedDuringRevealGrace() public {
        uint256 id = _postPreimage("x");
        vm.prank(agentA);
        engine.commitAnswer(id, keccak256("c"));
        vm.warp(block.timestamp + DURATION + engine.REVEAL_GRACE()); // at the grace edge
        vm.prank(creator);
        vm.expectRevert(BountyEngine.NotExpired.selector);
        engine.reclaimExpired(id);
    }

    // Arc blocks can share a timestamp: commit at the deadline, reveal in a later
    // block with the same timestamp, still inside the grace window.
    function test_VerifiedLateCommitterCanRevealInGrace() public {
        bytes memory secret = "last-minute";
        uint256 id = _postPreimage(secret);
        bytes32 salt = keccak256("s");

        vm.warp(block.timestamp + DURATION); // commit at the deadline itself
        _commitAndRoll(id, agentA, secret, salt); // next block, same timestamp

        vm.prank(creator);
        vm.expectRevert(BountyEngine.NotExpired.selector);
        engine.reclaimExpired(id);

        uint256 before = agentA.balance;
        vm.prank(agentA);
        engine.revealAndClaim(id, secret, salt);
        assertEq(agentA.balance, before + 1 ether);
    }

    // =====================================================================
    //                   NO DOUBLE SETTLEMENT (reward is kept, status guards)
    // =====================================================================

    function test_CompletedTaskCannotBeSettledAgain() public {
        bytes memory secret = "s";
        uint256 id = _postPreimage(secret);
        bytes32 salt = keccak256("s");
        _commitAndRoll(id, agentA, secret, salt);
        vm.prank(agentA);
        engine.revealAndClaim(id, secret, salt);

        vm.prank(agentA);
        vm.expectRevert(BountyEngine.NotOpen.selector);
        engine.revealAndClaim(id, secret, salt);

        vm.warp(block.timestamp + DURATION + engine.REVEAL_GRACE() + 1);
        vm.startPrank(creator);
        vm.expectRevert(BountyEngine.NotOpen.selector);
        engine.reclaimExpired(id);
        vm.expectRevert(BountyEngine.NotOpen.selector);
        engine.cancelTask(id);
        vm.stopPrank();
    }

    function test_CuratedCompletedCannotBePaidTwice() public {
        uint256 id = _postCurated();
        vm.prank(agentA);
        engine.submitResult(id, "a");
        vm.prank(agentB);
        engine.submitResult(id, "b");
        vm.startPrank(validator);
        engine.completeTask(id, agentA);
        vm.expectRevert(BountyEngine.NotOpen.selector);
        engine.completeTask(id, agentB);
        vm.stopPrank();
    }

    function test_CancelledTaskCannotBeReclaimed() public {
        uint256 id = _postCurated();
        vm.startPrank(creator);
        engine.cancelTask(id);
        vm.warp(block.timestamp + DURATION + 1);
        vm.expectRevert(BountyEngine.NotOpen.selector);
        engine.reclaimExpired(id);
        vm.stopPrank();
    }

    // =====================================================================
    //                      MALICIOUS VERIFIERS
    // =====================================================================

    function _revealAgainst(address verifier) internal returns (uint256 id, bytes32 salt, bytes memory answer) {
        id = _postVerified(verifier, "");
        answer = "anything";
        salt = keccak256("s");
        _commitAndRoll(id, agentA, answer, salt);
    }

    function test_RevertingVerifierIsInvalidNotBrick() public {
        (uint256 id, bytes32 salt, bytes memory answer) = _revealAgainst(address(new RevertingVerifier()));
        vm.prank(agentA);
        vm.expectRevert(BountyEngine.InvalidAnswer.selector);
        engine.revealAndClaim(id, answer, salt);
        _assertStillReclaimable(id, true);
    }

    function test_StateWritingVerifierFailsUnderStaticcall() public {
        StateWritingVerifier v = new StateWritingVerifier();
        (uint256 id, bytes32 salt, bytes memory answer) = _revealAgainst(address(v));
        vm.prank(agentA);
        vm.expectRevert(BountyEngine.InvalidAnswer.selector);
        engine.revealAndClaim(id, answer, salt);
        assertEq(v.writes(), 0);
    }

    function test_GasBurnerVerifierIsInvalid() public {
        (uint256 id, bytes32 salt, bytes memory answer) = _revealAgainst(address(new GasBurnerVerifier()));
        vm.prank(agentA);
        vm.expectRevert(BountyEngine.InvalidAnswer.selector);
        engine.revealAndClaim{gas: 5_000_000}(id, answer, salt);
        _assertStillReclaimable(id, true);
    }

    // Return-data bomb / non-bool return: the reveal reverts as a whole (no state
    // change); the escrow stays safe and reclaimable after the deadline.
    function test_ReturnBombVerifierCannotBrickEscrow() public {
        (uint256 id, bytes32 salt, bytes memory answer) = _revealAgainst(address(new ReturnBombVerifier()));
        vm.prank(agentA);
        vm.expectRevert();
        engine.revealAndClaim{gas: 5_000_000}(id, answer, salt);
        _assertStillReclaimable(id, true);
    }

    function test_GarbageReturnVerifierCannotBrickEscrow() public {
        (uint256 id, bytes32 salt, bytes memory answer) = _revealAgainst(address(new GarbageReturnVerifier()));
        vm.prank(agentA);
        vm.expectRevert();
        engine.revealAndClaim(id, answer, salt);
        _assertStillReclaimable(id, true);
    }

    // A revealer who starves the verifier of gas (63/64 rule) only hurts
    // themselves: the tx reverts, and a properly-funded reveal still wins.
    function test_LowGasRevealDoesNotConsumeCommitment() public {
        bytes memory secret = "gas";
        uint256 id = _postPreimage(secret);
        bytes32 salt = keccak256("s");
        _commitAndRoll(id, agentA, secret, salt);

        vm.prank(agentA);
        (bool ok,) =
            address(engine).call{gas: 30_000}(abi.encodeCall(engine.revealAndClaim, (id, secret, salt)));
        assertFalse(ok);
        assertEq(uint256(engine.getTask(id).status), uint256(BountyEngine.Status.Open));

        vm.prank(agentA);
        engine.revealAndClaim(id, secret, salt);
        assertEq(engine.getTask(id).winner, agentA);
    }

    function _assertStillReclaimable(uint256 id, bool verified) internal {
        assertEq(uint256(engine.getTask(id).status), uint256(BountyEngine.Status.Open));
        vm.warp(block.timestamp + DURATION + (verified ? engine.REVEAL_GRACE() : 0) + 1);
        uint256 before = creator.balance;
        vm.prank(creator);
        engine.reclaimExpired(id);
        assertEq(creator.balance, before + engine.getTask(id).reward);
    }

    // =====================================================================
    //                      MALICIOUS RECIPIENTS
    // =====================================================================

    // A winner contract that re-enters the engine from receive() is blocked by
    // the guard. The re-entry target (cancelling its own untouched task) would
    // succeed on its own, so a revert here can only come from the guard.
    function test_ReentrantWinnerCannotReenter() public {
        ReentrantAgent bad = new ReentrantAgent(engine);
        bad.postOwn{value: 1 ether}(_dl());

        bytes memory secret = "re";
        uint256 id = _postPreimage(secret);
        bytes32 salt = keccak256("s");
        bad.commit(id, _commitment(secret, salt, address(bad)));
        vm.roll(block.number + 1);

        bad.arm();
        bad.reveal(id, secret, salt);

        assertEq(address(bad).balance, 1 ether, "paid exactly once");
        assertTrue(bad.reentryAttempted());
        assertFalse(bad.reentrySucceeded());
        assertEq(bad.reentryError(), BountyEngine.Reentrant.selector);
        assertEq(address(engine).balance, 1 ether, "its own task's escrow untouched");

        // outside a payout, the same cancel works — proving the guard caused the revert
        uint256 own = bad.ownTask();
        vm.prank(address(bad));
        engine.cancelTask(own);
        assertEq(address(engine).balance, 0);
    }

    // A winner that rejects USDC only blocks its own payout; the task stays
    // open for someone else.
    function test_RejectingWinnerOnlyHurtsItself() public {
        RejectingAgent bad = new RejectingAgent(engine);
        bytes memory secret = "rej";
        uint256 id = _postPreimage(secret);
        bytes32 salt = keccak256("s");
        bad.commit(id, _commitment(secret, salt, address(bad)));
        _commitAndRoll(id, agentA, secret, salt);

        vm.expectRevert(BountyEngine.TransferFailed.selector);
        bad.reveal(id, secret, salt);
        assertEq(uint256(engine.getTask(id).status), uint256(BountyEngine.Status.Open));

        vm.prank(agentA);
        engine.revealAndClaim(id, secret, salt);
        assertEq(engine.getTask(id).winner, agentA);
    }

    function test_CuratedRejectingWinnerValidatorPicksAnother() public {
        RejectingAgent bad = new RejectingAgent(engine);
        uint256 id = _postCurated();
        bad.submit(id, "r");
        vm.prank(agentA);
        engine.submitResult(id, "a");

        vm.startPrank(validator);
        vm.expectRevert(BountyEngine.TransferFailed.selector);
        engine.completeTask(id, address(bad));
        engine.completeTask(id, agentA);
        vm.stopPrank();
        assertEq(engine.getTask(id).winner, agentA);
    }

    // =====================================================================
    //                              FUZZ
    // =====================================================================

    function testFuzz_CommitRevealRoundTrip(bytes calldata secret, bytes32 salt) public {
        uint256 id = _postPreimage(secret);
        _commitAndRoll(id, agentA, secret, salt);
        vm.prank(agentA);
        engine.revealAndClaim(id, secret, salt);
        assertEq(engine.getTask(id).winner, agentA);
    }

    function testFuzz_WrongSaltNeverClaims(bytes calldata secret, bytes32 salt, bytes32 other) public {
        vm.assume(salt != other);
        uint256 id = _postPreimage(secret);
        _commitAndRoll(id, agentA, secret, salt);
        vm.prank(agentA);
        vm.expectRevert(BountyEngine.BadReveal.selector);
        engine.revealAndClaim(id, secret, other);
    }

    function testFuzz_RewardAndDeadlineBounds(uint256 reward, uint64 offset) public {
        reward = bound(reward, 0, engine.MAX_REWARD() * 2);
        offset = uint64(bound(offset, 0, engine.MAX_DURATION() * 2));
        uint64 deadline = uint64(block.timestamp) + offset;
        vm.deal(creator, reward);
        bool valid = reward > 0 && reward <= engine.MAX_REWARD() && offset >= engine.MIN_DURATION()
            && offset <= engine.MAX_DURATION();
        vm.prank(creator);
        if (!valid) vm.expectRevert();
        engine.createTask{value: reward}("spec", validator, deadline);
    }
}
