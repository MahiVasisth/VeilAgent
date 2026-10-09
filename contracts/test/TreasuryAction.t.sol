// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IVeilGate} from "../src/interfaces/IVeilGate.sol";
import {TreasuryAction} from "../src/consumers/TreasuryAction.sol";
import {VeilFixture} from "./utils/VeilFixture.sol";

contract TreasuryActionTest is VeilFixture {
    string constant INPUT = "Northwind Trading LLC";

    function test_policyConstant() public view {
        assertEq(treasury.SANCTIONS_SCREEN_V1(), keccak256("SANCTIONS_SCREEN_V1"));
        assertEq(treasury.treasuryOperator(), operator);
    }

    function test_execute_validPass() public {
        bytes32 id = recorded(operator, agentId, SANCTIONS, INPUT, keccak256("s"), true);
        vm.expectEmit(address(treasury));
        emit TreasuryAction.ActionExecuted(id);
        vm.prank(stranger); // the action is public: anyone may trigger it once the operator's result passed
        treasury.execute(id);
        assertEq(treasury.actionCount(), 1);
        assertTrue(treasury.executed(id));
    }

    function test_execute_missingResultReverts() public {
        vm.expectRevert(IVeilGate.NotAttested.selector);
        treasury.execute(keccak256("no such request"));
    }

    function test_execute_pendingResultReverts() public {
        bytes32 id = request(operator, agentId, SANCTIONS, commit(agentId, SANCTIONS, INPUT, keccak256("s")));
        vm.expectRevert(IVeilGate.NotAttested.selector);
        treasury.execute(id);
    }

    function test_execute_failedResultReverts() public {
        bytes32 id = recorded(operator, agentId, SANCTIONS, "Kestrel Shipping Co", keccak256("s"), false);
        vm.expectRevert(IVeilGate.NotAttested.selector);
        treasury.execute(id);
    }

    function test_execute_expiredResultReverts() public {
        bytes32 id = recorded(operator, agentId, SANCTIONS, INPUT, keccak256("s"), true);
        vm.warp(registry.getRequest(id).expiry);
        vm.expectRevert(IVeilGate.NotAttested.selector);
        treasury.execute(id);
    }

    function test_execute_wrongPolicyReverts() public {
        bytes32 id = recorded(operator, agentId, OTHER_POLICY, INPUT, keccak256("s"), true);
        vm.expectRevert(IVeilGate.NotAttested.selector);
        treasury.execute(id);
    }

    function test_execute_mismatchedCommitmentNeverUnlocks() public {
        bytes32 c = commit(agentId, SANCTIONS, INPUT, keccak256("s"));
        bytes32 id = request(operator, agentId, SANCTIONS, c);
        bytes32 tampered = commit(agentId, SANCTIONS, "Kestrel Shipping Co", keccak256("s"));
        vm.expectRevert(); // CommitmentMismatch, asserted precisely in PrivateValidationRegistry.t.sol
        deliver(w1Report(id, tampered, true, SANCTIONS, uint64(block.timestamp + WINDOW)));
        vm.expectRevert(IVeilGate.NotAttested.selector);
        treasury.execute(id);
    }

    function test_execute_someoneElsesPassReverts() public {
        bytes32 id = recorded(client, agentId, SANCTIONS, INPUT, keccak256("s"), true);
        vm.expectRevert(abi.encodeWithSelector(TreasuryAction.NotOperatorRequest.selector, client));
        treasury.execute(id);
    }

    function test_execute_onlyOncePerRequest() public {
        bytes32 id = recorded(operator, agentId, SANCTIONS, INPUT, keccak256("s"), true);
        treasury.execute(id);
        vm.expectRevert(abi.encodeWithSelector(TreasuryAction.AlreadyExecuted.selector, id));
        treasury.execute(id);
        assertEq(treasury.actionCount(), 1);
    }
}
