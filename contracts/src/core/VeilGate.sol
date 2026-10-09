// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IVeilGate} from "../interfaces/IVeilGate.sol";
import {IVeilValidation} from "../interfaces/IVeilValidation.sol";
import {IERC8004Identity} from "../interfaces/erc8004/IERC8004Identity.sol";

/// @title VeilGate
/// @notice Base for contracts that gate actions on Veil8004 private validation results. See IVeilGate.
abstract contract VeilGate is IVeilGate {
    IVeilValidation public immutable veilRegistry;
    IERC8004Identity public immutable identityRegistry;

    constructor(IVeilValidation veilRegistry_, IERC8004Identity identityRegistry_) {
        veilRegistry = veilRegistry_;
        identityRegistry = identityRegistry_;
    }

    /// @notice Caller controls `agentId`, and the agent's latest result for `policyId` is an unexpired pass.
    modifier onlyAttested(uint256 agentId, bytes32 policyId) {
        if (!_controls(msg.sender, agentId)) revert NotAgentController();
        if (!veilRegistry.isAttested(agentId, policyId)) revert NotAttested();
        _;
    }

    /// @notice `requestId` passed under `policyId` and is unexpired.
    modifier onlyAttestedRequest(bytes32 requestId, bytes32 policyId) {
        if (!veilRegistry.verifyResult(requestId, policyId)) revert NotAttested();
        _;
    }

    /// @dev The agent's ERC-8004 owner or its verified agent wallet. An ERC-721 operator does not count
    ///      (docs/phase0.md I-4). False for unknown agents.
    function _controls(address account, uint256 agentId) internal view returns (bool) {
        try identityRegistry.ownerOf(agentId) returns (address owner) {
            if (account == owner) return true;
        } catch {
            return false;
        }
        address wallet = identityRegistry.getAgentWallet(agentId);
        return wallet != address(0) && account == wallet;
    }
}
