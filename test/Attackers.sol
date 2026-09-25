// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BountyEngine} from "../src/BountyEngine.sol";

// ---------------------------------------------------------------------------
// Malicious verifiers — each must leave the escrow safe and reclaimable.
// ---------------------------------------------------------------------------

contract RevertingVerifier {
    function verify(bytes calldata, bytes calldata, address, uint256) external pure returns (bool) {
        revert("nope");
    }
}

/// Burns every unit of gas it is forwarded.
contract GasBurnerVerifier {
    function verify(bytes calldata, bytes calldata, address, uint256) external view returns (bool) {
        uint256 i;
        while (gasleft() > 0) {
            i++;
        }
        return i == 0;
    }
}

/// Returns ~100 KB of return data (all zeros) to make the caller copy it.
contract ReturnBombVerifier {
    function verify(bytes calldata, bytes calldata, address, uint256) external pure returns (bool) {
        assembly {
            return(0, 100000)
        }
    }
}

/// Tries to write storage; fails because the engine calls it via STATICCALL.
contract StateWritingVerifier {
    uint256 public writes;

    function verify(bytes calldata, bytes calldata, address, uint256) external returns (bool) {
        writes++;
        return true;
    }
}

/// Returns a value that is not a valid ABI bool (2).
contract GarbageReturnVerifier {
    function verify(bytes calldata, bytes calldata, address, uint256) external pure returns (bool) {
        assembly {
            mstore(0, 2)
            return(0, 32)
        }
    }
}

// ---------------------------------------------------------------------------
// Malicious recipients.
// ---------------------------------------------------------------------------

/// Owns a cancellable task and tries to cancel it (a call that would succeed
/// on its own) from inside receive() while being paid for another task.
contract ReentrantAgent {
    BountyEngine public immutable engine;
    uint256 public ownTask;
    bool public armed;
    bool public reentryAttempted;
    bool public reentrySucceeded;
    bytes4 public reentryError;

    constructor(BountyEngine e) {
        engine = e;
    }

    function postOwn(uint64 deadline) external payable {
        ownTask = engine.createTask{value: msg.value}("own", address(0), deadline, 1);
    }

    function commit(uint256 id, bytes32 c) external {
        engine.commitAnswer(id, c);
    }

    function arm() external {
        armed = true;
    }

    function reveal(uint256 id, bytes calldata answer, bytes32 salt) external {
        engine.revealAndClaim(id, answer, salt);
    }

    receive() external payable {
        if (!armed) return;
        armed = false;
        reentryAttempted = true;
        try engine.cancelTask(ownTask) {
            reentrySucceeded = true;
        } catch (bytes memory err) {
            reentryError = bytes4(err);
        }
    }
}

/// Refuses all incoming USDC.
contract RejectingAgent {
    BountyEngine public immutable engine;

    constructor(BountyEngine e) {
        engine = e;
    }

    function commit(uint256 id, bytes32 c) external {
        engine.commitAnswer(id, c);
    }

    function reveal(uint256 id, bytes calldata answer, bytes32 salt) external {
        engine.revealAndClaim(id, answer, salt);
    }

    function submit(uint256 id, string calldata r) external {
        engine.submitResult(id, r);
    }

    receive() external payable {
        revert("no thanks");
    }
}
