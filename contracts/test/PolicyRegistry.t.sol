// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IAssuranceTier} from "../src/interfaces/IAssuranceTier.sol";
import {PolicyRegistry} from "../src/core/PolicyRegistry.sol";

contract PolicyRegistryTest is Test {
    PolicyRegistry policies;
    bytes32 constant ID = keccak256("SANCTIONS_SCREEN_V1");
    address owner = makeAddr("owner");

    function setUp() public {
        policies = new PolicyRegistry();
    }

    function test_createPolicy_storesFieldsAndIsActive() public {
        vm.expectEmit(address(policies));
        emit PolicyRegistry.PolicyCreated(ID, owner, keccak256("d"), IAssuranceTier.Tier.TeeDon, 3600, 7);
        vm.prank(owner);
        policies.createPolicy(ID, keccak256("d"), IAssuranceTier.Tier.TeeDon, 3600, 7);

        PolicyRegistry.Policy memory p = policies.getPolicy(ID);
        assertEq(p.owner, owner);
        assertEq(p.descriptionHash, keccak256("d"));
        assertEq(uint8(p.tier), uint8(IAssuranceTier.Tier.TeeDon));
        assertEq(p.validityWindow, 3600);
        assertEq(p.validatorFee, 7);
        assertTrue(p.active);
    }

    function test_createPolicy_duplicateReverts() public {
        policies.createPolicy(ID, 0, IAssuranceTier.Tier.Don, 1, 0);
        vm.expectRevert(abi.encodeWithSelector(PolicyRegistry.PolicyExists.selector, ID));
        vm.prank(owner);
        policies.createPolicy(ID, 0, IAssuranceTier.Tier.Don, 1, 0);
    }

    function test_createPolicy_zeroWindowReverts() public {
        vm.expectRevert(PolicyRegistry.ZeroValidityWindow.selector);
        policies.createPolicy(ID, 0, IAssuranceTier.Tier.Don, 0, 0);
    }

    function test_createPolicy_zeroIdReverts() public {
        vm.expectRevert(PolicyRegistry.ZeroPolicyId.selector);
        policies.createPolicy(bytes32(0), 0, IAssuranceTier.Tier.Don, 1, 0);
    }

    function test_setActive_ownerOnly() public {
        vm.prank(owner);
        policies.createPolicy(ID, 0, IAssuranceTier.Tier.Don, 1, 0);

        vm.expectRevert(abi.encodeWithSelector(PolicyRegistry.NotPolicyOwner.selector, ID, address(this)));
        policies.setActive(ID, false);

        vm.prank(owner);
        policies.setActive(ID, false);
        assertFalse(policies.getPolicy(ID).active);
        vm.prank(owner);
        policies.setActive(ID, true);
        assertTrue(policies.getPolicy(ID).active);
    }

    function test_setActive_unknownReverts() public {
        vm.expectRevert(abi.encodeWithSelector(PolicyRegistry.UnknownPolicy.selector, ID));
        policies.setActive(ID, true);
    }

    function test_getPolicy_unknownIsZeroAndInactive() public view {
        PolicyRegistry.Policy memory p = policies.getPolicy(ID);
        assertEq(p.owner, address(0));
        assertFalse(p.active);
    }
}
