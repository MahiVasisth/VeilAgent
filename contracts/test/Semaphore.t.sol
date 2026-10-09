// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {SemaphoreDeployer} from "../script/lib/SemaphoreDeployer.sol";
import {Semaphore} from "@semaphore-protocol/contracts/Semaphore.sol";
import {SemaphoreVerifier} from "@semaphore-protocol/contracts/base/SemaphoreVerifier.sol";
import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {ISemaphoreVerifier} from "@semaphore-protocol/contracts/interfaces/ISemaphoreVerifier.sol";

/// @notice Our own Semaphore V4 deployment (docs/phase0.md Q7) against test/vectors/semaphore.json, which the SDK wrote
///         with real proofs (scripts/src/gen-semaphore-vectors.ts).
///         - TypeScript and Solidity LeanIMT agree: each group rebuilt on-chain has the vector's root.
///         - Every pinned zkey (depths 1 to 4) matches SemaphoreVerifier: one proof per depth verifies.
///         - S-1: a replaced root stops verifying after merkleTreeDuration; createGroup() fixes that at 1 hour.
///         - S-2: nullifiers are per group, so one identity can rate the same (agent, epoch) once in each of two groups.
///         - S-6: validateProof reverts (does not return false) on a reused nullifier or an invalid proof.
contract SemaphoreTest is Test {
    uint256 internal constant DURATION = 2 hours;

    Semaphore internal semaphore;
    string internal json;
    uint256[] internal commitments;

    function setUp() public {
        // The same path as script/Deploy.s.sol: canonical PoseidonT3, Semaphore linked to it by hand.
        semaphore = Semaphore(SemaphoreDeployer.deploySemaphore(ISemaphoreVerifier(address(new SemaphoreVerifier()))));
        json = vm.readFile(string.concat(vm.projectRoot(), "/test/vectors/semaphore.json"));
        string[] memory ids = vm.parseJsonStringArray(json, ".identityCommitments");
        for (uint256 i; i < ids.length; i++) commitments.push(vm.parseUint(ids[i]));
    }

    function test_rootsMatchAndOneProofPerDepthVerifies() public {
        for (uint256 c; c < 4; c++) {
            (uint256 groupId, ISemaphore.SemaphoreProof memory proof) = _groupFor(c);
            assertEq(proof.merkleTreeDepth, c + 1, "case depth");
            assertEq(semaphore.getMerkleTreeRoot(groupId), _uint(c, ".root"), "TypeScript and Solidity roots differ");
            assertEq(proof.merkleTreeRoot, semaphore.getMerkleTreeRoot(groupId), "proof is for the current root");
            assertEq(proof.scope, vm.parseUint(vm.parseJsonString(json, ".scope")), "scope");
            assertTrue(semaphore.verifyProof(groupId, proof), "proof does not verify");
            semaphore.validateProof(groupId, proof);
            vm.expectRevert(ISemaphore.Semaphore__YouAreUsingTheSameNullifierTwice.selector);
            semaphore.validateProof(groupId, proof);
        }
    }

    /// S-8: the canonical PoseidonT3 is what Semaphore calls, and it computes circomlib's Poseidon.
    function test_S8_canonicalPoseidonT3() public view {
        bytes memory linked = SemaphoreDeployer.linkedSemaphoreCode();
        assertGt(_count(linked, SemaphoreDeployer.POSEIDON_T3), 0, "Semaphore is linked to the canonical PoseidonT3");
        assertGt(SemaphoreDeployer.POSEIDON_T3.code.length, 0);
        assertLe(SemaphoreDeployer.POSEIDON_T3.code.length, 24_576, "fits EIP-170");
        // poseidon([1, 2]) from circomlibjs.
        (bool ok, bytes memory out) = SemaphoreDeployer.POSEIDON_T3.staticcall(
            abi.encodeWithSignature("hash(uint256[2])", [uint256(1), uint256(2)])
        );
        assertTrue(ok);
        assertEq(abi.decode(out, (uint256)), 0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a);
    }

    function test_scopeIsAbiEncodedAgentAndEpoch() public view {
        uint256 agentId = vm.parseUint(vm.parseJsonString(json, ".agentId"));
        uint64 epoch = uint64(vm.parseUint(vm.parseJsonString(json, ".epoch")));
        assertEq(uint256(keccak256(abi.encode(agentId, epoch))), vm.parseUint(vm.parseJsonString(json, ".scope")));
    }

    function test_tamperedProofIsRejected() public {
        (uint256 groupId,) = _groupFor(1);
        ISemaphore.SemaphoreProof memory p = _proof(1); // memory structs alias: take a fresh copy per case

        p.message = 5; // another score
        vm.expectRevert(ISemaphore.Semaphore__InvalidProof.selector);
        semaphore.validateProof(groupId, p);

        p = _proof(1);
        p.scope = uint256(keccak256(abi.encode(uint256(2), uint64(488_000)))); // another agent
        vm.expectRevert(ISemaphore.Semaphore__InvalidProof.selector);
        semaphore.validateProof(groupId, p);

        p = _proof(1);
        p.nullifier += 1;
        vm.expectRevert(ISemaphore.Semaphore__InvalidProof.selector);
        semaphore.validateProof(groupId, p);

        p = _proof(1);
        p.points[0] += 1;
        vm.expectRevert();
        semaphore.validateProof(groupId, p);

        semaphore.validateProof(groupId, _proof(1)); // the untouched proof still verifies
    }

    function test_proofForAnotherGroupIsRejected() public {
        (, ISemaphore.SemaphoreProof memory proof) = _groupFor(0); // members {0, 1}
        (uint256 other,) = _groupFor(1); // members {0, 1, 2}
        vm.expectRevert(ISemaphore.Semaphore__MerkleTreeRootIsNotPartOfTheGroup.selector);
        semaphore.validateProof(other, proof);
    }

    /// S-1: a proof built against a root that has since been replaced verifies within merkleTreeDuration, not after.
    function test_S1_replacedRootExpiresAfterDuration() public {
        (uint256 groupId, ISemaphore.SemaphoreProof memory proof) = _groupFor(0);
        semaphore.addMember(groupId, commitments[8]); // a new receipt lands: the root changes
        assertTrue(semaphore.getMerkleTreeRoot(groupId) != proof.merkleTreeRoot);

        uint256 snap = vm.snapshotState();
        vm.warp(block.timestamp + DURATION);
        semaphore.validateProof(groupId, proof);
        vm.revertToState(snap);

        vm.warp(block.timestamp + DURATION + 1);
        vm.expectRevert(ISemaphore.Semaphore__MerkleTreeRootIsExpired.selector);
        semaphore.validateProof(groupId, proof);
    }

    function test_S1_createGroupWithoutDurationFixesOneHour() public {
        uint256 groupId = semaphore.createGroup();
        assertEq(semaphore.groups(groupId), 1 hours);
        uint256 ours = semaphore.createGroup(address(this), DURATION);
        assertEq(semaphore.groups(ours), DURATION);
    }

    /// S-2: the nullifier depends only on the identity and the scope, and Semaphore stores it per group. This is why
    ///      AnonymousFeedback also consumes it in NullifierRegistry under (agentId, epoch).
    function test_S2_sameIdentitySameScopeTwoGroupsBothAccepted() public {
        (uint256 a, ISemaphore.SemaphoreProof memory pa) = _groupFor(4); // identity 0 in {0, 2}
        (uint256 b, ISemaphore.SemaphoreProof memory pb) = _groupFor(5); // identity 0 in {0, 1}
        assertEq(pa.nullifier, pb.nullifier, "same identity and scope give the same nullifier");
        semaphore.validateProof(a, pa);
        semaphore.validateProof(b, pb);
    }

    // ---- helpers ----------------------------------------------------------------------------------

    function _count(bytes memory code, address a) internal pure returns (uint256 n) {
        bytes20 needle = bytes20(a);
        for (uint256 i; i + 20 <= code.length; i++) {
            bytes20 w;
            assembly {
                w := mload(add(add(code, 0x20), i))
            }
            if (w == needle) n++;
        }
    }

    function _groupFor(uint256 c) internal returns (uint256 groupId, ISemaphore.SemaphoreProof memory proof) {
        groupId = semaphore.createGroup(address(this), DURATION);
        uint256[] memory idx = vm.parseJsonUintArray(json, _path(c, ".members"));
        uint256[] memory members = new uint256[](idx.length);
        for (uint256 i; i < idx.length; i++) members[i] = commitments[idx[i]];
        semaphore.addMembers(groupId, members);
        proof = _proof(c);
    }

    function _proof(uint256 c) internal view returns (ISemaphore.SemaphoreProof memory p) {
        p.merkleTreeDepth = vm.parseJsonUint(json, _path(c, ".proof.merkleTreeDepth"));
        p.merkleTreeRoot = _uint(c, ".proof.merkleTreeRoot");
        p.nullifier = _uint(c, ".proof.nullifier");
        p.message = _uint(c, ".proof.message");
        p.scope = _uint(c, ".proof.scope");
        string[] memory points = vm.parseJsonStringArray(json, _path(c, ".proof.points"));
        for (uint256 i; i < 8; i++) p.points[i] = vm.parseUint(points[i]);
    }

    function _uint(uint256 c, string memory key) internal view returns (uint256) {
        return vm.parseUint(vm.parseJsonString(json, _path(c, key)));
    }

    function _path(uint256 c, string memory key) internal pure returns (string memory) {
        return string.concat(".cases[", vm.toString(c), "]", key);
    }
}
