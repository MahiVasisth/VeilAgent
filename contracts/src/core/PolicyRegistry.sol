// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IAssuranceTier} from "../interfaces/IAssuranceTier.sol";

/// @title PolicyRegistry
/// @notice Named validation policies. `policyId` is `keccak256` of the policy name, e.g.
///         `keccak256("SANCTIONS_SCREEN_V1")`. The creator owns the policy and can switch it on and off.
contract PolicyRegistry {
    struct Policy {
        address owner;
        bytes32 descriptionHash;
        IAssuranceTier.Tier tier;
        uint64 validityWindow; // seconds a result stays valid
        uint256 validatorFee; // recorded, not collected (payments are out of scope)
        bool active;
    }

    mapping(bytes32 policyId => Policy) private _policies;

    event PolicyCreated(
        bytes32 indexed policyId,
        address indexed owner,
        bytes32 descriptionHash,
        IAssuranceTier.Tier tier,
        uint64 validityWindow,
        uint256 validatorFee
    );
    event PolicyActiveSet(bytes32 indexed policyId, bool active);

    error PolicyExists(bytes32 policyId);
    error UnknownPolicy(bytes32 policyId);
    error ZeroPolicyId();
    error ZeroValidityWindow();
    error NotPolicyOwner(bytes32 policyId, address caller);

    function createPolicy(
        bytes32 policyId,
        bytes32 descriptionHash,
        IAssuranceTier.Tier tier,
        uint64 validityWindow,
        uint256 validatorFee
    ) external {
        if (policyId == bytes32(0)) revert ZeroPolicyId();
        if (_policies[policyId].owner != address(0)) revert PolicyExists(policyId);
        if (validityWindow == 0) revert ZeroValidityWindow();
        _policies[policyId] = Policy(msg.sender, descriptionHash, tier, validityWindow, validatorFee, true);
        emit PolicyCreated(policyId, msg.sender, descriptionHash, tier, validityWindow, validatorFee);
    }

    /// @notice Policy owner only.
    function setActive(bytes32 policyId, bool active) external {
        Policy storage p = _policies[policyId];
        if (p.owner == address(0)) revert UnknownPolicy(policyId);
        if (p.owner != msg.sender) revert NotPolicyOwner(policyId, msg.sender);
        p.active = active;
        emit PolicyActiveSet(policyId, active);
    }

    /// @notice Returns an all-zero policy (owner zero, inactive) for an unknown id.
    function getPolicy(bytes32 policyId) external view returns (Policy memory) {
        return _policies[policyId];
    }
}
