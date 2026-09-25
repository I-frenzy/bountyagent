// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AgenticCommerce} from "../src/erc8183/AgenticCommerce.sol";
import {IERC8183} from "../src/erc8183/IERC8183.sol";
import {VerifierEvaluator} from "../src/erc8183/VerifierEvaluator.sol";
import {PreimageVerifier} from "../src/verifiers/PreimageVerifier.sol";
import {TestVectorVerifier} from "../src/verifiers/TestVectorVerifier.sol";
import {PopcountReference} from "../src/demo/PopcountReference.sol";
import {PopcountFast} from "./TestVectorVerifier.t.sol";
import {CommerceDeployer} from "../script/DeployCommerce.s.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract VerifierEvaluatorTest is Test {
    MockUSDC usdc;
    AgenticCommerce commerce;
    VerifierEvaluator evaluator;
    PreimageVerifier preimage;

    address client = makeAddr("client");
    address provider = makeAddr("provider");
    address stranger = makeAddr("stranger");

    uint256 constant BUDGET = 10e6; // 10 USDC (6 decimals)
    bytes constant SECRET = "orbit";

    function setUp() public {
        usdc = new MockUSDC();
        // Deployed exactly like mainnet: proxy + initialize + renounce all admin roles.
        commerce = AgenticCommerce(CommerceDeployer.deploy(address(usdc), address(this)));
        evaluator = new VerifierEvaluator(IERC8183(address(commerce)));
        preimage = new PreimageVerifier();
        usdc.mint(client, 1_000e6);
        vm.roll(100);
    }

    // --- helpers -----------------------------------------------------------

    function _createJob() internal returns (uint256 jobId) {
        vm.prank(client);
        jobId = commerce.createJob(provider, address(evaluator), block.timestamp + 1 days, "find the preimage", address(0));
    }

    function _configure(uint256 jobId, address verifier, bytes memory taskData) internal {
        vm.prank(client);
        evaluator.configure(jobId, verifier, taskData);
    }

    function _fund(uint256 jobId) internal {
        vm.prank(provider);
        commerce.setBudget(jobId, BUDGET, "");
        vm.startPrank(client);
        usdc.approve(address(commerce), BUDGET);
        commerce.fund(jobId, "");
        vm.stopPrank();
    }

    /// Full happy-path setup up to a submitted job with a committed answer.
    function _readyToSettle(bytes memory answer, bytes32 salt) internal returns (uint256 jobId) {
        jobId = _createJob();
        _configure(jobId, address(preimage), abi.encode(keccak256(SECRET)));
        _fund(jobId);
        bytes32 c = keccak256(abi.encode(answer, salt, provider));
        vm.startPrank(provider);
        evaluator.commit(jobId, c);
        commerce.submit(jobId, c, "");
        vm.stopPrank();
        vm.roll(block.number + 1);
    }

    function _status(uint256 jobId) internal view returns (IERC8183.JobStatus) {
        return IERC8183(address(commerce)).getJob(jobId).status;
    }

    // --- the trustless path -------------------------------------------------

    function test_ValidAnswerCompletesJobAndPaysProvider() public {
        bytes32 salt = keccak256("s");
        uint256 jobId = _readyToSettle(SECRET, salt);

        vm.expectEmit(true, true, false, true, address(commerce));
        emit AgenticCommerce.JobCompleted(jobId, address(evaluator), keccak256(SECRET));
        vm.prank(provider);
        evaluator.settle(jobId, SECRET, salt);

        assertEq(uint256(_status(jobId)), uint256(IERC8183.JobStatus.Completed));
        assertEq(usdc.balanceOf(provider), BUDGET, "provider paid in full (fees are 0)");
        assertEq(usdc.balanceOf(address(commerce)), 0);
        assertEq(usdc.balanceOf(address(evaluator)), 0, "evaluator never holds funds");
    }

    function test_WrongAnswerRevertsAndCanBeFixed() public {
        bytes32 salt = keccak256("s");
        uint256 jobId = _readyToSettle("wrong", salt);

        vm.prank(provider);
        vm.expectRevert(VerifierEvaluator.InvalidAnswer.selector);
        evaluator.settle(jobId, "wrong", salt);
        assertEq(uint256(_status(jobId)), uint256(IERC8183.JobStatus.Submitted), "never rejected");

        vm.prank(provider);
        evaluator.commit(jobId, keccak256(abi.encode(SECRET, salt, provider)));
        vm.roll(block.number + 1);
        vm.prank(provider);
        evaluator.settle(jobId, SECRET, salt);
        assertEq(usdc.balanceOf(provider), BUDGET);
    }

    // Fresh-input verifiers work through the evaluator too: the commit block
    // it records seeds the random test vectors.
    function test_TestVectorVerifierThroughEvaluator() public {
        TestVectorVerifier tv = new TestVectorVerifier();
        PopcountReference ref = new PopcountReference();
        uint256[] memory fixedInputs = new uint256[](2);
        fixedInputs[1] = type(uint256).max;
        TestVectorVerifier.Spec memory s = TestVectorVerifier.Spec({
            referenceImpl: address(ref),
            selector: PopcountReference.popcount.selector,
            maxCodeSize: 2_000,
            gasPerCall: 3_000,
            randomVectors: 16,
            inputBound: 0,
            fixedInputs: fixedInputs
        });

        uint256 jobId = _createJob();
        _configure(jobId, address(tv), abi.encode(s));
        _fund(jobId);

        bytes memory answer = abi.encode(address(new PopcountFast()));
        bytes32 salt = keccak256("s");
        bytes32 c = keccak256(abi.encode(answer, salt, provider));
        vm.startPrank(provider);
        evaluator.commit(jobId, c);
        commerce.submit(jobId, c, "");
        vm.stopPrank();
        uint256 seedBlock = block.number + 1;
        vm.roll(block.number + 2);
        vm.setBlockhash(seedBlock, keccak256("seed"));

        vm.prank(provider);
        evaluator.settle(jobId, answer, salt);
        assertEq(usdc.balanceOf(provider), BUDGET);
    }

    // Starving the verifier of gas yields a revert (no decision), never a
    // completion or rejection.
    function test_LowGasSettleChangesNothing() public {
        bytes32 salt = keccak256("s");
        uint256 jobId = _readyToSettle(SECRET, salt);
        vm.prank(provider);
        (bool ok,) = address(evaluator).call{gas: 40_000}(abi.encodeCall(evaluator.settle, (jobId, SECRET, salt)));
        assertFalse(ok);
        assertEq(uint256(_status(jobId)), uint256(IERC8183.JobStatus.Submitted));
    }

    // --- configure rules ------------------------------------------------------

    function test_OnlyClientConfigures() public {
        uint256 jobId = _createJob();
        vm.prank(stranger);
        vm.expectRevert(VerifierEvaluator.NotClient.selector);
        evaluator.configure(jobId, address(preimage), "");
    }

    function test_ConfigureOnlyWhileOpen() public {
        uint256 jobId = _createJob();
        _fund(jobId);
        vm.prank(client);
        vm.expectRevert(VerifierEvaluator.WrongStatus.selector);
        evaluator.configure(jobId, address(preimage), "");
    }

    function test_ConfigureOnlyOnce() public {
        uint256 jobId = _createJob();
        _configure(jobId, address(preimage), abi.encode(keccak256(SECRET)));
        vm.prank(client);
        vm.expectRevert(VerifierEvaluator.AlreadyConfigured.selector);
        evaluator.configure(jobId, address(preimage), abi.encode(keccak256("other")));
    }

    function test_ConfigureRequiresThisEvaluator() public {
        vm.prank(client);
        uint256 jobId = commerce.createJob(provider, stranger, block.timestamp + 1 days, "x", address(0));
        vm.prank(client);
        vm.expectRevert(VerifierEvaluator.NotEvaluator.selector);
        evaluator.configure(jobId, address(preimage), "");
    }

    function test_ConfigureRequiresContractVerifier() public {
        uint256 jobId = _createJob();
        vm.prank(client);
        vm.expectRevert(VerifierEvaluator.VerifierNotContract.selector);
        evaluator.configure(jobId, stranger, "");
    }

    // --- commit / settle rules ----------------------------------------------

    function test_OnlyProviderCommits() public {
        uint256 jobId = _createJob();
        _configure(jobId, address(preimage), abi.encode(keccak256(SECRET)));
        _fund(jobId);
        vm.prank(stranger);
        vm.expectRevert(VerifierEvaluator.NotProvider.selector);
        evaluator.commit(jobId, keccak256("c"));
    }

    function test_CommitRequiresFundingAndConfig() public {
        uint256 jobId = _createJob();
        vm.prank(provider);
        vm.expectRevert(VerifierEvaluator.WrongStatus.selector);
        evaluator.commit(jobId, keccak256("c")); // still Open

        _fund(jobId);
        vm.prank(provider);
        vm.expectRevert(VerifierEvaluator.NotConfigured.selector);
        evaluator.commit(jobId, keccak256("c"));
    }

    function test_OnlyProviderSettles() public {
        bytes32 salt = keccak256("s");
        uint256 jobId = _readyToSettle(SECRET, salt);
        vm.prank(stranger);
        vm.expectRevert(VerifierEvaluator.NotProvider.selector);
        evaluator.settle(jobId, SECRET, salt);
    }

    function test_SettleRequiresSubmitted() public {
        uint256 jobId = _createJob();
        _configure(jobId, address(preimage), abi.encode(keccak256(SECRET)));
        _fund(jobId);
        bytes32 salt = keccak256("s");
        vm.prank(provider);
        evaluator.commit(jobId, keccak256(abi.encode(SECRET, salt, provider)));
        vm.roll(block.number + 1);
        vm.prank(provider);
        vm.expectRevert(VerifierEvaluator.WrongStatus.selector);
        evaluator.settle(jobId, SECRET, salt);
    }

    function test_SettleSameBlockAsCommitReverts() public {
        uint256 jobId = _createJob();
        _configure(jobId, address(preimage), abi.encode(keccak256(SECRET)));
        _fund(jobId);
        bytes32 salt = keccak256("s");
        bytes32 c = keccak256(abi.encode(SECRET, salt, provider));
        vm.startPrank(provider);
        evaluator.commit(jobId, c);
        commerce.submit(jobId, c, "");
        vm.expectRevert(VerifierEvaluator.RevealTooEarly.selector);
        evaluator.settle(jobId, SECRET, salt);
        vm.stopPrank();
    }

    function test_BadRevealReverts() public {
        uint256 jobId = _readyToSettle(SECRET, keccak256("s"));
        vm.prank(provider);
        vm.expectRevert(VerifierEvaluator.BadReveal.selector);
        evaluator.settle(jobId, SECRET, keccak256("wrong salt"));
    }

    // --- ERC-8183 behaviour we rely on / document ----------------------------

    // After expiry anyone can refund the client — providers must settle first.
    function test_ExpiredJobRefundsClient() public {
        uint256 jobId = _readyToSettle(SECRET, keccak256("s"));
        vm.warp(block.timestamp + 1 days);
        uint256 before = usdc.balanceOf(client);
        vm.prank(stranger);
        commerce.claimRefund(jobId);
        assertEq(usdc.balanceOf(client), before + BUDGET);
    }

    // The provider can change the budget until funding. A client who approves
    // exactly the agreed amount is safe: a raised budget can't be pulled.
    function test_ExactApprovalBlocksBudgetBump() public {
        uint256 jobId = _createJob();
        _configure(jobId, address(preimage), abi.encode(keccak256(SECRET)));
        vm.prank(provider);
        commerce.setBudget(jobId, BUDGET, "");
        vm.prank(client);
        usdc.approve(address(commerce), BUDGET);

        vm.prank(provider);
        commerce.setBudget(jobId, BUDGET * 10, ""); // bumped before the client's fund lands

        vm.prank(client);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, address(commerce), BUDGET, BUDGET * 10
            )
        );
        commerce.fund(jobId, "");
    }

    // --- our mainnet instance has no admin -----------------------------------

    function test_CommerceHasNoAdminAfterDeploy() public {
        assertFalse(commerce.hasRole(commerce.DEFAULT_ADMIN_ROLE(), address(this)));
        assertFalse(commerce.hasRole(commerce.ADMIN_ROLE(), address(this)));
        assertEq(commerce.platformFeeBP(), 0);
        assertEq(commerce.evaluatorFeeBP(), 0);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), commerce.ADMIN_ROLE()
            )
        );
        commerce.setPlatformFee(10_000, address(this));

        address newImpl = address(new AgenticCommerce());
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), commerce.DEFAULT_ADMIN_ROLE()
            )
        );
        commerce.upgradeToAndCall(newImpl, "");
    }
}
