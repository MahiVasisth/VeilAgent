// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IERC8004Identity
/// @notice Thin adapter over the ERC-8004 Identity Registry.
/// @dev Copied from erc-8004-contracts@b9e466c `contracts/IdentityRegistryUpgradeable.sol`, not from
///      `abis/IdentityRegistry.json`, which lacks `isAuthorizedOrOwner` (docs/phase0.md I-3).
///      Agent ids start at 0 (I-2): check existence with `ownerOf`, which reverts for unknown ids.
interface IERC8004Identity {
    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event MetadataSet(
        uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue
    );
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);

    function register() external returns (uint256 agentId);
    function register(string memory agentURI) external returns (uint256 agentId);
    function register(string memory agentURI, MetadataEntry[] memory metadata) external returns (uint256 agentId);

    function getMetadata(uint256 agentId, string memory metadataKey) external view returns (bytes memory);
    function setMetadata(uint256 agentId, string memory metadataKey, bytes memory metadataValue) external;
    function setAgentURI(uint256 agentId, string calldata newURI) external;

    /// @notice The agent's verified wallet; `address(0)` when unset. Cleared on every NFT transfer (I-4).
    function getAgentWallet(uint256 agentId) external view returns (address);
    function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external;
    function unsetAgentWallet(uint256 agentId) external;

    /// @notice True for the owner or an ERC-721 approved operator. Reverts if the agent does not exist.
    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool);

    // ERC-721 surface used by ERC-8004 permission checks
    function ownerOf(uint256 tokenId) external view returns (address);
    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    function tokenURI(uint256 tokenId) external view returns (string memory);

    function getVersion() external pure returns (string memory);
}
