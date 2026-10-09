// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {ERC8004Deployer} from "./lib/ERC8004Deployer.sol";

/// @notice Deploys the Veil8004 stack and writes `deployments/<chainId>.json`.
///         Phase 1: ERC-8004 registries only.
///         - Anvil (31337): Identity, Reputation and Validation are all deployed fresh.
///         - Any other chain: Identity and Reputation come from IDENTITY_REGISTRY / REPUTATION_REGISTRY;
///           Validation comes from VALIDATION_REGISTRY, or is deployed fresh when that is empty (docs/phase0.md Q5).
/// Usage: forge script script/Deploy.s.sol --rpc-url anvil --broadcast --private-key $DEPLOYER_PRIVATE_KEY
contract Deploy is Script {
    function run() external {
        uint256 startBlock = block.number;
        address identity;
        address reputation;
        address validation;

        vm.startBroadcast();
        if (block.chainid == 31337) {
            identity = ERC8004Deployer.deployIdentity();
            reputation = ERC8004Deployer.deployReputation(identity);
            validation = ERC8004Deployer.deployValidation(identity);
        } else {
            identity = vm.envAddress("IDENTITY_REGISTRY");
            reputation = vm.envAddress("REPUTATION_REGISTRY");
            validation = vm.envOr("VALIDATION_REGISTRY", address(0));
            if (validation == address(0)) validation = ERC8004Deployer.deployValidation(identity);
        }
        vm.stopBroadcast();

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "startBlock", startBlock);
        vm.serializeAddress(key, "identityRegistry", identity);
        vm.serializeAddress(key, "reputationRegistry", reputation);
        string memory json = vm.serializeAddress(key, "validationRegistry", validation);
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);

        console2.log("IdentityRegistry  ", identity);
        console2.log("ReputationRegistry", reputation);
        console2.log("ValidationRegistry", validation);
        console2.log("written to", path);
    }
}
