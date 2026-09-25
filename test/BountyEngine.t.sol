// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Test} from "forge-std/Test.sol";
import {BountyEngine} from "../src/BountyEngine.sol";
import {PreimageVerifier} from "../src/verifiers/PreimageVerifier.sol";
import {BackdoorVerifier} from "../src/verifiers/BackdoorVerifier.sol";
import {VulnerableTarget} from "../src/demo/VulnerableTarget.sol";

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

    function setUp() public {
        engine = new BountyEngine();
        preimage = new PreimageVerifier();
        backdoor = new BackdoorVerifier();
        target = new VulnerableTarget();
        vm.deal(creator, 100 ether);
        vm.deal(agentA, 1 ether);
        vm.deal(agentB, 1 ether);
        vm.deal(attacker, 1 ether);
    }

    uint64 constant DURATION = 1 days;

    function _commitment(bytes memory answer, bytes32 salt, address solver) internal pure returns (bytes32) {
        return keccak256(abi.encode(answer, salt, solver));
    }

    /// A valid default deadline, one day out.
    function _dl() internal view returns (uint64) {
        return uint64(block.timestamp + DURATION);
    }

    // =====================================================================
    //                             CURATED
    // =====================================================================

    function _postCurated(uint64 deadline) internal returns (uint256 id) {
        vm.prank(creator);
        id = engine.createTask{value: 1 ether}("audit this contract", validator, deadline);
    }

    function test_OwnerIsDeployer() public view {
        assertEq(engine.owner(), address(this));
    }

    function test_CuratedCreateLocksEscrow() public {
        uint256 id = _postCurated(_dl());
        assertEq(address(engine).balance, 1 ether);
        BountyEngine.Task memory t = engine.getTask(id);
        assertEq(t.creator, creator);
        assertEq(t.validator, validator);
        assertEq(t.reward, 1 ether);
        assertEq(uint256(t.mode), uint256(BountyEngine.Mode.Curated));
        assertEq(uint256(t.status), uint256(BountyEngine.Status.Open));
    }

    function test_CuratedDefaultsValidatorToCreator() public {
        vm.prank(creator);
        uint256 id = engine.createTask{value: 1 ether}("spec", address(0), _dl());
        assertEq(engine.getTask(id).validator, creator);
    }

    function test_CuratedCompletePaysWinner() public {
        uint256 id = _postCurated(_dl());
        vm.prank(agentA);
        engine.submitResult(id, "result-a");
        vm.prank(agentB);
        engine.submitResult(id, "result-b");

        uint256 before = agentB.balance;
        vm.prank(validator);
        engine.completeTask(id, agentB);

        assertEq(agentB.balance, before + 1 ether);
        assertEq(address(engine).balance, 0);
        assertEq(engine.getTask(id).winner, agentB);
    }

    function test_CuratedOnlyValidatorCompletes() public {
        uint256 id = _postCurated(_dl());
        vm.prank(agentA);
        engine.submitResult(id, "a");
        vm.prank(creator);
        vm.expectRevert("not validator");
        engine.completeTask(id, agentA);
    }

    function test_CuratedCreatorCannotSubmit() public {
        uint256 id = _postCurated(_dl());
        vm.prank(creator);
        vm.expectRevert("self-submit");
        engine.submitResult(id, "x");
    }

    function test_CuratedCancelNoSubmissions() public {
        uint256 id = _postCurated(_dl());
        uint256 before = creator.balance;
        vm.prank(creator);
        engine.cancelTask(id);
        assertEq(creator.balance, before + 1 ether);
    }

    function test_CuratedCannotCancelAfterSubmission() public {
        uint256 id = _postCurated(_dl());
        vm.prank(agentA);
        engine.submitResult(id, "a");
        vm.prank(creator);
        vm.expectRevert("already engaged");
        engine.cancelTask(id);
    }

    // H-1 fix: absent validator can't lock funds forever.
    function test_CuratedReclaimExpiredWithSubmissions() public {
        uint256 id = _postCurated(_dl());
        vm.prank(agentA);
        engine.submitResult(id, "a"); // engaged -> cancel now blocked
        vm.prank(creator);
        vm.expectRevert("already engaged");
        engine.cancelTask(id);

        vm.warp(block.timestamp + DURATION + 1); // past deadline
        uint256 before = creator.balance;
        vm.prank(creator);
        engine.reclaimExpired(id);
        assertEq(creator.balance, before + 1 ether);
        assertEq(uint256(engine.getTask(id).status), uint256(BountyEngine.Status.Cancelled));
    }

    function test_ReclaimBeforeDeadlineReverts() public {
        uint256 id = _postCurated(_dl());
        vm.prank(creator);
        vm.expectRevert("not expired");
        engine.reclaimExpired(id);
    }

    // =====================================================================
    //                        VERIFIED — preimage
    // =====================================================================

    function _postPreimage(bytes memory secret, uint64 deadline) internal returns (uint256 id) {
        bytes32 hash = keccak256(secret);
        vm.prank(creator);
        id = engine.createVerifiedTask{value: 1 ether}(
            "find the preimage", address(preimage), abi.encode(hash), deadline
        );
    }

    function test_VerifiedCreate() public {
        uint256 id = _postPreimage("secret", _dl());
        BountyEngine.Task memory t = engine.getTask(id);
        assertEq(uint256(t.mode), uint256(BountyEngine.Mode.Verified));
        assertEq(t.verifier, address(preimage));
        assertEq(t.validator, address(0));
    }

    function test_VerifiedRejectsNonContractVerifier() public {
        vm.prank(creator);
        vm.expectRevert("verifier not a contract");
        engine.createVerifiedTask{value: 1 ether}("x", address(0xdead), "", _dl());
    }

    function test_VerifiedCommitRevealPaysSolver() public {
        bytes memory secret = "s3cr3t";
        uint256 id = _postPreimage(secret, _dl());
        bytes32 salt = keccak256("salt-a");

        vm.prank(agentA);
        engine.commitAnswer(id, _commitment(secret, salt, agentA));

        vm.roll(block.number + 1); // reveal must be a later block

        uint256 before = agentA.balance;
        vm.prank(agentA);
        engine.revealAndClaim(id, secret, salt);

        assertEq(agentA.balance, before + 1 ether);
        assertEq(address(engine).balance, 0);
        BountyEngine.Task memory t = engine.getTask(id);
        assertEq(t.winner, agentA);
        assertEq(uint256(t.status), uint256(BountyEngine.Status.Completed));
    }

    function test_VerifiedRevealTooEarlyReverts() public {
        bytes memory secret = "abc";
        uint256 id = _postPreimage(secret, _dl());
        bytes32 salt = keccak256("s");
        vm.startPrank(agentA);
        engine.commitAnswer(id, _commitment(secret, salt, agentA));
        vm.expectRevert("reveal too early"); // same block as commit
        engine.revealAndClaim(id, secret, salt);
        vm.stopPrank();
    }

    function test_VerifiedBadRevealReverts() public {
        bytes memory secret = "abc";
        uint256 id = _postPreimage(secret, _dl());
        bytes32 salt = keccak256("s");
        vm.prank(agentA);
        engine.commitAnswer(id, _commitment(secret, salt, agentA));
        vm.roll(block.number + 1);
        vm.prank(agentA);
        vm.expectRevert("bad reveal"); // wrong salt
        engine.revealAndClaim(id, secret, keccak256("wrong"));
    }

    function test_VerifiedInvalidAnswerStaysOpen() public {
        uint256 id = _postPreimage("right", _dl());
        bytes memory wrong = "wrong";
        bytes32 salt = keccak256("s");
        vm.prank(agentA);
        engine.commitAnswer(id, _commitment(wrong, salt, agentA));
        vm.roll(block.number + 1);
        vm.prank(agentA);
        vm.expectRevert("invalid answer");
        engine.revealAndClaim(id, wrong, salt);
        // escrow intact, task still open
        assertEq(address(engine).balance, 1 ether);
        assertEq(uint256(engine.getTask(id).status), uint256(BountyEngine.Status.Open));
    }

    // Front-run resistance: an attacker who sees the winning answer but never
    // committed cannot claim.
    function test_VerifiedFrontRunnerWithoutCommitCannotClaim() public {
        bytes memory secret = "leaked";
        uint256 id = _postPreimage(secret, _dl());
        bytes32 salt = keccak256("s");
        vm.prank(agentA);
        engine.commitAnswer(id, _commitment(secret, salt, agentA));
        vm.roll(block.number + 1);

        // attacker learned `secret` from the mempool but has no prior commit
        vm.prank(attacker);
        vm.expectRevert("no commit");
        engine.revealAndClaim(id, secret, salt);
    }

    // Attacker who commits after seeing the answer still can't reveal same block.
    function test_VerifiedFrontRunnerSameBlockCommitBlocked() public {
        bytes memory secret = "leaked2";
        uint256 id = _postPreimage(secret, _dl());
        bytes32 salt = keccak256("z");
        vm.startPrank(attacker);
        engine.commitAnswer(id, _commitment(secret, salt, attacker));
        vm.expectRevert("reveal too early");
        engine.revealAndClaim(id, secret, salt);
        vm.stopPrank();
    }

    function test_VerifiedCreatorCannotSolve() public {
        uint256 id = _postPreimage("x", _dl());
        vm.prank(creator);
        vm.expectRevert("self-solve");
        engine.commitAnswer(id, keccak256("c"));
    }

    function test_VerifiedCannotCancelAfterCommit() public {
        uint256 id = _postPreimage("x", _dl());
        vm.prank(agentA);
        engine.commitAnswer(id, keccak256("c"));
        vm.prank(creator);
        vm.expectRevert("already engaged");
        engine.cancelTask(id);
    }

    function test_VerifiedReclaimExpiredRefundsCreator() public {
        uint256 id = _postPreimage("x", _dl());
        vm.prank(agentA);
        engine.commitAnswer(id, keccak256("c")); // engaged but never solved
        vm.warp(block.timestamp + DURATION + engine.REVEAL_GRACE() + 1);
        uint256 before = creator.balance;
        vm.prank(creator);
        engine.reclaimExpired(id);
        assertEq(creator.balance, before + 1 ether);
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
        bytes memory answer = abi.encode(uint256(1337)); // the backdoor value
        bytes32 salt = keccak256("bd");

        vm.prank(agentA);
        engine.commitAnswer(id, _commitment(answer, salt, agentA));
        vm.roll(block.number + 1);

        uint256 before = agentA.balance;
        vm.prank(agentA);
        engine.revealAndClaim(id, answer, salt);
        assertEq(agentA.balance, before + 2 ether);
        assertEq(engine.getTask(id).winner, agentA);
    }

    function test_BackdoorWrongInputRejected() public {
        uint256 id = _postBackdoor();
        bytes memory answer = abi.encode(uint256(500)); // not the backdoor, <= cap
        bytes32 salt = keccak256("bd");
        vm.prank(agentA);
        engine.commitAnswer(id, _commitment(answer, salt, agentA));
        vm.roll(block.number + 1);
        vm.prank(agentA);
        vm.expectRevert("invalid answer");
        engine.revealAndClaim(id, answer, salt);
    }

    function test_BackdoorLargeInputOverCapRejected() public {
        uint256 id = _postBackdoor();
        bytes memory answer = abi.encode(uint256(2_000_000)); // passes check but over cap
        bytes32 salt = keccak256("bd");
        vm.prank(agentA);
        engine.commitAnswer(id, _commitment(answer, salt, agentA));
        vm.roll(block.number + 1);
        vm.prank(agentA);
        vm.expectRevert("invalid answer");
        engine.revealAndClaim(id, answer, salt);
    }

    function test_ComputeCommitmentMatches() public view {
        bytes memory answer = abi.encode(uint256(1337));
        bytes32 salt = keccak256("x");
        assertEq(engine.computeCommitment(answer, salt, agentA), _commitment(answer, salt, agentA));
    }

    // =====================================================================
    //                   DEADLINES (H-1: no permanent lockup)
    // =====================================================================

    function test_CreateWithoutDeadlineReverts() public {
        vm.startPrank(creator);
        vm.expectRevert("deadline too soon");
        engine.createTask{value: 1 ether}("spec", validator, 0);
        vm.expectRevert("deadline too soon");
        engine.createVerifiedTask{value: 1 ether}("spec", address(preimage), abi.encode(bytes32(0)), 0);
        vm.stopPrank();
    }

    function test_CreateDeadlineTooSoonReverts() public {
        uint64 deadline = uint64(block.timestamp + engine.MIN_DURATION() - 1);
        vm.prank(creator);
        vm.expectRevert("deadline too soon");
        engine.createTask{value: 1 ether}("spec", validator, deadline);
    }

    function test_CreateDeadlineTooFarReverts() public {
        uint64 deadline = uint64(block.timestamp + engine.MAX_DURATION() + 1);
        vm.prank(creator);
        vm.expectRevert("deadline too far");
        engine.createTask{value: 1 ether}("spec", validator, deadline);
    }

    function test_CreateDeadlineBoundsInclusive() public {
        vm.startPrank(creator);
        engine.createTask{value: 1 ether}("spec", validator, uint64(block.timestamp + engine.MIN_DURATION()));
        engine.createTask{value: 1 ether}("spec", validator, uint64(block.timestamp + engine.MAX_DURATION()));
        vm.stopPrank();
        assertEq(engine.taskCount(), 2);
    }

    // The original H-1 attack: a stranger's junk engagement must not brick escrow.
    function test_JunkSubmissionCannotLockCuratedForever() public {
        uint256 id = _postCurated(_dl());
        vm.prank(attacker);
        engine.submitResult(id, "junk");
        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(creator);
        engine.reclaimExpired(id);
        assertEq(address(engine).balance, 0);
    }

    function test_JunkCommitCannotLockVerifiedForever() public {
        uint256 id = _postPreimage("x", _dl());
        vm.prank(attacker);
        engine.commitAnswer(id, keccak256("junk"));
        vm.warp(block.timestamp + DURATION + engine.REVEAL_GRACE() + 1);
        vm.prank(creator);
        engine.reclaimExpired(id);
        assertEq(address(engine).balance, 0);
    }

    function test_SubmitAfterDeadlineReverts() public {
        uint256 id = _postCurated(_dl());
        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(agentA);
        vm.expectRevert("deadline passed");
        engine.submitResult(id, "late");
    }

    function test_CommitAfterDeadlineReverts() public {
        uint256 id = _postPreimage("x", _dl());
        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(agentA);
        vm.expectRevert("deadline passed");
        engine.commitAnswer(id, keccak256("late"));
    }

    // Creator cannot race a solver who committed in time: reclaim waits out the grace.
    function test_VerifiedReclaimBlockedDuringRevealGrace() public {
        uint256 id = _postPreimage("x", _dl());
        vm.prank(agentA);
        engine.commitAnswer(id, keccak256("c"));
        vm.warp(block.timestamp + DURATION + engine.REVEAL_GRACE()); // at the grace edge
        vm.prank(creator);
        vm.expectRevert("not expired");
        engine.reclaimExpired(id);
    }

    function test_VerifiedLateCommitterCanRevealInGrace() public {
        bytes memory secret = "last-minute";
        uint256 id = _postPreimage(secret, _dl());
        bytes32 salt = keccak256("s");

        vm.warp(block.timestamp + DURATION); // commit at the deadline itself
        vm.prank(agentA);
        engine.commitAnswer(id, _commitment(secret, salt, agentA));

        vm.roll(block.number + 1);
        vm.warp(block.timestamp + engine.REVEAL_GRACE()); // deadline passed, still in grace

        vm.prank(creator);
        vm.expectRevert("not expired");
        engine.reclaimExpired(id);

        uint256 before = agentA.balance;
        vm.prank(agentA);
        engine.revealAndClaim(id, secret, salt);
        assertEq(agentA.balance, before + 1 ether);
    }

    function test_CuratedValidatorCanStillPayAfterDeadline() public {
        uint256 id = _postCurated(_dl());
        vm.prank(agentA);
        engine.submitResult(id, "a");
        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(validator);
        engine.completeTask(id, agentA); // creator hasn't reclaimed yet
        assertEq(engine.getTask(id).winner, agentA);
    }

    // balance invariant across a mixed batch
    function test_InvariantBalanceMatchesOpenEscrow() public {
        _postCurated(_dl()); // 1 ether open
        _postBackdoor(); // 2 ether open
        assertEq(address(engine).balance, 3 ether);
    }
}
