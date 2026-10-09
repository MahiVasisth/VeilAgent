// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {ERC8004Deployer} from "./lib/ERC8004Deployer.sol";
import {IAssuranceTier} from "../src/interfaces/IAssuranceTier.sol";
import {IERC8004Identity} from "../src/interfaces/erc8004/IERC8004Identity.sol";
import {IERC8004Validation} from "../src/interfaces/erc8004/IERC8004Validation.sol";
import {PolicyRegistry} from "../src/core/PolicyRegistry.sol";
import {PrivateValidationRegistry} from "../src/core/PrivateValidationRegistry.sol";
import {TreasuryAction} from "../src/consumers/TreasuryAction.sol";
import {MockForwarder} from "../src/mocks/MockForwarder.sol";

/// @notice Deploys the Veil8004 stack and writes `deployments/<chainId>.json`.
///         Phase 1: ERC-8004 registries.
///         - Anvil (31337): Identity, Reputation and Validation are all deployed fresh.
///         - Any other chain: Identity and Reputation come from IDENTITY_REGISTRY / REPUTATION_REGISTRY;
///           Validation comes from VALIDATION_REGISTRY, or is deployed fresh when that is empty (docs/phase0.md Q5).
///         Phase 2: PolicyRegistry (with SANCTIONS_SCREEN_V1), PrivateValidationRegistry, TreasuryAction.
///         - Anvil: reports arrive through a MockForwarder (SIMULATION) whose only transmitter is the local runner
///           (LOCAL_DON_ADDRESS, default Anvil account 8); the registry accepts the fixed local W1 workflow id.
///         - Elsewhere: CRE_FORWARDER_ADDRESS is required; W1_WORKFLOW_ID is pinned if set (it only exists after
///           `cre workflow deploy`, docs/phase0.md C-2), otherwise set it later with setExpectedWorkflowId.
///         Treasury operator: TREASURY_OPERATOR (default Anvil account 7 on Anvil).
/// Usage: forge script script/Deploy.s.sol --rpc-url anvil --broadcast --private-key $DEPLOYER_PRIVATE_KEY
contract Deploy is Script {
    string internal constant ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
    bytes32 internal constant LOCAL_W1_WORKFLOW_ID = keccak256("veil8004.local.w1-validator");

    struct Veil {
        address forwarder;
        bool forwarderIsMock;
        address policyRegistry;
        address privateValidationRegistry;
        address treasuryAction;
        address treasuryOperator;
        bytes32 w1WorkflowId;
    }

    function run() external {
        uint256 startBlock = block.number;
        bool anvil = block.chainid == 31337;
        address identity;
        address reputation;
        address validation;

        vm.startBroadcast();
        if (anvil) {
            identity = ERC8004Deployer.deployIdentity();
            reputation = ERC8004Deployer.deployReputation(identity);
            validation = ERC8004Deployer.deployValidation(identity);
        } else {
            identity = vm.envAddress("IDENTITY_REGISTRY");
            reputation = vm.envAddress("REPUTATION_REGISTRY");
            validation = vm.envOr("VALIDATION_REGISTRY", address(0));
            if (validation == address(0)) validation = ERC8004Deployer.deployValidation(identity);
        }
        Veil memory veil = _deployVeil(anvil, identity, validation);
        vm.stopBroadcast();

        string memory v = "veil";
        vm.serializeAddress(v, "forwarder", veil.forwarder);
        vm.serializeBool(v, "forwarderIsMock", veil.forwarderIsMock);
        vm.serializeAddress(v, "policyRegistry", veil.policyRegistry);
        vm.serializeAddress(v, "privateValidationRegistry", veil.privateValidationRegistry);
        vm.serializeAddress(v, "treasuryAction", veil.treasuryAction);
        vm.serializeAddress(v, "treasuryOperator", veil.treasuryOperator);
        string memory veilJson = vm.serializeBytes32(v, "w1WorkflowId", veil.w1WorkflowId);

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "startBlock", startBlock);
        vm.serializeAddress(key, "identityRegistry", identity);
        vm.serializeAddress(key, "reputationRegistry", reputation);
        vm.serializeAddress(key, "validationRegistry", validation);
        string memory json = vm.serializeString(key, "veil", veilJson);
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);

        console2.log("IdentityRegistry         ", identity);
        console2.log("ReputationRegistry       ", reputation);
        console2.log("ValidationRegistry       ", validation);
        console2.log(veil.forwarderIsMock ? "MockForwarder (SIMULATED)" : "CRE forwarder            ", veil.forwarder);
        console2.log("PolicyRegistry           ", veil.policyRegistry);
        console2.log("PrivateValidationRegistry", veil.privateValidationRegistry);
        console2.log("TreasuryAction           ", veil.treasuryAction);
        console2.log("written to", path);
    }

    function _deployVeil(bool anvil, address identity, address validation) internal returns (Veil memory veil) {
        if (anvil) {
            MockForwarder mock = new MockForwarder();
            mock.setTransmitter(_anvilOr("LOCAL_DON_ADDRESS", 8), true);
            veil.forwarder = address(mock);
            veil.forwarderIsMock = true;
            veil.w1WorkflowId = LOCAL_W1_WORKFLOW_ID;
        } else {
            veil.forwarder = vm.envAddress("CRE_FORWARDER_ADDRESS");
            string memory wid = vm.envOr("W1_WORKFLOW_ID", string(""));
            if (bytes(wid).length != 0) veil.w1WorkflowId = vm.parseBytes32(wid);
        }

        PolicyRegistry policies = new PolicyRegistry();
        policies.createPolicy(
            keccak256("SANCTIONS_SCREEN_V1"),
            keccak256("SANCTIONS_SCREEN_V1: counterparty screened against a sanctions list"),
            IAssuranceTier.Tier.Don,
            uint64(vm.envOr("POLICY_VALIDITY_SECONDS", uint256(3600))),
            0
        );
        PrivateValidationRegistry registry = new PrivateValidationRegistry(
            veil.forwarder, policies, IERC8004Identity(identity), IERC8004Validation(validation)
        );
        if (veil.w1WorkflowId != bytes32(0)) registry.setExpectedWorkflowId(veil.w1WorkflowId);
        else console2.log("WARNING: W1_WORKFLOW_ID unset; call setExpectedWorkflowId after `cre workflow deploy`");

        veil.treasuryOperator = anvil ? _anvilOr("TREASURY_OPERATOR", 7) : vm.envAddress("TREASURY_OPERATOR");
        TreasuryAction treasury = new TreasuryAction(registry, IERC8004Identity(identity), veil.treasuryOperator);

        veil.policyRegistry = address(policies);
        veil.privateValidationRegistry = address(registry);
        veil.treasuryAction = address(treasury);
    }

    function _anvilOr(string memory envName, uint32 index) internal view returns (address) {
        return vm.envOr(envName, vm.addr(vm.deriveKey(ANVIL_MNEMONIC, index)));
    }
}
