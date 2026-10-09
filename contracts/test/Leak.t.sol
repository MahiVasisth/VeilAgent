// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {VeilFixture} from "./utils/VeilFixture.sol";
import {HiringFixture} from "./utils/HiringFixture.sol";
import {BytesSearch} from "./utils/BytesSearch.sol";

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

/// @notice Phase 3: no losing bid price or salt may reach calldata, storage or events. Runs a whole auction (attest,
///         post, three bids, close, W3 award, inclusion checks, completion) under the same recording as LeakTest. The
///         winner's price and salt are public by design (the report opens the winning commitment) and are not secrets.
contract BidLeakTest is HiringFixture {
    // Distinctive values, so a 32-byte match cannot be a coincidence.
    uint256 constant LOSING_PRICE_1 = 4_217_350_000_000_000_017;
    uint256 constant LOSING_PRICE_2 = 3_904_120_000_000_000_029;
    uint256 constant WINNING_PRICE = 3_100_000_000_000_000_043;
    bytes32 constant LOSING_SALT_1 = keccak256("bid leak salt 1");
    bytes32 constant LOSING_SALT_2 = keccak256("bid leak salt 2");
    bytes32 constant WINNING_SALT = keccak256("bid leak salt w");

    function test_noLosingBidInCalldataStorageOrEvents() public {
        vm.recordLogs();
        vm.startStateDiffRecording();

        uint256 taskId = post();
        bytes32 c0 = placeBid(bidderOwners[0], taskId, bidders[0], LOSING_PRICE_1, LOSING_SALT_1);
        bytes32 c1 = placeBid(bidderOwners[1], taskId, bidders[1], WINNING_PRICE, WINNING_SALT);
        bytes32 c2 = placeBid(bidderOwners[2], taskId, bidders[2], LOSING_PRICE_2, LOSING_SALT_2);
        close(taskId);
        bytes32 l0 = leaf(taskId, bidders[0], c0);
        bytes32 l1 = leaf(taskId, bidders[1], c1);
        bytes32 l2 = leaf(taskId, bidders[2], c2);
        // 3-leaf StandardMerkleTree: the two smallest leaves pair up, then the largest.
        (bytes32 hi, bytes32 a, bytes32 b) = l0 > l1 && l0 > l2 ? (l0, l1, l2) : l1 > l2 ? (l1, l0, l2) : (l2, l0, l1);
        bytes32 root = pairRoot(pairRoot(a, b), hi);
        deliverW3(w3Report(taskId, bidders[1], WINNING_PRICE, WINNING_SALT, 3, root));
        bytes32[] memory proof = new bytes32[](l0 == hi ? 1 : 2);
        if (l0 == hi) {
            proof[0] = pairRoot(a, b);
        } else {
            proof[0] = l0 == a ? b : a;
            proof[1] = hi;
        }
        assertTrue(hiring.verifyInclusion(taskId, bidders[0], proof));
        vm.prank(client);
        hiring.markCompleted(taskId);

        Vm.AccountAccess[] memory accesses = vm.stopAndReturnStateDiff();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes memory haystack;
        for (uint256 i; i < accesses.length; i++) {
            haystack = bytes.concat(haystack, accesses[i].data);
            Vm.StorageAccess[] memory s = accesses[i].storageAccesses;
            for (uint256 j; j < s.length; j++) {
                if (s[j].isWrite) haystack = bytes.concat(haystack, s[j].newValue);
            }
        }
        for (uint256 i; i < logs.length; i++) {
            for (uint256 t; t < logs[i].topics.length; t++) {
                haystack = bytes.concat(haystack, logs[i].topics[t]);
            }
            haystack = bytes.concat(haystack, logs[i].data);
        }

        // Sanity: the scan sees the bid commitments and the (public) winning price.
        assertTrue(BytesSearch.contains(haystack, abi.encode(c0)));
        assertTrue(BytesSearch.contains(haystack, abi.encode(WINNING_PRICE)));

        bytes[] memory secrets = new bytes[](6);
        secrets[0] = abi.encode(LOSING_PRICE_1);
        secrets[1] = abi.encode(LOSING_PRICE_2);
        secrets[2] = abi.encode(LOSING_SALT_1);
        secrets[3] = abi.encode(LOSING_SALT_2);
        // The decimal strings a sealed opening carries, in case one were ever logged or stored.
        secrets[4] = bytes(vm.toString(LOSING_PRICE_1));
        secrets[5] = bytes(vm.toString(LOSING_PRICE_2));
        for (uint256 i; i < secrets.length; i++) {
            assertFalse(BytesSearch.contains(haystack, secrets[i]), string.concat("losing bid leaked: #", vm.toString(i)));
        }
    }
}
