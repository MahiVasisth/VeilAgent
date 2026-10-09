// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC8004Deployer} from "../script/lib/ERC8004Deployer.sol";
import {IERC8004Identity} from "../src/interfaces/erc8004/IERC8004Identity.sol";
import {IERC8004Reputation} from "../src/interfaces/erc8004/IERC8004Reputation.sol";
import {IERC8004Validation} from "../src/interfaces/erc8004/IERC8004Validation.sol";

/// @notice Phase 1: fresh ERC-8004 registries, called only through our adapter interfaces, and the plain public
///         flow (request -> validation -> feedback). The flow tests show what the baseline puts on-chain in the clear.
contract ERC8004BaselineTest is Test {
    IERC8004Identity identity;
    IERC8004Reputation reputation;
    IERC8004Validation validation;

    address agentOwner = makeAddr("agentOwner");
    address otherOwner = makeAddr("otherOwner");
    address client = makeAddr("client");
    address validator = makeAddr("validator");
    address stranger = makeAddr("stranger");

    uint256 agentId;
    uint256 otherAgentId;

    string constant REQUEST_URI = "data:application/json,{\"policy\":\"SANCTIONS_SCREEN_V1\",\"subject\":\"0xabc\"}";
    string constant RESPONSE_URI = "data:application/json,{\"result\":\"pass\"}";
    string constant FEEDBACK_URI = "data:application/json,{\"proofOfPayment\":{\"txHash\":\"0x01\"}}";
    string constant TAG = "SANCTIONS_SCREEN_V1";

    function setUp() public {
        identity = IERC8004Identity(ERC8004Deployer.deployIdentity());
        reputation = IERC8004Reputation(ERC8004Deployer.deployReputation(address(identity)));
        validation = IERC8004Validation(ERC8004Deployer.deployValidation(address(identity)));

        vm.prank(agentOwner);
        agentId = identity.register("data:application/json,{\"name\":\"Atlas\"}");
        vm.prank(otherOwner);
        otherAgentId = identity.register();
    }

    // ---- deployment -------------------------------------------------------------------------

    function test_deploy_versionsAndWiring() public view {
        assertEq(identity.getVersion(), "2.0.0");
        assertEq(reputation.getVersion(), "2.0.0");
        assertEq(validation.getVersion(), "2.0.0");
        assertEq(reputation.getIdentityRegistry(), address(identity));
        assertEq(validation.getIdentityRegistry(), address(identity));
    }

    function test_register_idsStartAtZeroAndWalletDefaultsToOwner() public view {
        assertEq(agentId, 0); // docs/phase0.md I-2: never treat agentId 0 as "unset"
        assertEq(otherAgentId, 1);
        assertEq(identity.ownerOf(agentId), agentOwner);
        assertEq(identity.getAgentWallet(agentId), agentOwner);
        assertEq(identity.tokenURI(agentId), "data:application/json,{\"name\":\"Atlas\"}");
    }

    function test_register_unknownAgentReverts() public {
        vm.expectRevert();
        identity.ownerOf(99);
    }

    // ---- the public flow ----------------------------------------------------------------------

    function test_publicFlow_everythingIsOnChainInTheClear() public {
        bytes32 requestHash = keccak256(bytes(REQUEST_URI));

        // 1. The agent's owner asks a named validator to validate; the input travels in requestURI.
        vm.expectEmit(address(validation));
        emit IERC8004Validation.ValidationRequest(validator, agentId, REQUEST_URI, requestHash);
        vm.prank(agentOwner);
        validation.validationRequest(validator, agentId, REQUEST_URI, requestHash);

        // 2. The validator answers publicly.
        vm.expectEmit(address(validation));
        emit IERC8004Validation.ValidationResponse(
            validator, agentId, requestHash, 100, RESPONSE_URI, keccak256(bytes(RESPONSE_URI)), TAG
        );
        vm.prank(validator);
        validation.validationResponse(requestHash, 100, RESPONSE_URI, keccak256(bytes(RESPONSE_URI)), TAG);

        (address v, uint256 a, uint8 response,, string memory tag,) = validation.getValidationStatus(requestHash);
        assertEq(v, validator);
        assertEq(a, agentId);
        assertEq(response, 100);
        assertEq(tag, TAG);

        // 3. The client rates the agent from its own wallet: client -> agent -> score is public.
        vm.expectEmit(address(reputation));
        emit IERC8004Reputation.NewFeedback(
            agentId, client, 1, 90, 0, "starred", "starred", "compliance-screening", "", FEEDBACK_URI, bytes32(0)
        );
        vm.prank(client);
        reputation.giveFeedback(agentId, 90, 0, "starred", "compliance-screening", "", FEEDBACK_URI, bytes32(0));

        (int128 value, uint8 decimals, string memory tag1, string memory tag2, bool revoked) =
            reputation.readFeedback(agentId, client, 1);
        assertEq(value, 90);
        assertEq(decimals, 0);
        assertEq(tag1, "starred");
        assertEq(tag2, "compliance-screening");
        assertFalse(revoked);

        address[] memory clients = reputation.getClients(agentId);
        assertEq(clients.length, 1);
        assertEq(clients[0], client);

        (uint64 count, int128 summary,) = reputation.getSummary(agentId, clients, "", "");
        assertEq(count, 1);
        assertEq(summary, 90);

        (uint64 vCount, uint8 avg) = validation.getSummary(agentId, new address[](0), TAG);
        assertEq(vCount, 1);
        assertEq(avg, 100);
    }

    // ---- ERC-8004 call rules (docs/phase0.md Q6) -----------------------------------------------

    function test_validationRequest_onlyOwnerOrOperator() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("Not authorized"));
        validation.validationRequest(validator, agentId, REQUEST_URI, bytes32(uint256(1)));

        // Owner of a different agent is still a stranger to this one.
        vm.prank(otherOwner);
        vm.expectRevert(bytes("Not authorized"));
        validation.validationRequest(validator, agentId, REQUEST_URI, bytes32(uint256(1)));
    }

    function test_validationRequest_hashUsableOnce() public {
        vm.prank(agentOwner);
        validation.validationRequest(validator, agentId, REQUEST_URI, bytes32(uint256(1)));
        vm.prank(agentOwner);
        vm.expectRevert(bytes("exists"));
        validation.validationRequest(validator, agentId, REQUEST_URI, bytes32(uint256(1)));
    }

    function test_validationResponse_onlyNamedValidator() public {
        vm.prank(agentOwner);
        validation.validationRequest(validator, agentId, REQUEST_URI, bytes32(uint256(1)));
        vm.prank(stranger);
        vm.expectRevert(bytes("not validator"));
        validation.validationResponse(bytes32(uint256(1)), 100, "", bytes32(0), TAG);
    }

    function test_giveFeedback_rejectsOwnerAndOperator() public {
        vm.prank(agentOwner);
        vm.expectRevert(bytes("Self-feedback not allowed"));
        reputation.giveFeedback(agentId, 100, 0, "", "", "", "", bytes32(0));

        // ERC-721 operator approval also counts as "self".
        vm.prank(agentOwner);
        (bool ok,) = address(identity).call(abi.encodeWithSignature("setApprovalForAll(address,bool)", stranger, true));
        assertTrue(ok);
        vm.prank(stranger);
        vm.expectRevert(bytes("Self-feedback not allowed"));
        reputation.giveFeedback(agentId, 100, 0, "", "", "", "", bytes32(0));
    }

    function test_getSummary_requiresClientList() public {
        vm.expectRevert(bytes("clientAddresses required"));
        reputation.getSummary(agentId, new address[](0), "", "");
    }
}
