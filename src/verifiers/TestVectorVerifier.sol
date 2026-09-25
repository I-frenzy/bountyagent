// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IBountyVerifier} from "../IBountyVerifier.sol";

/**
 * @title TestVectorVerifier
 * @notice Trustless task: "deploy code that implements f(uint256) and matches
 *         the reference implementation — within a gas and size budget."
 *
 *   taskData = abi.encode(Spec)
 *   answer   = abi.encode(address candidate)   // a contract the solver deployed
 *
 * The candidate passes iff, for every fixed input AND for `randomVectors` fresh
 * inputs, calling it with `selector ‖ abi.encode(x)` gives exactly the same
 * success flag and return bytes as the reference, while using at most
 * `gasPerCall` gas per call. This is how a creator buys a *better*
 * implementation (cheaper, smaller) of something they can already specify.
 *
 * Anti-cheating:
 *  - Fresh inputs come from `blockhash(commitBlock + 1)`: they did not exist when
 *    the solver committed, so a hard-coded lookup table can't anticipate them,
 *    and trying again costs a new commit (a transaction and two blocks) rather
 *    than a free simulation.
 *  - The candidate must be *pure*: its bytecode may not contain any opcode that
 *    reads state or the environment (SLOAD, CALL, BLOCKHASH, TIMESTAMP, …), so
 *    its output can depend only on its input. Compile candidates without CBOR
 *    metadata (`cbor_metadata = false`), whose random bytes could otherwise trip
 *    the scan.
 *  - The committed answer is the candidate's *address*, which the solver can
 *    compute before deploying. Commit first, then send the deploy and the reveal
 *    back to back: a copier who sees the deployment can only commit in that
 *    block, and so can't reveal until the next one.
 *
 * Known limit (disclosed): this is property testing. Code that is wrong on a
 * small fraction of inputs might pass a given draw; creators should put edge
 * cases in `fixedInputs` and use many random vectors for valuable bounties.
 */
contract TestVectorVerifier is IBountyVerifier {
    struct Spec {
        address referenceImpl; // source of truth for expected outputs
        bytes4 selector; // function under test, taking one uint256
        uint32 maxCodeSize; // candidate runtime bytecode limit, in bytes
        uint32 gasPerCall; // gas budget per candidate call
        uint8 randomVectors; // fresh inputs derived at reveal time
        uint256 inputBound; // random inputs are taken mod this (0 = full uint256 range)
        uint256[] fixedInputs; // creator-chosen edge cases
    }

    uint256 public constant MAX_VECTORS = 64;
    uint256 public constant MAX_CODE_SIZE = 24_576;
    /// Gas kept back per candidate call, for the caller's own bookkeeping.
    uint256 internal constant GAS_MARGIN = 10_000;

    /// Opcodes a candidate may not contain: anything that reads or writes state,
    /// calls out, or observes the chain environment.
    uint256 internal constant BANNED_OPCODES = (1 << 0x31) // BALANCE
        | (1 << 0x32) // ORIGIN
        | (1 << 0x33) // CALLER
        | (1 << 0x3a) // GASPRICE
        | (1 << 0x3b) // EXTCODESIZE
        | (1 << 0x3c) // EXTCODECOPY
        | (1 << 0x3f) // EXTCODEHASH
        | (1 << 0x40) // BLOCKHASH
        | (1 << 0x41) // COINBASE
        | (1 << 0x42) // TIMESTAMP
        | (1 << 0x43) // NUMBER
        | (1 << 0x44) // PREVRANDAO
        | (1 << 0x45) // GASLIMIT
        | (1 << 0x46) // CHAINID
        | (1 << 0x47) // SELFBALANCE
        | (1 << 0x48) // BASEFEE
        | (1 << 0x49) // BLOBHASH
        | (1 << 0x4a) // BLOBBASEFEE
        | (1 << 0x54) // SLOAD
        | (1 << 0x55) // SSTORE
        | (1 << 0x5a) // GAS
        | (1 << 0x5c) // TLOAD
        | (1 << 0x5d) // TSTORE
        | (1 << 0xa0) | (1 << 0xa1) | (1 << 0xa2) | (1 << 0xa3) | (1 << 0xa4) // LOG0-4
        | (1 << 0xf0) // CREATE
        | (1 << 0xf1) // CALL
        | (1 << 0xf2) // CALLCODE
        | (1 << 0xf4) // DELEGATECALL
        | (1 << 0xf5) // CREATE2
        | (1 << 0xfa) // STATICCALL
        | (1 << 0xff); // SELFDESTRUCT

    error InsufficientGas();
    error SeedUnavailable();

    function verify(bytes calldata taskData, bytes calldata answer, address solver, uint256 commitBlock)
        external
        view
        override
        returns (bool)
    {
        Spec memory s = abi.decode(taskData, (Spec));
        address candidate = abi.decode(answer, (address));

        if (s.fixedInputs.length + s.randomVectors > MAX_VECTORS) return false;
        uint256 size = candidate.code.length;
        if (size == 0 || size > s.maxCodeSize || size > MAX_CODE_SIZE) return false;
        if (!isPure(candidate)) return false;

        for (uint256 i = 0; i < s.fixedInputs.length; i++) {
            if (!_matches(s, candidate, s.fixedInputs[i])) return false;
        }

        if (s.randomVectors > 0) {
            bytes32 seed = _seed(commitBlock, solver, candidate);
            for (uint256 i = 0; i < s.randomVectors; i++) {
                uint256 x = uint256(keccak256(abi.encode(seed, i)));
                if (s.inputBound != 0) x %= s.inputBound;
                if (!_matches(s, candidate, x)) return false;
            }
        }
        return true;
    }

    /// Fresh-input seed: the hash of the block right after the commit. It must
    /// be a past block still inside the 256-block BLOCKHASH window; otherwise
    /// we revert ("no decision") and the solver simply commits again.
    function _seed(uint256 commitBlock, address solver, address candidate) internal view returns (bytes32) {
        uint256 seedBlock = commitBlock + 1;
        if (commitBlock == 0 || block.number <= seedBlock) revert SeedUnavailable();
        bytes32 h = blockhash(seedBlock);
        if (h == bytes32(0)) revert SeedUnavailable();
        return keccak256(abi.encode(h, solver, candidate));
    }

    function _matches(Spec memory s, address candidate, uint256 x) internal view returns (bool) {
        bytes memory data = abi.encodeWithSelector(s.selector, x);
        (bool okRef, bytes memory outRef) = s.referenceImpl.staticcall(data);
        // Never let a starved call count as a mismatch: without enough gas we
        // revert, so a low-gas caller can't turn a correct answer into "false".
        if (gasleft() < (uint256(s.gasPerCall) * 64) / 63 + GAS_MARGIN) revert InsufficientGas();
        (bool okCand, bytes memory outCand) = candidate.staticcall{gas: s.gasPerCall}(data);
        return okRef == okCand && keccak256(outRef) == keccak256(outCand);
    }

    /// @notice True if `target`'s runtime bytecode contains no banned opcode
    ///         (PUSH data is skipped, so constants can't cause false positives).
    function isPure(address target) public view returns (bool ok) {
        bytes memory code = target.code;
        uint256 banned = BANNED_OPCODES;
        ok = true;
        assembly ("memory-safe") {
            let ptr := add(code, 0x20)
            let end := add(ptr, mload(code))
            for {} lt(ptr, end) {} {
                let op := byte(0, mload(ptr))
                switch and(gt(op, 0x5f), lt(op, 0x80))
                case 1 {
                    // PUSH1..PUSH32: skip the opcode and its immediate bytes
                    ptr := add(ptr, sub(op, 0x5e))
                }
                default {
                    if and(shr(op, banned), 1) {
                        ok := 0
                        break
                    }
                    ptr := add(ptr, 1)
                }
            }
        }
    }
}
