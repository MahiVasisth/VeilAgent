// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {IERC8004Identity} from "../src/interfaces/erc8004/IERC8004Identity.sol";

/// @notice Registers the demo agents in the ERC-8004 Identity Registry from `deployments/<chainId>.json` and
///         writes `deployments/<chainId>-agents.json`.
///         Each agent is registered by its own owner key, then its URI is set to an on-chain `data:` registration
///         file that includes its `registrations` entry (the agentId is only known after `register`).
///         Owner keys: AGENT_PRIVATE_KEYS (comma-separated), or on Anvil the default mnemonic's accounts 1-3.
/// Usage: forge script script/RegisterAgents.s.sol --rpc-url anvil --broadcast
contract RegisterAgents is Script {
    string internal constant ANVIL_MNEMONIC = "test test test test test test test test test test test junk";

    function run() external {
        string memory root = vm.projectRoot();
        string memory chain = vm.toString(block.chainid);
        string memory deployment = vm.readFile(string.concat(root, "/deployments/", chain, ".json"));
        IERC8004Identity identity = IERC8004Identity(vm.parseJsonAddress(deployment, ".identityRegistry"));

        string[3] memory names = ["Atlas", "Borealis", "Cirrus"];
        uint256[] memory keys = _ownerKeys(names.length);

        uint256[] memory agentIds = new uint256[](names.length);
        address[] memory owners = new address[](names.length);
        for (uint256 i; i < names.length; i++) {
            owners[i] = vm.addr(keys[i]);
            vm.startBroadcast(keys[i]);
            agentIds[i] = identity.register();
            identity.setAgentURI(agentIds[i], _agentURI(names[i], agentIds[i], address(identity)));
            vm.stopBroadcast();
            console2.log("agent", agentIds[i], names[i], owners[i]);
        }

        string memory key = "agents";
        vm.serializeUint(key, "agentIds", agentIds);
        string memory json = vm.serializeAddress(key, "owners", owners);
        vm.writeJson(json, string.concat(root, "/deployments/", chain, "-agents.json"));
    }

    function _ownerKeys(uint256 n) internal view returns (uint256[] memory keys) {
        if (vm.envExists("AGENT_PRIVATE_KEYS")) {
            keys = vm.envUint("AGENT_PRIVATE_KEYS", ",");
            require(keys.length >= n, "AGENT_PRIVATE_KEYS: need one key per agent");
        } else {
            require(block.chainid == 31337, "set AGENT_PRIVATE_KEYS off Anvil");
            keys = new uint256[](n);
            for (uint32 i; i < n; i++) {
                keys[i] = vm.deriveKey(ANVIL_MNEMONIC, i + 1);
            }
        }
    }

    /// @dev ERC-8004 registration-v1 file, base64 `data:` URI (ERC8004SPEC.md, "Agent URI and Agent Registration File").
    function _agentURI(string memory name, uint256 agentId, address identity) internal view returns (string memory) {
        string memory file = string.concat(
            '{"type":"https://eips.ethereum.org/EIPS/eip-8004#registration-v1","name":"',
            name,
            '","description":"Demo compliance-screening agent for Veil8004.","image":"",',
            '"services":[{"name":"web","endpoint":"https://',
            name,
            '.agents.veil8004.invalid/"}],"x402Support":false,"active":true,',
            '"registrations":[{"agentId":',
            vm.toString(agentId),
            ',"agentRegistry":"eip155:',
            vm.toString(block.chainid),
            ":",
            vm.toString(identity),
            '"}],"supportedTrust":["reputation","crypto-economic"]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(file)));
    }
}
