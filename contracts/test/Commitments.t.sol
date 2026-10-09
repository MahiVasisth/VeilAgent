// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {VeilFixture} from "./utils/VeilFixture.sol";

/// @notice Cross-language check: the Solidity commitment encoding (the one every test here uses) must reproduce
///         test/vectors/commitments.json, which was generated with `cast` and is also checked by the TypeScript SDK
///         (sdk/src/commitments.test.ts). If both match the file, they match each other byte for byte.
contract CommitmentsTest is VeilFixture {
    function test_inputCommitmentMatchesVectors() public view {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/test/vectors/commitments.json"));
        uint256 n;
        while (vm.keyExistsJson(json, string.concat(".vectors[", vm.toString(n), "]"))) n++;
        assertEq(n, 4, "expected 4 vectors");

        for (uint256 i; i < n; i++) {
            string memory p = string.concat(".vectors[", vm.toString(i), "]");
            uint256 agent = vm.parseUint(vm.parseJsonString(json, string.concat(p, ".agentId")));
            string memory policyName = vm.parseJsonString(json, string.concat(p, ".policyName"));
            string memory input = vm.parseJsonString(json, string.concat(p, ".input"));
            bytes32 salt = vm.parseJsonBytes32(json, string.concat(p, ".salt"));

            bytes32 policyId = keccak256(bytes(policyName));
            assertEq(policyId, vm.parseJsonBytes32(json, string.concat(p, ".policyId")), "policyId");
            assertEq(keccak256(bytes(input)), vm.parseJsonBytes32(json, string.concat(p, ".inputHash")), "inputHash");
            assertEq(commit(agent, policyId, input, salt), vm.parseJsonBytes32(json, string.concat(p, ".commitment")));
        }
    }
}
