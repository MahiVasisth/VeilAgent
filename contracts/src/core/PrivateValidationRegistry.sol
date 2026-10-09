// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReceiverTemplate} from "@chainlink/cre/ReceiverTemplate.sol";
import {IAssuranceTier} from "../interfaces/IAssuranceTier.sol";
import {IVeilValidation} from "../interfaces/IVeilValidation.sol";
import {IERC8004Identity} from "../interfaces/erc8004/IERC8004Identity.sol";
import {IERC8004Validation} from "../interfaces/erc8004/IERC8004Validation.sol";
import {PolicyRegistry} from "./PolicyRegistry.sol";

/// @title PrivateValidationRegistry
/// @notice Stores salted input commitments and the pass/fail results the W1 validator workflow writes back through
///         the CRE forwarder. See IVeilValidation for the commitment encoding and the result semantics.
/// @dev Report payload (W1): `abi.encode(bytes32 requestId, bytes32 commitment, bool passed, bytes32 policyId,
///      uint8 tier, uint64 expiry)`. Turn on the template's workflow-identity checks after deployment
///      (`setExpectedWorkflowId`) so only W1 can write here.
contract PrivateValidationRegistry is ReceiverTemplate, IVeilValidation {
    string public constant MIRROR_TAG = "veil8004-private";

    PolicyRegistry public immutable policyRegistry;
    IERC8004Identity public immutable identityRegistry;
    IERC8004Validation public immutable validationRegistry;

    uint256 public nonce;
    mapping(bytes32 requestId => Request) private _requests;
    mapping(bytes32 commitment => bool) public commitmentUsed;
    mapping(uint256 agentId => mapping(bytes32 policyId => bytes32 requestId)) public override latestRequest;
    mapping(bytes32 requestId => bool) public mirrored;

    error PolicyInactive(bytes32 policyId);
    error UnknownAgent(uint256 agentId);
    error ZeroCommitment();
    error CommitmentUsed(bytes32 commitment);
    error RequestNotPending(bytes32 requestId);
    error CommitmentMismatch(bytes32 reported, bytes32 stored);
    error PolicyMismatch(bytes32 reported, bytes32 stored);
    error InvalidExpiry(uint64 expiry, uint256 latestAllowed);
    error InvalidTier(uint8 tier);
    error NotRecorded(bytes32 requestId);
    error AlreadyMirrored(bytes32 requestId);

    constructor(
        address forwarder,
        PolicyRegistry policyRegistry_,
        IERC8004Identity identityRegistry_,
        IERC8004Validation validationRegistry_
    ) ReceiverTemplate(forwarder) {
        policyRegistry = policyRegistry_;
        identityRegistry = identityRegistry_;
        validationRegistry = validationRegistry_;
    }

    /// @inheritdoc IVeilValidation
    function requestPrivate(uint256 agentId, bytes32 policyId, bytes32 commitment)
        external
        returns (bytes32 requestId)
    {
        if (!policyRegistry.getPolicy(policyId).active) revert PolicyInactive(policyId);
        // Agent ids start at 0, so existence is checked through ownerOf, which reverts for unknown ids.
        try identityRegistry.ownerOf(agentId) returns (address) {}
        catch {
            revert UnknownAgent(agentId);
        }
        if (commitment == bytes32(0)) revert ZeroCommitment();
        if (commitmentUsed[commitment]) revert CommitmentUsed(commitment);
        commitmentUsed[commitment] = true;

        requestId = keccak256(abi.encode(block.chainid, address(this), nonce++));
        _requests[requestId] = Request({
            agentId: agentId,
            policyId: policyId,
            commitment: commitment,
            requester: msg.sender,
            requestedAt: uint64(block.timestamp),
            expiry: 0,
            tier: IAssuranceTier.Tier.PublicReputation,
            status: IAssuranceTier.Status.Pending
        });
        emit PrivateValidationRequested(requestId, agentId, policyId, commitment);
    }

    /// @dev Decodes and checks a W1 report. Reverts unless the request is pending (the replay guard), the commitment
    ///      and policy match what was stored, and the expiry lies in (now, now + validityWindow].
    function _processReport(bytes calldata report) internal override {
        (bytes32 requestId, bytes32 commitment, bool passed, bytes32 policyId, uint8 tier, uint64 expiry) =
            abi.decode(report, (bytes32, bytes32, bool, bytes32, uint8, uint64));

        Request storage r = _requests[requestId];
        if (r.status != IAssuranceTier.Status.Pending) revert RequestNotPending(requestId);
        if (commitment != r.commitment) revert CommitmentMismatch(commitment, r.commitment);
        if (policyId != r.policyId) revert PolicyMismatch(policyId, r.policyId);
        uint256 latestAllowed = block.timestamp + policyRegistry.getPolicy(policyId).validityWindow;
        if (expiry <= block.timestamp || expiry > latestAllowed) revert InvalidExpiry(expiry, latestAllowed);
        if (tier > uint8(type(IAssuranceTier.Tier).max)) revert InvalidTier(tier);

        r.status = passed ? IAssuranceTier.Status.Passed : IAssuranceTier.Status.Failed;
        r.tier = IAssuranceTier.Tier(tier);
        r.expiry = expiry;

        if (_controlsAgent(r.requester, r.agentId)) {
            latestRequest[r.agentId][policyId] = requestId;
            emit LatestRequestUpdated(r.agentId, policyId, requestId);
        }
        emit PrivateValidationRecorded(requestId, r.agentId, policyId, passed, IAssuranceTier.Tier(tier), expiry);
    }

    /// @inheritdoc IVeilValidation
    function verifyResult(bytes32 requestId, bytes32 policyId) public view returns (bool) {
        Request storage r = _requests[requestId];
        return r.status == IAssuranceTier.Status.Passed && r.policyId == policyId && block.timestamp < r.expiry;
    }

    /// @inheritdoc IVeilValidation
    function isAttested(uint256 agentId, bytes32 policyId) external view returns (bool) {
        return verifyResult(latestRequest[agentId][policyId], policyId);
    }

    /// @inheritdoc IVeilValidation
    function getRequest(bytes32 requestId) external view returns (Request memory) {
        return _requests[requestId];
    }

    /// @inheritdoc IVeilValidation
    function mirrorToERC8004(bytes32 requestId) external {
        IAssuranceTier.Status status = _requests[requestId].status;
        if (status != IAssuranceTier.Status.Passed && status != IAssuranceTier.Status.Failed) {
            revert NotRecorded(requestId);
        }
        if (mirrored[requestId]) revert AlreadyMirrored(requestId);
        mirrored[requestId] = true;
        uint8 response = status == IAssuranceTier.Status.Passed ? 100 : 0;
        validationRegistry.validationResponse(requestId, response, "", bytes32(0), MIRROR_TAG);
        emit MirroredToERC8004(requestId, response);
    }

    /// @dev Owner or ERC-721 operator (ERC-8004's own rule for validationRequest), or the verified agent wallet.
    ///      Never reverts, so a broken identity lookup cannot block a report.
    function _controlsAgent(address account, uint256 agentId) private view returns (bool) {
        try identityRegistry.isAuthorizedOrOwner(account, agentId) returns (bool ok) {
            if (ok) return true;
        } catch {
            return false;
        }
        try identityRegistry.getAgentWallet(agentId) returns (address wallet) {
            return wallet != address(0) && wallet == account;
        } catch {
            return false;
        }
    }
}
