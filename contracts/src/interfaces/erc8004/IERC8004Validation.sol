// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IERC8004Validation
/// @notice Thin adapter over the ERC-8004 Validation Registry.
/// @dev Copied from erc-8004-contracts@b9e466c `contracts/ValidationRegistryUpgradeable.sol`. The upstream repo
///      marks this part of ERC-8004 as still changing; if it does, only this adapter and its callers change.
///      `validationRequest`: agent owner or ERC-721 operator only; a `requestHash` can be used once ("exists").
///      `validationResponse`: the named validator only; may be called repeatedly (I-5).
interface IERC8004Validation {
    event ValidationRequest(
        address indexed validatorAddress, uint256 indexed agentId, string requestURI, bytes32 indexed requestHash
    );
    event ValidationResponse(
        address indexed validatorAddress,
        uint256 indexed agentId,
        bytes32 indexed requestHash,
        uint8 response,
        string responseURI,
        bytes32 responseHash,
        string tag
    );

    function getIdentityRegistry() external view returns (address);

    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external;
    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag
    ) external;

    function getValidationStatus(bytes32 requestHash)
        external
        view
        returns (
            address validatorAddress,
            uint256 agentId,
            uint8 response,
            bytes32 responseHash,
            string memory tag,
            uint256 lastUpdate
        );
    function getSummary(uint256 agentId, address[] calldata validatorAddresses, string calldata tag)
        external
        view
        returns (uint64 count, uint8 avgResponse);
    function getAgentValidations(uint256 agentId) external view returns (bytes32[] memory);
    function getValidatorRequests(address validatorAddress) external view returns (bytes32[] memory);

    function getVersion() external pure returns (string memory);
}
