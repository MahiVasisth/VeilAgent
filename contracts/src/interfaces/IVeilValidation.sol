// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IAssuranceTier} from "./IAssuranceTier.sol";

/// @title IVeilValidation
/// @notice Private validation for ERC-8004 agents. A requester commits on-chain to a salted hash of the
///         validation input, sends the opening sealed to a validator workflow off-chain, and the workflow writes
///         back only pass or fail. Chain observers learn the agent, the policy, the requester and the result,
///         never the input.
/// @dev Commitment encoding, which off-chain tooling must match byte for byte:
///      `commitment = keccak256(abi.encode(uint256 agentId, bytes32 policyId, bytes32 keccak256(input), bytes32 salt))`.
///      Results are written by a CRE workflow through the CRE forwarder (`IReceiver.onReport`).
interface IVeilValidation {
    /// @notice One private validation request and, once recorded, its result.
    /// @param agentId     ERC-8004 Identity Registry agent id.
    /// @param policyId    `keccak256` of the policy name, for example `keccak256("SANCTIONS_SCREEN_V1")`.
    /// @param commitment  Salted commitment to the input (see the contract-level dev note).
    /// @param requester   Address that called `requestPrivate`.
    /// @param requestedAt Block timestamp of the request.
    /// @param expiry      Timestamp after which the result no longer counts. Zero while pending.
    /// @param tier        Tier the validator reported it ran at. Meaningful only once recorded; not enforced.
    /// @param status      Pending, Passed or Failed.
    struct Request {
        uint256 agentId;
        bytes32 policyId;
        bytes32 commitment;
        address requester;
        uint64 requestedAt;
        uint64 expiry;
        IAssuranceTier.Tier tier;
        IAssuranceTier.Status status;
    }

    /// @notice A private validation was requested. The validator workflow triggers on this event.
    event PrivateValidationRequested(
        bytes32 indexed requestId, uint256 indexed agentId, bytes32 indexed policyId, bytes32 commitment
    );

    /// @notice A validator report was accepted and the result stored.
    event PrivateValidationRecorded(
        bytes32 indexed requestId,
        uint256 indexed agentId,
        bytes32 indexed policyId,
        bool passed,
        IAssuranceTier.Tier tier,
        uint64 expiry
    );

    /// @notice The agent-level result for `(agentId, policyId)` now points at `requestId`.
    /// @dev Emitted only when the request's requester controls the agent (see `latestRequest`).
    event LatestRequestUpdated(uint256 indexed agentId, bytes32 indexed policyId, bytes32 indexed requestId);

    /// @notice A recorded result was mirrored into the ERC-8004 Validation Registry.
    event MirroredToERC8004(bytes32 indexed requestId, uint8 response);

    /// @notice Opens a private validation request.
    /// @dev Reverts if the policy is inactive, the agent does not exist, the commitment is zero, or the commitment
    ///      was used before. Anyone may request, for any agent.
    /// @return requestId `keccak256(abi.encode(block.chainid, address(this), nonce))`.
    function requestPrivate(uint256 agentId, bytes32 policyId, bytes32 commitment)
        external
        returns (bytes32 requestId);

    /// @notice True when `requestId` passed under `policyId` and has not expired (`block.timestamp < expiry`).
    function verifyResult(bytes32 requestId, bytes32 policyId) external view returns (bool);

    /// @notice True when the agent's latest result for the policy is an unexpired pass.
    /// @dev Equals `verifyResult(latestRequest(agentId, policyId), policyId)`, so a later fail revokes an earlier pass.
    function isAttested(uint256 agentId, bytes32 policyId) external view returns (bool);

    /// @notice The request behind the agent-level result for `(agentId, policyId)`, or zero.
    /// @dev Only results of requests made by someone who controls the agent when the report lands (its owner, an
    ///      ERC-721 operator, or its verified agent wallet) move this pointer. Third-party requests still get a
    ///      per-request result through `verifyResult`, but they can neither attest nor revoke the agent.
    function latestRequest(uint256 agentId, bytes32 policyId) external view returns (bytes32);

    /// @notice The stored request. All fields are zero for an unknown id.
    function getRequest(bytes32 requestId) external view returns (Request memory);

    /// @notice Copies a recorded result into the ERC-8004 Validation Registry as
    ///         `validationResponse(requestId, 100 or 0, "", 0, "veil8004-private")`.
    /// @dev ERC-8004 requires that the agent's owner or operator first called `validationRequest` naming this
    ///      contract as validator with `requestHash = requestId`. Separate from report processing so a missing
    ///      standard request can never block a report. Callable by anyone, once per request.
    function mirrorToERC8004(bytes32 requestId) external;
}
