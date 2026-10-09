// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {VeilGate} from "../src/core/VeilGate.sol";
import {IVeilGate} from "../src/interfaces/IVeilGate.sol";
import {IVeilValidation} from "../src/interfaces/IVeilValidation.sol";
import {IERC8004Identity} from "../src/interfaces/erc8004/IERC8004Identity.sol";
import {VeilFixture} from "./utils/VeilFixture.sol";

/// @dev Test-only consumer exposing both modifiers. The real agent-level consumer (SealedBidHiring) lands in Phase 3.
contract GateHarness is VeilGate {
    bytes32 public immutable policy;
    uint256 public hits;

    constructor(IVeilValidation r, IERC8004Identity i, bytes32 policy_) VeilGate(r, i) {
        policy = policy_;
    }

    function agentAction(uint256 agentId) external onlyAttested(agentId, policy) {
        hits++;
    }

    function requestAction(bytes32 requestId) external onlyAttestedRequest(requestId, policy) {
        hits++;
    }
}

contract VeilGateTest is VeilFixture {
    GateHarness gate;

    function setUp() public override {
        super.setUp();
        gate = new GateHarness(registry, identity, SANCTIONS);
    }

    function test_immutables() public view {
        assertEq(address(gate.veilRegistry()), address(registry));
        assertEq(address(gate.identityRegistry()), address(identity));
    }

    // ---- onlyAttested ---------------------------------------------------------------------------------

    function test_onlyAttested_ownerWithPassSucceeds() public {
        recorded(agentOwner, agentId, SANCTIONS, "x", keccak256("s"), true);
        vm.prank(agentOwner);
        gate.agentAction(agentId);
        assertEq(gate.hits(), 1);
    }

    function test_onlyAttested_verifiedWalletSucceeds() public {
        (address wallet, uint256 key) = makeAddrAndKey("wallet");
        _setAgentWallet(agentId, agentOwner, wallet, key);
        recorded(agentOwner, agentId, SANCTIONS, "x", keccak256("s"), true);
        vm.prank(wallet);
        gate.agentAction(agentId);
        assertEq(gate.hits(), 1);
    }

    function test_onlyAttested_strangerReverts() public {
        recorded(agentOwner, agentId, SANCTIONS, "x", keccak256("s"), true);
        vm.expectRevert(IVeilGate.NotAgentController.selector);
        vm.prank(stranger);
        gate.agentAction(agentId);
    }

    function test_onlyAttested_erc721OperatorIsNotAController() public {
        // docs/phase0.md I-4: the spec's _controls is owner or verified wallet, not ERC-721 operators.
        recorded(agentOwner, agentId, SANCTIONS, "x", keccak256("s"), true);
        vm.prank(agentOwner);
        IERC721(address(identity)).setApprovalForAll(operator, true);
        vm.expectRevert(IVeilGate.NotAgentController.selector);
        vm.prank(operator);
        gate.agentAction(agentId);
    }

    function test_onlyAttested_unknownAgentReverts() public {
        vm.expectRevert(IVeilGate.NotAgentController.selector);
        gate.agentAction(999);
    }

    function test_onlyAttested_missingResultReverts() public {
        vm.expectRevert(IVeilGate.NotAttested.selector);
        vm.prank(agentOwner);
        gate.agentAction(agentId);
    }

    function test_onlyAttested_pendingResultReverts() public {
        request(agentOwner, agentId, SANCTIONS, commit(agentId, SANCTIONS, "x", keccak256("s")));
        vm.expectRevert(IVeilGate.NotAttested.selector);
        vm.prank(agentOwner);
        gate.agentAction(agentId);
    }

    function test_onlyAttested_failedResultReverts() public {
        recorded(agentOwner, agentId, SANCTIONS, "x", keccak256("s"), false);
        vm.expectRevert(IVeilGate.NotAttested.selector);
        vm.prank(agentOwner);
        gate.agentAction(agentId);
    }

    function test_onlyAttested_expiredResultReverts() public {
        recorded(agentOwner, agentId, SANCTIONS, "x", keccak256("s"), true);
        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(IVeilGate.NotAttested.selector);
        vm.prank(agentOwner);
        gate.agentAction(agentId);
    }

    function test_onlyAttested_wrongPolicyReverts() public {
        recorded(agentOwner, agentId, OTHER_POLICY, "x", keccak256("s"), true);
        vm.expectRevert(IVeilGate.NotAttested.selector);
        vm.prank(agentOwner);
        gate.agentAction(agentId);
    }

    function test_onlyAttested_revokedByLaterFail() public {
        recorded(agentOwner, agentId, SANCTIONS, "x", keccak256("s1"), true);
        recorded(agentOwner, agentId, SANCTIONS, "x", keccak256("s2"), false);
        vm.expectRevert(IVeilGate.NotAttested.selector);
        vm.prank(agentOwner);
        gate.agentAction(agentId);
    }

    // ---- onlyAttestedRequest ------------------------------------------------------------------------------

    function test_onlyAttestedRequest_passSucceeds() public {
        bytes32 id = recorded(client, agentId, SANCTIONS, "x", keccak256("s"), true);
        gate.requestAction(id);
        assertEq(gate.hits(), 1);
    }

    function test_onlyAttestedRequest_rejections() public {
        bytes32 unknown = keccak256("unknown");
        bytes32 pending = request(client, agentId, SANCTIONS, commit(agentId, SANCTIONS, "p", keccak256("s0")));
        bytes32 failed = recorded(client, agentId, SANCTIONS, "x", keccak256("s1"), false);
        bytes32 otherPolicy = recorded(client, agentId, OTHER_POLICY, "x", keccak256("s2"), true);
        bytes32 expiring = recorded(client, agentId, SANCTIONS, "x", keccak256("s3"), true);
        vm.warp(block.timestamp + WINDOW);

        bytes32[5] memory ids = [unknown, pending, failed, otherPolicy, expiring];
        for (uint256 i; i < ids.length; i++) {
            vm.expectRevert(IVeilGate.NotAttested.selector);
            gate.requestAction(ids[i]);
        }
    }
}
