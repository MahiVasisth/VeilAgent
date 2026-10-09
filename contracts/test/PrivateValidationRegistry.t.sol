// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ReceiverTemplate} from "@chainlink/cre/ReceiverTemplate.sol";
import {IAssuranceTier} from "../src/interfaces/IAssuranceTier.sol";
import {IVeilValidation} from "../src/interfaces/IVeilValidation.sol";
import {IERC8004Validation} from "../src/interfaces/erc8004/IERC8004Validation.sol";
import {PrivateValidationRegistry} from "../src/core/PrivateValidationRegistry.sol";
import {VeilFixture} from "./utils/VeilFixture.sol";

contract PrivateValidationRegistryTest is VeilFixture {
    string constant INPUT = "Northwind Trading LLC";
    bytes32 constant SALT = keccak256("salt-1");

    // ---- requestPrivate ------------------------------------------------------------------------

    function test_requestPrivate_storesPendingAndEmits() public {
        bytes32 c = commit(agentId, SANCTIONS, INPUT, SALT);
        bytes32 expectedId = keccak256(abi.encode(block.chainid, address(registry), uint256(0)));

        vm.expectEmit(address(registry));
        emit IVeilValidation.PrivateValidationRequested(expectedId, agentId, SANCTIONS, c);
        bytes32 id = request(client, agentId, SANCTIONS, c);
        assertEq(id, expectedId);

        IVeilValidation.Request memory r = registry.getRequest(id);
        assertEq(r.agentId, agentId);
        assertEq(r.policyId, SANCTIONS);
        assertEq(r.commitment, c);
        assertEq(r.requester, client);
        assertEq(r.requestedAt, block.timestamp);
        assertEq(r.expiry, 0);
        assertEq(uint8(r.status), uint8(IAssuranceTier.Status.Pending));
        assertEq(registry.nonce(), 1);
        assertFalse(registry.verifyResult(id, SANCTIONS));
    }

    function test_requestPrivate_inactivePolicyReverts() public {
        vm.prank(policyOwner);
        policies.setActive(SANCTIONS, false);
        vm.expectRevert(abi.encodeWithSelector(PrivateValidationRegistry.PolicyInactive.selector, SANCTIONS));
        registry.requestPrivate(agentId, SANCTIONS, bytes32(uint256(1)));
    }

    function test_requestPrivate_unknownPolicyReverts() public {
        bytes32 unknown = keccak256("NOPE");
        vm.expectRevert(abi.encodeWithSelector(PrivateValidationRegistry.PolicyInactive.selector, unknown));
        registry.requestPrivate(agentId, unknown, bytes32(uint256(1)));
    }

    function test_requestPrivate_unknownAgentReverts() public {
        vm.expectRevert(abi.encodeWithSelector(PrivateValidationRegistry.UnknownAgent.selector, 999));
        registry.requestPrivate(999, SANCTIONS, bytes32(uint256(1)));
    }

    function test_requestPrivate_zeroCommitmentReverts() public {
        vm.expectRevert(PrivateValidationRegistry.ZeroCommitment.selector);
        registry.requestPrivate(agentId, SANCTIONS, bytes32(0));
    }

    function test_requestPrivate_reusedCommitmentReverts() public {
        bytes32 c = commit(agentId, SANCTIONS, INPUT, SALT);
        request(client, agentId, SANCTIONS, c);
        vm.expectRevert(abi.encodeWithSelector(PrivateValidationRegistry.CommitmentUsed.selector, c));
        request(stranger, agentId, SANCTIONS, c);
    }

    // ---- reports: the valid path ------------------------------------------------------------------

    function test_report_validPassIsRecorded() public {
        bytes32 c = commit(agentId, SANCTIONS, INPUT, SALT);
        bytes32 id = request(operator, agentId, SANCTIONS, c);
        uint64 expiry = uint64(block.timestamp + WINDOW);

        vm.expectEmit(address(registry));
        emit IVeilValidation.PrivateValidationRecorded(id, agentId, SANCTIONS, true, IAssuranceTier.Tier.Don, expiry);
        deliver(w1Report(id, c, true, SANCTIONS, expiry));

        IVeilValidation.Request memory r = registry.getRequest(id);
        assertEq(uint8(r.status), uint8(IAssuranceTier.Status.Passed));
        assertEq(uint8(r.tier), uint8(IAssuranceTier.Tier.Don));
        assertEq(r.expiry, expiry);
        assertTrue(registry.verifyResult(id, SANCTIONS));
        assertFalse(registry.verifyResult(id, OTHER_POLICY));
    }

    function test_report_failIsRecordedAndDoesNotVerify() public {
        bytes32 id = recorded(operator, agentId, SANCTIONS, INPUT, SALT, false);
        assertEq(uint8(registry.getRequest(id).status), uint8(IAssuranceTier.Status.Failed));
        assertFalse(registry.verifyResult(id, SANCTIONS));
    }

    function test_report_tierIsRecordedNotEnforced() public {
        bytes32 c = commit(agentId, SANCTIONS, INPUT, SALT);
        bytes32 id = request(operator, agentId, SANCTIONS, c);
        // Policy says Don; the validator claims TeeDon. Recorded as reported.
        deliver(abi.encode(id, c, true, SANCTIONS, uint8(IAssuranceTier.Tier.TeeDon), uint64(block.timestamp + 1)));
        assertEq(uint8(registry.getRequest(id).tier), uint8(IAssuranceTier.Tier.TeeDon));
    }

    function test_report_expiryAtWindowEdgeAccepted() public {
        bytes32 c = commit(agentId, SANCTIONS, INPUT, SALT);
        bytes32 id = request(operator, agentId, SANCTIONS, c);
        deliver(w1Report(id, c, true, SANCTIONS, uint64(block.timestamp + WINDOW)));
        assertTrue(registry.verifyResult(id, SANCTIONS));
    }

    // ---- reports: every rejection -----------------------------------------------------------------

    function test_report_mismatchedCommitmentReverts() public {
        bytes32 c = commit(agentId, SANCTIONS, INPUT, SALT);
        bytes32 id = request(operator, agentId, SANCTIONS, c);
        bytes32 tampered = commit(agentId, SANCTIONS, "Kestrel Shipping Co", SALT);
        vm.expectRevert(abi.encodeWithSelector(PrivateValidationRegistry.CommitmentMismatch.selector, tampered, c));
        deliver(w1Report(id, tampered, true, SANCTIONS, uint64(block.timestamp + 1)));
        assertEq(uint8(registry.getRequest(id).status), uint8(IAssuranceTier.Status.Pending));
    }

    function test_report_wrongPolicyReverts() public {
        bytes32 c = commit(agentId, SANCTIONS, INPUT, SALT);
        bytes32 id = request(operator, agentId, SANCTIONS, c);
        vm.expectRevert(abi.encodeWithSelector(PrivateValidationRegistry.PolicyMismatch.selector, OTHER_POLICY, SANCTIONS));
        deliver(w1Report(id, c, true, OTHER_POLICY, uint64(block.timestamp + 1)));
    }

    function test_report_expiryInPastOrNowReverts() public {
        bytes32 c = commit(agentId, SANCTIONS, INPUT, SALT);
        bytes32 id = request(operator, agentId, SANCTIONS, c);
        vm.expectRevert(
            abi.encodeWithSelector(
                PrivateValidationRegistry.InvalidExpiry.selector, uint64(block.timestamp), block.timestamp + WINDOW
            )
        );
        deliver(w1Report(id, c, true, SANCTIONS, uint64(block.timestamp)));
    }

    function test_report_expiryBeyondWindowReverts() public {
        bytes32 c = commit(agentId, SANCTIONS, INPUT, SALT);
        bytes32 id = request(operator, agentId, SANCTIONS, c);
        uint64 tooLate = uint64(block.timestamp + WINDOW + 1);
        vm.expectRevert(
            abi.encodeWithSelector(PrivateValidationRegistry.InvalidExpiry.selector, tooLate, block.timestamp + WINDOW)
        );
        deliver(w1Report(id, c, true, SANCTIONS, tooLate));
    }

    function test_report_invalidTierReverts() public {
        bytes32 c = commit(agentId, SANCTIONS, INPUT, SALT);
        bytes32 id = request(operator, agentId, SANCTIONS, c);
        vm.expectRevert(abi.encodeWithSelector(PrivateValidationRegistry.InvalidTier.selector, uint8(4)));
        deliver(abi.encode(id, c, true, SANCTIONS, uint8(4), uint64(block.timestamp + 1)));
    }

    function test_report_unknownRequestReverts() public {
        bytes32 id = keccak256("never requested");
        vm.expectRevert(abi.encodeWithSelector(PrivateValidationRegistry.RequestNotPending.selector, id));
        deliver(w1Report(id, bytes32(uint256(1)), true, SANCTIONS, uint64(block.timestamp + 1)));
    }

    function test_report_replayReverts() public {
        bytes32 c = commit(agentId, SANCTIONS, INPUT, SALT);
        bytes32 id = request(operator, agentId, SANCTIONS, c);
        bytes memory report = w1Report(id, c, true, SANCTIONS, uint64(block.timestamp + WINDOW));
        deliver(report);
        vm.expectRevert(abi.encodeWithSelector(PrivateValidationRegistry.RequestNotPending.selector, id));
        deliver(report);
        // A replay that would flip the result is rejected the same way.
        vm.expectRevert(abi.encodeWithSelector(PrivateValidationRegistry.RequestNotPending.selector, id));
        deliver(w1Report(id, c, false, SANCTIONS, uint64(block.timestamp + WINDOW)));
        assertTrue(registry.verifyResult(id, SANCTIONS));
    }

    function test_report_nonForwarderCallerReverts() public {
        bytes32 c = commit(agentId, SANCTIONS, INPUT, SALT);
        bytes32 id = request(operator, agentId, SANCTIONS, c);
        bytes memory metadata = abi.encodePacked(W1_ID, W1_NAME, workflowOwner, bytes2(0x0001));
        vm.expectRevert(
            abi.encodeWithSelector(ReceiverTemplate.InvalidSender.selector, stranger, address(forwarder))
        );
        vm.prank(stranger);
        registry.onReport(metadata, w1Report(id, c, true, SANCTIONS, uint64(block.timestamp + 1)));
    }

    function test_report_wrongWorkflowIdReverts() public {
        bytes32 c = commit(agentId, SANCTIONS, INPUT, SALT);
        bytes32 id = request(operator, agentId, SANCTIONS, c);
        bytes32 otherWorkflow = keccak256("veil8004.local.w3-bid-opener");
        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.InvalidWorkflowId.selector, otherWorkflow, W1_ID));
        vm.prank(transmitter);
        forwarder.deliver(
            address(registry),
            otherWorkflow,
            W1_NAME,
            workflowOwner,
            bytes2(0x0001),
            w1Report(id, c, true, SANCTIONS, uint64(block.timestamp + 1))
        );
    }

    // ---- verifyResult / expiry ----------------------------------------------------------------------

    function test_verifyResult_falseAtAndAfterExpiry() public {
        bytes32 id = recorded(operator, agentId, SANCTIONS, INPUT, SALT, true);
        uint64 expiry = registry.getRequest(id).expiry;
        vm.warp(expiry - 1);
        assertTrue(registry.verifyResult(id, SANCTIONS));
        vm.warp(expiry);
        assertFalse(registry.verifyResult(id, SANCTIONS));
    }

    // ---- latestRequest / isAttested -----------------------------------------------------------------

    function test_isAttested_ownerRequestPassAttests() public {
        bytes32 id = recorded(agentOwner, agentId, SANCTIONS, INPUT, SALT, true);
        assertEq(registry.latestRequest(agentId, SANCTIONS), id);
        assertTrue(registry.isAttested(agentId, SANCTIONS));
        assertFalse(registry.isAttested(agentId, OTHER_POLICY));
        assertFalse(registry.isAttested(otherAgentId, SANCTIONS));
    }

    function test_isAttested_laterFailRevokesEarlierPass() public {
        recorded(agentOwner, agentId, SANCTIONS, INPUT, SALT, true);
        assertTrue(registry.isAttested(agentId, SANCTIONS));
        bytes32 failed = recorded(agentOwner, agentId, SANCTIONS, INPUT, keccak256("salt-2"), false);
        assertEq(registry.latestRequest(agentId, SANCTIONS), failed);
        assertFalse(registry.isAttested(agentId, SANCTIONS));
    }

    function test_isAttested_expires() public {
        recorded(agentOwner, agentId, SANCTIONS, INPUT, SALT, true);
        vm.warp(block.timestamp + WINDOW);
        assertFalse(registry.isAttested(agentId, SANCTIONS));
    }

    function test_isAttested_thirdPartyCannotAttestOrRevoke() public {
        // A stranger's passing request does not attest the agent ...
        bytes32 strangerPass = recorded(stranger, agentId, SANCTIONS, "easy input", SALT, true);
        assertTrue(registry.verifyResult(strangerPass, SANCTIONS)); // per-request result still exists
        assertEq(registry.latestRequest(agentId, SANCTIONS), bytes32(0));
        assertFalse(registry.isAttested(agentId, SANCTIONS));

        // ... and once the owner's pass is in, a stranger's fail does not revoke it.
        bytes32 ownerPass = recorded(agentOwner, agentId, SANCTIONS, INPUT, keccak256("salt-2"), true);
        recorded(stranger, agentId, SANCTIONS, "bad input", keccak256("salt-3"), false);
        assertEq(registry.latestRequest(agentId, SANCTIONS), ownerPass);
        assertTrue(registry.isAttested(agentId, SANCTIONS));
    }

    function test_isAttested_erc721OperatorCounts() public {
        vm.prank(agentOwner);
        IERC721(address(identity)).setApprovalForAll(operator, true);
        bytes32 id = recorded(operator, agentId, SANCTIONS, INPUT, SALT, true);
        assertEq(registry.latestRequest(agentId, SANCTIONS), id);
    }

    function test_isAttested_verifiedAgentWalletCounts() public {
        (address wallet, uint256 walletKey) = makeAddrAndKey("verifiedWallet");
        _setAgentWallet(agentId, agentOwner, wallet, walletKey);
        assertEq(identity.getAgentWallet(agentId), wallet);
        bytes32 id = recorded(wallet, agentId, SANCTIONS, INPUT, SALT, true);
        assertEq(registry.latestRequest(agentId, SANCTIONS), id);
    }

    function test_isAttested_controlIsCheckedWhenTheReportLands() public {
        bytes32 c = commit(agentId, SANCTIONS, INPUT, SALT);
        bytes32 id = request(agentOwner, agentId, SANCTIONS, c);
        // The agent changes hands before the report lands: the old owner's request no longer speaks for it.
        vm.prank(agentOwner);
        IERC721(address(identity)).transferFrom(agentOwner, stranger, agentId);
        deliver(w1Report(id, c, true, SANCTIONS, uint64(block.timestamp + WINDOW)));
        assertTrue(registry.verifyResult(id, SANCTIONS));
        assertFalse(registry.isAttested(agentId, SANCTIONS));
    }

    // ---- ERC-8004 mirror ------------------------------------------------------------------------------

    function test_mirror_writesValidationResponse() public {
        bytes32 id = recorded(operator, agentId, SANCTIONS, INPUT, SALT, true);
        vm.prank(agentOwner);
        validation.validationRequest(address(registry), agentId, "", id);

        vm.expectEmit(address(validation));
        emit IERC8004Validation.ValidationResponse(address(registry), agentId, id, 100, "", bytes32(0), "veil8004-private");
        registry.mirrorToERC8004(id);

        (address v, uint256 a, uint8 response,, string memory tag,) = validation.getValidationStatus(id);
        assertEq(v, address(registry));
        assertEq(a, agentId);
        assertEq(response, 100);
        assertEq(tag, "veil8004-private");
        assertTrue(registry.mirrored(id));
    }

    function test_mirror_failMirrorsZero() public {
        bytes32 id = recorded(operator, agentId, SANCTIONS, INPUT, SALT, false);
        vm.prank(agentOwner);
        validation.validationRequest(address(registry), agentId, "", id);
        registry.mirrorToERC8004(id);
        (,, uint8 response,,,) = validation.getValidationStatus(id);
        assertEq(response, 0);
    }

    function test_mirror_withoutStandardRequestReverts() public {
        bytes32 id = recorded(operator, agentId, SANCTIONS, INPUT, SALT, true);
        vm.expectRevert(); // ERC-8004: unknown requestHash
        registry.mirrorToERC8004(id);
        assertFalse(registry.mirrored(id)); // and the report itself was never blocked
        assertTrue(registry.verifyResult(id, SANCTIONS));
    }

    function test_mirror_pendingReverts() public {
        bytes32 id = request(operator, agentId, SANCTIONS, commit(agentId, SANCTIONS, INPUT, SALT));
        vm.expectRevert(abi.encodeWithSelector(PrivateValidationRegistry.NotRecorded.selector, id));
        registry.mirrorToERC8004(id);
    }

    function test_mirror_onlyOnce() public {
        bytes32 id = recorded(operator, agentId, SANCTIONS, INPUT, SALT, true);
        vm.prank(agentOwner);
        validation.validationRequest(address(registry), agentId, "", id);
        registry.mirrorToERC8004(id);
        vm.expectRevert(abi.encodeWithSelector(PrivateValidationRegistry.AlreadyMirrored.selector, id));
        registry.mirrorToERC8004(id);
    }
}
