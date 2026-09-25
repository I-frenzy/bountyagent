// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * @notice The parts of the ERC-8004 (Trustless Agents) registries BountyEngine
 *         uses. Matches erc-8004/erc-8004-contracts v2.0.0, deployed on Arc
 *         mainnet at 0x8004A169…a432 (Identity) and 0x8004BAa1…9b63 (Reputation)
 *         and on Arc testnet at 0x8004A818…BD9e / 0x8004B663…8713.
 */
interface IIdentityRegistry {
    function ownerOf(uint256 agentId) external view returns (address);

    function getAgentWallet(uint256 agentId) external view returns (address);
}

interface IReputationRegistry {
    /// Reverts for self-feedback (caller owns/operates the agent) and for
    /// agents that don't exist.
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
}
