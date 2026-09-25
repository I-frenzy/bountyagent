// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {BountyEngine} from "../src/BountyEngine.sol";
import {IIdentityRegistry, IReputationRegistry} from "../src/erc8004/IERC8004.sol";
import {TestVectorVerifier} from "../src/verifiers/TestVectorVerifier.sol";
import {PopcountReference} from "../src/demo/PopcountReference.sol";

// ---------------------------------------------------------------------------
// Candidate implementations an agent might deploy.
// ---------------------------------------------------------------------------

/// Correct and fast: bit-parallel (SWAR) popcount.
contract PopcountFast {
    function popcount(uint256 x) external pure returns (uint256) {
        unchecked {
            x = x - ((x >> 1) & 0x5555555555555555555555555555555555555555555555555555555555555555);
            x = (x & 0x3333333333333333333333333333333333333333333333333333333333333333)
                + ((x >> 2) & 0x3333333333333333333333333333333333333333333333333333333333333333);
            x = (x + (x >> 4)) & 0x0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f;
            x = (x & 0x00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff)
                + ((x >> 8) & 0x00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff);
            x = (x & 0x0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff)
                + ((x >> 16) & 0x0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff);
            x = (x & 0x00000000ffffffff00000000ffffffff00000000ffffffff00000000ffffffff)
                + ((x >> 32) & 0x00000000ffffffff00000000ffffffff00000000ffffffff00000000ffffffff);
            x = (x & 0x0000000000000000ffffffffffffffff0000000000000000ffffffffffffffff)
                + ((x >> 64) & 0x0000000000000000ffffffffffffffff0000000000000000ffffffffffffffff);
            x = (x & 0x00000000000000000000000000000000ffffffffffffffffffffffffffffffff) + (x >> 128);
        }
        return x;
    }
}

/// Correct but as slow as the reference — blows the gas budget.
contract PopcountSlow {
    function popcount(uint256 x) external pure returns (uint256 n) {
        while (x != 0) {
            n += x & 1;
            x >>= 1;
        }
    }
}

/// Wrong: only counts the lowest byte.
contract PopcountLowByte {
    function popcount(uint256 x) external pure returns (uint256 n) {
        x &= 0xff;
        while (x != 0) {
            n += x & 1;
            x >>= 1;
        }
    }
}

/// Cheater: hard-codes the published fixed vectors, returns 0 otherwise.
contract PopcountLookupCheat {
    function popcount(uint256 x) external pure returns (uint256) {
        if (x == 0) return 0;
        if (x == 1) return 1;
        if (x == type(uint256).max) return 256;
        return 0;
    }
}

/// Cheater: answers from a storage table it can update right before revealing.
contract PopcountStateful {
    mapping(uint256 => uint256) public answers;

    function set(uint256 x, uint256 n) external {
        answers[x] = n;
    }

    function popcount(uint256 x) external view returns (uint256) {
        return answers[x];
    }
}

contract TestVectorVerifierTest is Test {
    BountyEngine engine;
    TestVectorVerifier verifier;
    PopcountReference ref;

    address creator = makeAddr("creator");
    address agent = makeAddr("agent");
    uint32 constant GAS_BUDGET = 3_000;

    function setUp() public {
        engine = new BountyEngine(IIdentityRegistry(address(0)), IReputationRegistry(address(0)));
        verifier = new TestVectorVerifier();
        ref = new PopcountReference();
        vm.deal(creator, 100 ether);
        vm.roll(100);
    }

    function _spec(uint8 randomVectors) internal view returns (TestVectorVerifier.Spec memory s) {
        uint256[] memory fixedInputs = new uint256[](3);
        fixedInputs[0] = 0;
        fixedInputs[1] = 1;
        fixedInputs[2] = type(uint256).max;
        s = TestVectorVerifier.Spec({
            referenceImpl: address(ref),
            selector: PopcountReference.popcount.selector,
            maxCodeSize: 2_000,
            gasPerCall: GAS_BUDGET,
            randomVectors: randomVectors,
            inputBound: 0,
            fixedInputs: fixedInputs
        });
    }

    function _post(TestVectorVerifier.Spec memory s) internal returns (uint256 id) {
        vm.prank(creator);
        id = engine.createVerifiedTask{value: 5 ether}(
            "popcount under 3000 gas", address(verifier), abi.encode(s), uint64(block.timestamp + 1 days), 1);
    }

    /// Commit to `candidate`, then advance two blocks with a known seed hash.
    function _commit(uint256 id, address candidate, bytes32 salt) internal returns (bytes memory answer) {
        answer = abi.encode(candidate);
        vm.prank(agent);
        engine.commitAnswer(id, keccak256(abi.encode(answer, salt, agent)));
        uint256 seedBlock = block.number + 1;
        vm.roll(block.number + 2);
        vm.setBlockhash(seedBlock, keccak256(abi.encode("seed", seedBlock)));
    }

    function _solve(address candidate, uint8 randomVectors) internal returns (bool paid) {
        uint256 id = _post(_spec(randomVectors));
        bytes32 salt = keccak256("salt");
        bytes memory answer = _commit(id, candidate, salt);
        uint256 before = agent.balance;
        vm.prank(agent);
        try engine.revealAndClaim(id, answer, salt) {
            paid = agent.balance == before + 5 ether;
        } catch (bytes memory err) {
            assertEq(bytes4(err), BountyEngine.InvalidAnswer.selector);
        }
    }

    // --- honest solutions ---------------------------------------------------

    function test_FastCorrectImplementationIsPaid() public {
        assertTrue(_solve(address(new PopcountFast()), 32));
    }

    function test_ReferenceExceedsBudgetButFastFits() public {
        // sanity: the reference really is too expensive for the budget
        uint256 g = gasleft();
        ref.popcount(type(uint256).max);
        assertGt(g - gasleft(), GAS_BUDGET);
    }

    // --- rejected solutions -------------------------------------------------

    function test_CorrectButTooSlowIsRejected() public {
        assertFalse(_solve(address(new PopcountSlow()), 8));
    }

    function test_WrongImplementationIsRejected() public {
        assertFalse(_solve(address(new PopcountLowByte()), 8));
    }

    // Passes every published fixed vector; only the fresh inputs catch it.
    function test_LookupTableCheatFailsFreshInputs() public {
        address cheat = address(new PopcountLookupCheat());
        assertTrue(_solve(cheat, 0), "fixed vectors alone are fooled");
        assertFalse(_solve(cheat, 8), "fresh inputs catch it");
    }

    function test_StatefulCandidateFailsPurityScan() public {
        PopcountStateful cheat = new PopcountStateful();
        assertFalse(verifier.isPure(address(cheat)));
        assertFalse(_solve(address(cheat), 8));
    }

    function test_OversizedCandidateIsRejected() public {
        TestVectorVerifier.Spec memory s = _spec(4);
        s.maxCodeSize = 10;
        uint256 id = _post(s);
        bytes32 salt = keccak256("salt");
        bytes memory answer = _commit(id, address(new PopcountFast()), salt);
        vm.prank(agent);
        vm.expectRevert(BountyEngine.InvalidAnswer.selector);
        engine.revealAndClaim(id, answer, salt);
    }

    function test_NonContractCandidateIsRejected() public {
        assertFalse(_solve(makeAddr("eoa"), 4));
    }

    function test_PurityScanAcceptsFastAndReference() public {
        assertTrue(verifier.isPure(address(new PopcountFast())));
        assertTrue(verifier.isPure(address(ref)));
    }

    // --- seed rules ---------------------------------------------------------

    // Revealing one block after the commit is too early: the seed block's hash
    // isn't final yet. The verifier gives no verdict and the escrow is untouched.
    function test_RevealBeforeSeedBlockIsRejected() public {
        uint256 id = _post(_spec(8));
        bytes32 salt = keccak256("salt");
        bytes memory answer = abi.encode(address(new PopcountFast()));
        vm.prank(agent);
        engine.commitAnswer(id, keccak256(abi.encode(answer, salt, agent)));
        vm.roll(block.number + 1);
        vm.prank(agent);
        vm.expectRevert(BountyEngine.InvalidAnswer.selector);
        engine.revealAndClaim(id, answer, salt);
        assertEq(uint256(engine.getTask(id).status), uint256(BountyEngine.Status.Open));
    }

    // After 256 blocks the seed's hash is gone; the solver must commit again.
    function test_StaleSeedIsRejectedThenRecommitWorks() public {
        uint256 id = _post(_spec(8));
        address fast = address(new PopcountFast());
        bytes32 salt = keccak256("salt");
        bytes memory answer = _commit(id, fast, salt);
        vm.roll(block.number + 300);
        vm.prank(agent);
        vm.expectRevert(BountyEngine.InvalidAnswer.selector);
        engine.revealAndClaim(id, answer, salt);

        answer = _commit(id, fast, salt);
        vm.prank(agent);
        engine.revealAndClaim(id, answer, salt);
        assertEq(engine.getTask(id).winner, agent);
    }

    // Different seeds give different inputs: a candidate tuned to one draw
    // doesn't pass another. (Direct call with explicit commit blocks.)
    function test_FreshInputsDependOnSeed() public {
        TestVectorVerifier.Spec memory s = _spec(16);
        bytes memory taskData = abi.encode(s);
        bytes memory answer = abi.encode(address(new PopcountFast()));
        vm.setBlockhash(51, keccak256("a"));
        vm.setBlockhash(61, keccak256("b"));
        assertTrue(verifier.verify(taskData, answer, agent, 50));
        assertTrue(verifier.verify(taskData, answer, agent, 60));
        assertFalse(verifier.verify(taskData, abi.encode(address(new PopcountLowByte())), agent, 50));
    }

    // A caller who starves the verifier of gas gets a revert, never a "false"
    // verdict — so gas griefing can't make a correct answer look wrong.
    function test_LowGasRevertsInsteadOfFalse() public {
        bytes memory taskData = abi.encode(_spec(4));
        bytes memory answer = abi.encode(address(new PopcountFast()));
        vm.setBlockhash(51, keccak256("a"));
        (bool ok, bytes memory ret) = address(verifier).staticcall{gas: 60_000}(
            abi.encodeCall(verifier.verify, (taskData, answer, agent, 50))
        );
        if (ok) assertTrue(abi.decode(ret, (bool)), "if it finished, it must say true");
    }

    // Bounded random inputs (e.g. "x < 2^16") still verify correctly, and the
    // low-byte implementation — wrong above 255 — is caught.
    function test_BoundedRandomInputs() public {
        TestVectorVerifier.Spec memory s = _spec(32);
        s.inputBound = 1 << 16;
        vm.setBlockhash(51, keccak256("a"));
        assertTrue(verifier.verify(abi.encode(s), abi.encode(address(new PopcountFast())), agent, 50));
        assertFalse(verifier.verify(abi.encode(s), abi.encode(address(new PopcountLowByte())), agent, 50));
    }

    function test_TooManyVectorsIsRejected() public {
        TestVectorVerifier.Spec memory s = _spec(64); // 64 random + 3 fixed > MAX_VECTORS
        vm.setBlockhash(51, keccak256("a"));
        assertFalse(verifier.verify(abi.encode(s), abi.encode(address(new PopcountFast())), agent, 50));
    }

    // The demo's honest solution really is equivalent to the reference.
    function testFuzz_FastMatchesReference(uint256 x) public {
        PopcountFast fast = new PopcountFast();
        assertEq(fast.popcount(x), ref.popcount(x));
    }
}
