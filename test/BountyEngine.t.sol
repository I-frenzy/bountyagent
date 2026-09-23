// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Test} from "forge-std/Test.sol";
import {BountyEngine} from "../src/BountyEngine.sol";

contract BountyEngineTest is Test {
    BountyEngine engine;

    address creator = makeAddr("creator");
    address validator = makeAddr("validator"); // designated validator
    address agentA = makeAddr("agentA");
    address agentB = makeAddr("agentB");

    function setUp() public {
        engine = new BountyEngine();
        vm.deal(creator, 100 ether);
        vm.deal(validator, 1 ether);
        vm.deal(agentA, 1 ether);
        vm.deal(agentB, 1 ether);
    }

    // helper: creator posts a 1 USDC task validated by `validator`
    function _post(uint64 deadline) internal returns (uint256 id) {
        vm.prank(creator);
        id = engine.createTask{value: 1 ether}("audit this contract", validator, deadline);
    }

    function test_OwnerIsDeployer() public {
        assertEq(engine.owner(), address(this));
    }

    function test_CreateLocksEscrow() public {
        uint256 id = _post(0);
        assertEq(id, 1);
        assertEq(engine.taskCount(), 1);
        assertEq(address(engine).balance, 1 ether);

        BountyEngine.Task memory t = engine.getTask(id);
        assertEq(t.creator, creator);
        assertEq(t.validator, validator);
        assertEq(t.reward, 1 ether);
        assertEq(uint256(t.status), uint256(BountyEngine.Status.Open));
    }

    function test_CreateDefaultsValidatorToCreator() public {
        vm.prank(creator);
        uint256 id = engine.createTask{value: 1 ether}("spec", address(0), 0);
        assertEq(engine.getTask(id).validator, creator);
    }

    function test_CreateRevertsOnZeroBounty() public {
        vm.prank(creator);
        vm.expectRevert("no bounty");
        engine.createTask{value: 0}("spec", address(0), 0);
    }

    function test_CreateRevertsOnEmptySpec() public {
        vm.prank(creator);
        vm.expectRevert("empty spec");
        engine.createTask{value: 1 ether}("", address(0), 0);
    }

    function test_CreateRevertsOnPastDeadline() public {
        vm.warp(1000);
        vm.prank(creator);
        vm.expectRevert("deadline in past");
        engine.createTask{value: 1 ether}("spec", address(0), 999);
    }

    function test_SubmitRecordsResult() public {
        uint256 id = _post(0);
        vm.prank(agentA);
        engine.submitResult(id, "ipfs://result-a");

        assertTrue(engine.hasSubmitted(id, agentA));
        assertEq(engine.submissionCount(id), 1);
        BountyEngine.Submission[] memory subs = engine.getSubmissions(id);
        assertEq(subs[0].agent, agentA);
        assertEq(subs[0].resultURI, "ipfs://result-a");
    }

    function test_SubmitOverwriteDoesNotDuplicate() public {
        uint256 id = _post(0);
        vm.startPrank(agentA);
        engine.submitResult(id, "v1");
        engine.submitResult(id, "v2");
        vm.stopPrank();

        assertEq(engine.submissionCount(id), 1);
        assertEq(engine.getSubmissions(id)[0].resultURI, "v2");
    }

    function test_MultipleAgentsCompete() public {
        uint256 id = _post(0);
        vm.prank(agentA);
        engine.submitResult(id, "a");
        vm.prank(agentB);
        engine.submitResult(id, "b");
        assertEq(engine.submissionCount(id), 2);
    }

    function test_CreatorCannotSubmit() public {
        uint256 id = _post(0);
        vm.prank(creator);
        vm.expectRevert("self-submit");
        engine.submitResult(id, "x");
    }

    function test_ValidatorCannotSubmit() public {
        uint256 id = _post(0);
        vm.prank(validator);
        vm.expectRevert("self-submit");
        engine.submitResult(id, "x");
    }

    function test_SubmitRevertsAfterDeadline() public {
        uint256 id = _post(uint64(block.timestamp + 100));
        vm.warp(block.timestamp + 101);
        vm.prank(agentA);
        vm.expectRevert("expired");
        engine.submitResult(id, "late");
    }

    function test_CompletePaysWinner() public {
        uint256 id = _post(0);
        vm.prank(agentA);
        engine.submitResult(id, "a");
        vm.prank(agentB);
        engine.submitResult(id, "b");

        uint256 balBefore = agentB.balance;
        vm.prank(validator);
        engine.completeTask(id, agentB);

        assertEq(agentB.balance, balBefore + 1 ether);
        assertEq(address(engine).balance, 0);

        BountyEngine.Task memory t = engine.getTask(id);
        assertEq(uint256(t.status), uint256(BountyEngine.Status.Completed));
        assertEq(t.winner, agentB);
        assertEq(t.reward, 0);
    }

    function test_OnlyValidatorCanComplete() public {
        uint256 id = _post(0);
        vm.prank(agentA);
        engine.submitResult(id, "a");
        vm.prank(creator); // creator is NOT the validator here
        vm.expectRevert("not validator");
        engine.completeTask(id, agentA);
    }

    function test_CannotCompleteNonSubmitter() public {
        uint256 id = _post(0);
        vm.prank(agentA);
        engine.submitResult(id, "a");
        vm.prank(validator);
        vm.expectRevert("winner never submitted");
        engine.completeTask(id, agentB);
    }

    function test_CannotCompleteTwice() public {
        uint256 id = _post(0);
        vm.prank(agentA);
        engine.submitResult(id, "a");
        vm.startPrank(validator);
        engine.completeTask(id, agentA);
        vm.expectRevert("not open");
        engine.completeTask(id, agentA);
        vm.stopPrank();
    }

    function test_CancelRefundsWhenNoSubmissions() public {
        uint256 id = _post(0);
        uint256 balBefore = creator.balance;
        vm.prank(creator);
        engine.cancelTask(id);

        assertEq(creator.balance, balBefore + 1 ether);
        assertEq(address(engine).balance, 0);
        assertEq(uint256(engine.getTask(id).status), uint256(BountyEngine.Status.Cancelled));
    }

    function test_CannotCancelWithSubmissions() public {
        uint256 id = _post(0);
        vm.prank(agentA);
        engine.submitResult(id, "a");
        vm.prank(creator);
        vm.expectRevert("has submissions");
        engine.cancelTask(id);
    }

    function test_OnlyCreatorCanCancel() public {
        uint256 id = _post(0);
        vm.prank(agentA);
        vm.expectRevert("not creator");
        engine.cancelTask(id);
    }

    function test_ExpiredTaskCreatorReclaims() public {
        uint256 id = _post(uint64(block.timestamp + 100));
        vm.warp(block.timestamp + 200); // past deadline, no submissions
        uint256 balBefore = creator.balance;
        vm.prank(creator);
        engine.cancelTask(id);
        assertEq(creator.balance, balBefore + 1 ether);
    }

    function test_SubmitRevertsOnMissingTask() public {
        vm.prank(agentA);
        vm.expectRevert("no task");
        engine.submitResult(999, "x");
    }

    // full end-to-end machine-commerce cycle across two independent tasks
    function test_EndToEndTwoTasks() public {
        uint256 id1 = _post(0);
        uint256 id2 = _post(0);

        vm.prank(agentA);
        engine.submitResult(id1, "audit-1");
        vm.prank(agentB);
        engine.submitResult(id2, "audit-2");

        vm.prank(validator);
        engine.completeTask(id1, agentA);
        vm.prank(validator);
        engine.completeTask(id2, agentB);

        assertEq(engine.getTask(id1).winner, agentA);
        assertEq(engine.getTask(id2).winner, agentB);
        assertEq(address(engine).balance, 0);
    }
}
