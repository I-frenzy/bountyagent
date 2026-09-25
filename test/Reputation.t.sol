// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, Vm} from "forge-std/Test.sol";
import {BountyEngine} from "../src/BountyEngine.sol";
import {IIdentityRegistry, IReputationRegistry} from "../src/erc8004/IERC8004.sol";
import {PreimageVerifier} from "../src/verifiers/PreimageVerifier.sol";

/// Identity registry stand-in: `owners[id]` owns agent `id`.
contract FakeIdentity is IIdentityRegistry {
    mapping(uint256 => address) public owners;
    mapping(uint256 => address) public wallets;
    bool public burn;
    bool public walletReverts;

    function setWallet(uint256 id, address w) external {
        wallets[id] = w;
    }

    function setWalletReverts(bool r) external {
        walletReverts = r;
    }

    function set(uint256 id, address o) external {
        owners[id] = o;
    }

    function setBurn(bool b) external {
        burn = b;
    }

    function ownerOf(uint256 id) external view returns (address) {
        if (burn) while (true) {}
        require(owners[id] != address(0), "nonexistent");
        return owners[id];
    }

    function getAgentWallet(uint256 id) external view returns (address) {
        require(!walletReverts, "wallet lookup broken");
        return wallets[id];
    }
}

/// Reputation registry stand-in with switchable failure modes.
contract FakeReputation is IReputationRegistry {
    enum Mode {
        Ok,
        Revert,
        BurnGas
    }

    Mode public mode;
    uint256 public calls;
    int128 public lastValue;
    string public lastTag2;

    function setMode(Mode m) external {
        mode = m;
    }

    // public + memory strings: calldata strings take two stack slots each, which
    // is too deep for the unoptimized build `forge coverage` uses.
    function giveFeedback(uint256, int128 value, uint8, string memory, string memory tag2, string memory, string memory, bytes32)
        public
    {
        if (mode == Mode.Revert) revert("registry down");
        if (mode == Mode.BurnGas) while (true) {}
        calls++;
        lastValue = value;
        lastTag2 = tag2;
    }
}

/// F2 failure modes: recording reputation must never block or steal a payout.
contract ReputationTest is Test {
    BountyEngine engine;
    FakeIdentity identity;
    FakeReputation reputation;
    PreimageVerifier preimage;
    address creator = makeAddr("creator");
    address solver = makeAddr("solver");
    bytes constant SECRET = "orbit";

    function setUp() public {
        identity = new FakeIdentity();
        reputation = new FakeReputation();
        engine = new BountyEngine(identity, reputation);
        preimage = new PreimageVerifier();
        vm.deal(creator, 100 ether);
        identity.set(7, solver);
        vm.prank(solver);
        engine.linkAgent(7);
    }

    function _readyToReveal() internal returns (uint256 id, bytes32 salt) {
        vm.prank(creator);
        id = engine.createVerifiedTask{value: 1 ether}(
            "x", address(preimage), abi.encode(keccak256(SECRET)), uint64(block.timestamp + 1 days), 1
        );
        salt = keccak256("s");
        vm.prank(solver);
        engine.commitAnswer(id, keccak256(abi.encode(SECRET, salt, solver)));
        vm.roll(block.number + 1);
    }

    function test_RecordsWinWithUsdcValueAndTag() public {
        (uint256 id, bytes32 salt) = _readyToReveal();
        vm.prank(solver);
        engine.revealAndClaim(id, SECRET, salt);
        assertEq(reputation.calls(), 1);
        assertEq(reputation.lastValue(), 1_000_000);
        assertEq(reputation.lastTag2(), "verified");
    }

    function test_RevertingRegistryDoesNotBlockPayout() public {
        reputation.setMode(FakeReputation.Mode.Revert);
        (uint256 id, bytes32 salt) = _readyToReveal();
        uint256 before = solver.balance;
        vm.prank(solver);
        engine.revealAndClaim(id, SECRET, salt);
        assertEq(solver.balance, before + 1 ether);
        assertEq(reputation.calls(), 0);
    }

    function test_GasBurningRegistryDoesNotBlockPayout() public {
        reputation.setMode(FakeReputation.Mode.BurnGas);
        (uint256 id, bytes32 salt) = _readyToReveal();
        uint256 before = solver.balance;
        vm.prank(solver);
        engine.revealAndClaim{gas: 3_000_000}(id, SECRET, salt);
        assertEq(solver.balance, before + 1 ether);
    }

    function test_GasBurningIdentityDoesNotBlockPayout() public {
        (uint256 id, bytes32 salt) = _readyToReveal();
        identity.setBurn(true);
        uint256 before = solver.balance;
        vm.prank(solver);
        engine.revealAndClaim{gas: 3_000_000}(id, SECRET, salt);
        assertEq(solver.balance, before + 1 ether);
        assertEq(reputation.calls(), 0, "not credited when ownership can't be confirmed");
    }

    // A caller can't starve the reputation call so the win silently goes
    // unrecorded: with too little gas, the whole payout reverts instead.
    function test_StarvedFeedbackRevertsInsteadOfSkipping() public {
        (uint256 id, bytes32 salt) = _readyToReveal();
        vm.prank(solver);
        (bool ok, bytes memory err) =
            address(engine).call{gas: 300_000}(abi.encodeCall(engine.revealAndClaim, (id, SECRET, salt)));
        assertFalse(ok);
        assertEq(bytes4(err), BountyEngine.InsufficientGasForFeedback.selector);
        assertEq(uint256(engine.getTask(id).status), uint256(BountyEngine.Status.Open), "nothing changed");
    }

    function test_CuratedPayoutTaggedCurated() public {
        vm.prank(creator);
        uint256 id = engine.createTask{value: 3 ether}("x", address(0), uint64(block.timestamp + 1 days), 3);
        vm.prank(solver);
        engine.submitResult(id, "done");
        vm.prank(creator);
        engine.completeTask(id, solver);
        assertEq(reputation.lastTag2(), "curated");
        assertEq(reputation.lastValue(), 1_000_000, "one share = 1 USDC");
    }

    function test_UnlinkedWinnersSkipTheRegistry() public {
        vm.prank(solver);
        engine.linkAgent(0);
        (uint256 id, bytes32 salt) = _readyToReveal();
        vm.prank(solver);
        engine.revealAndClaim{gas: 400_000}(id, SECRET, salt); // no feedback budget needed
        assertEq(reputation.calls(), 0);
    }

    function test_LinkRequiresRegistry() public {
        BountyEngine bare = new BountyEngine(IIdentityRegistry(address(0)), IReputationRegistry(address(0)));
        vm.expectRevert(BountyEngine.NoIdentityRegistry.selector);
        bare.linkAgent(7);
    }

    function test_NonOwnerCannotLink() public {
        vm.prank(makeAddr("impostor"));
        vm.expectRevert(BountyEngine.NotAgentOwner.selector);
        engine.linkAgent(7);
    }

    // An agent's registered wallet (not the NFT owner) can link it and is credited.
    function test_AgentWalletCanLinkAndIsCredited() public {
        address hot = makeAddr("agentHotWallet");
        identity.set(9, makeAddr("coldOwner"));
        identity.setWallet(9, hot);
        vm.prank(hot);
        engine.linkAgent(9);
        assertEq(engine.agentIdOf(hot), 9);

        vm.prank(creator);
        uint256 id = engine.createTask{value: 1 ether}("x", address(0), uint64(block.timestamp + 1 days), 1);
        vm.prank(hot);
        engine.submitResult(id, "done");
        vm.prank(creator);
        engine.completeTask(id, hot);
        assertEq(reputation.calls(), 1);
    }

    // A broken wallet lookup counts as "not controlled" — never a revert.
    function test_BrokenWalletLookupIsNotControl() public {
        identity.set(9, makeAddr("someoneElse"));
        identity.setWalletReverts(true);
        vm.prank(solver);
        vm.expectRevert(BountyEngine.NotAgentOwner.selector);
        engine.linkAgent(9);
    }

    function test_RemainingEscrowIsZeroOnceClosed() public {
        (uint256 id, bytes32 salt) = _readyToReveal();
        assertEq(engine.remainingEscrow(id), 1 ether);
        vm.prank(solver);
        engine.revealAndClaim(id, SECRET, salt);
        assertEq(engine.remainingEscrow(id), 0);
    }

    function test_LinkEmitsAndUnlinks() public {
        vm.expectEmit(true, true, false, false, address(engine));
        emit BountyEngine.AgentLinked(solver, 0);
        vm.prank(solver);
        engine.linkAgent(0);
        assertEq(engine.agentIdOf(solver), 0);
    }
}
