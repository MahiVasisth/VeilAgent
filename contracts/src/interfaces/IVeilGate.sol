// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IVeilValidation} from "./IVeilValidation.sol";
import {IERC8004Identity} from "./erc8004/IERC8004Identity.sol";

/// @title IVeilGate
/// @notice What a consumer contract exposes when it gates actions on Veil8004 private validation results.
/// @dev Consumers inherit `VeilGate`, which offers two modifiers:
///      - `onlyAttested(agentId, policyId)`: the caller controls `agentId` (its ERC-8004 owner or verified agent
///        wallet) and the agent's latest result for the policy is an unexpired pass. For agent-level policies.
///      - `onlyAttestedRequest(requestId, policyId)`: that specific request passed under the policy and is
///        unexpired. For per-request policies; the consumer must also check who made the request.
interface IVeilGate {
    /// @notice The caller is neither the agent's owner nor its verified agent wallet.
    error NotAgentController();
    /// @notice The required result is missing, failed, expired or under another policy.
    error NotAttested();

    /// @notice The private validation registry this gate reads.
    function veilRegistry() external view returns (IVeilValidation);

    /// @notice The ERC-8004 Identity Registry used for agent control checks.
    function identityRegistry() external view returns (IERC8004Identity);
}
