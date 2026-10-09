// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {VeilFixture} from "./utils/VeilFixture.sol";

/// @notice No plaintext input or salt may reach calldata, storage or events (spec: Instructions for the coding agent).
///         Runs the whole Phase 2 flow (request, report, gate, ERC-8004 mirror) under full state-diff and log
///         recording, then byte-scans every call's calldata, every storage write and every log for the secrets.
contract LeakTest is VeilFixture {
    string constant SECRET_INPUT = "Northwind Trading LLC";
    string constant SECRET_INPUT_FAIL = "Kestrel Shipping Co";
    bytes32 constant SECRET_SALT = keccak256("leak-test salt 1");
    bytes32 constant SECRET_SALT_FAIL = keccak256("leak-test salt 2");

    function test_noSecretInCalldataStorageOrEvents() public {
        vm.recordLogs();
        vm.startStateDiffRecording();

        bytes32 passId = recorded(operator, agentId, SANCTIONS, SECRET_INPUT, SECRET_SALT, true);
        bytes32 failId = recorded(agentOwner, agentId, SANCTIONS, SECRET_INPUT_FAIL, SECRET_SALT_FAIL, false);
        treasury.execute(passId);
        vm.startPrank(agentOwner);
        validation.validationRequest(address(registry), agentId, "", passId);
        validation.validationRequest(address(registry), agentId, "", failId);
        vm.stopPrank();
        registry.mirrorToERC8004(passId);
        registry.mirrorToERC8004(failId);

        Vm.AccountAccess[] memory accesses = vm.stopAndReturnStateDiff();
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes memory haystack;
        uint256 calls;
        uint256 writes;
        for (uint256 i; i < accesses.length; i++) {
            haystack = bytes.concat(haystack, accesses[i].data);
            calls++;
            Vm.StorageAccess[] memory s = accesses[i].storageAccesses;
            for (uint256 j; j < s.length; j++) {
                if (!s[j].isWrite) continue;
                haystack = bytes.concat(haystack, s[j].newValue);
                writes++;
            }
        }
        for (uint256 i; i < logs.length; i++) {
            for (uint256 t; t < logs[i].topics.length; t++) {
                haystack = bytes.concat(haystack, logs[i].topics[t]);
            }
            haystack = bytes.concat(haystack, logs[i].data);
        }

        // Sanity: the scan saw the flow, including the commitments it is allowed to see.
        assertGt(calls, 10);
        assertGt(writes, 10);
        assertGt(logs.length, 5);
        assertTrue(_contains(haystack, abi.encode(commit(agentId, SANCTIONS, SECRET_INPUT, SECRET_SALT))));

        bytes[] memory secrets = new bytes[](8);
        secrets[0] = bytes(SECRET_INPUT);
        secrets[1] = bytes(SECRET_INPUT_FAIL);
        secrets[2] = abi.encode(SECRET_SALT);
        secrets[3] = abi.encode(SECRET_SALT_FAIL);
        // The unsalted input hash would allow a dictionary attack, so it must not appear either.
        secrets[4] = abi.encode(keccak256(bytes(SECRET_INPUT)));
        secrets[5] = abi.encode(keccak256(bytes(SECRET_INPUT_FAIL)));
        // Fragments, in case a value were ever split across words.
        secrets[6] = bytes("Northwind");
        secrets[7] = bytes("Kestrel");
        for (uint256 i; i < secrets.length; i++) {
            assertFalse(_contains(haystack, secrets[i]), string.concat("secret leaked: #", vm.toString(i)));
        }
    }

    function test_scannerFindsAPlantedSecret() public pure {
        bytes memory hay = bytes.concat(hex"00112233", bytes("xxNorthwind Trading LLCyy"), hex"44");
        assertTrue(_contains(hay, bytes(SECRET_INPUT)));
        assertFalse(_contains(hay, bytes(SECRET_INPUT_FAIL)));
    }

    function _contains(bytes memory hay, bytes memory needle) internal pure returns (bool) {
        if (needle.length == 0 || needle.length > hay.length) return false;
        for (uint256 i; i + needle.length <= hay.length; i++) {
            if (hay[i] != needle[0]) continue;
            bool ok = true;
            for (uint256 j = 1; j < needle.length; j++) {
                if (hay[i + j] != needle[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }
}
