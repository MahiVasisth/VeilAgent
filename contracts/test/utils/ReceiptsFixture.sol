// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {HiringFixture} from "./HiringFixture.sol";
import {ERC8004Deployer} from "../../script/lib/ERC8004Deployer.sol";
import {SemaphoreDeployer} from "../../script/lib/SemaphoreDeployer.sol";
import {Semaphore} from "@semaphore-protocol/contracts/Semaphore.sol";
import {SemaphoreVerifier} from "@semaphore-protocol/contracts/base/SemaphoreVerifier.sol";
import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {ISemaphoreVerifier} from "@semaphore-protocol/contracts/interfaces/ISemaphoreVerifier.sol";
import {IERC8004Reputation} from "../../src/interfaces/erc8004/IERC8004Reputation.sol";
import {NullifierRegistry} from "../../src/receipts/NullifierRegistry.sol";
import {ReceiptGroupManager} from "../../src/receipts/ReceiptGroupManager.sol";
import {AnonymousFeedback} from "../../src/receipts/AnonymousFeedback.sol";

/// @notice Phase 5 setup on top of HiringFixture: our Semaphore (canonical PoseidonT3, as script/Deploy.s.sol does it),
///         the ERC-8004 Reputation Registry, ReceiptGroupManager pinned to a local W2 workflow id, NullifierRegistry and
///         AnonymousFeedback. Times are pinned to the epoch in test/vectors/feedback.json so its proofs apply.
abstract contract ReceiptsFixture is HiringFixture {
    bytes32 constant KYC = keccak256("kyc-review");
    bytes32 constant W2_ID = keccak256("veil8004.local.w2-receipt-issuer");
    bytes10 constant W2_NAME = bytes10("fedcba9876");
    uint64 constant EPOCH_LENGTH = 1 hours;
    uint64 constant RATING_WINDOW = 1 hours;

    Semaphore semaphore;
    IERC8004Reputation reputation;
    ReceiptGroupManager receipts;
    NullifierRegistry nullifiers;
    AnonymousFeedback feedback;

    string fjson;
    uint64 epoch; // E, from the vectors
    uint256[4] clientIds; // Semaphore identity commitments of the vector clients
    address[4] clientAddrs;
    uint256 alice;
    uint256 bob;
    uint256 carol;
    uint256 private _bidNonce;

    function setUp() public virtual override {
        super.setUp();
        semaphore = Semaphore(SemaphoreDeployer.deploySemaphore(ISemaphoreVerifier(address(new SemaphoreVerifier()))));
        reputation = IERC8004Reputation(ERC8004Deployer.deployReputation(address(identity)));
        receipts = new ReceiptGroupManager(address(forwarder), semaphore, hiring, EPOCH_LENGTH, RATING_WINDOW);
        receipts.setExpectedWorkflowId(W2_ID);
        nullifiers = new NullifierRegistry();
        feedback = new AnonymousFeedback(receipts, nullifiers, reputation);
        nullifiers.setConsumer(address(feedback), true);

        fjson = vm.readFile(string.concat(vm.projectRoot(), "/test/vectors/feedback.json"));
        epoch = uint64(vm.parseUint(vm.parseJsonString(fjson, ".epoch")));
        assertEq(vm.parseUint(vm.parseJsonString(fjson, ".epochLength")), EPOCH_LENGTH, "vector epoch length");
        string[] memory ids = vm.parseJsonStringArray(fjson, ".identityCommitments");
        for (uint256 i; i < 4; i++) {
            clientIds[i] = vm.parseUint(ids[i]);
            clientAddrs[i] = makeAddr(string.concat("client", vm.toString(i)));
        }
        (alice, bob, carol) = (bidders[0], bidders[1], bidders[2]);
        assertEq(alice, vm.parseUint(vm.parseJsonString(fjson, ".agents.alice")), "vector agent ids");
        assertEq(bob, vm.parseUint(vm.parseJsonString(fjson, ".agents.bob")), "vector agent ids");
        assertEq(carol, vm.parseUint(vm.parseJsonString(fjson, ".agents.carol")), "vector agent ids");
    }

    // ---- helpers -------------------------------------------------------------------------------

    function epochStart(uint64 e) internal pure returns (uint256) {
        return uint256(e) * EPOCH_LENGTH;
    }

    /// @dev A full hired job: post (by `who`, with `identityCommitment`), one bid by `winner`, close, W3 award,
    ///      client marks it completed. Re-attests the winner first, since warps can expire the fixture's attestation.
    function completedJob(address who, uint256 identityCommitment, bytes32 category, uint256 winnerIdx)
        internal
        returns (uint256 taskId)
    {
        taskId = awardedJob(who, identityCommitment, category, winnerIdx);
        vm.prank(who);
        hiring.markCompleted(taskId);
    }

    function awardedJob(address who, uint256 identityCommitment, bytes32 category, uint256 winnerIdx)
        internal
        returns (uint256 taskId)
    {
        attest(bidderOwners[winnerIdx], bidders[winnerIdx], true);
        vm.prank(who);
        taskId = hiring.postTask(QUALIFIED, category, uint64(block.timestamp + BIDDING_PERIOD), identityCommitment);
        bytes32 salt = keccak256(abi.encode("bid", ++_bidNonce));
        bytes32 c = placeBid(bidderOwners[winnerIdx], taskId, bidders[winnerIdx], 1000, salt);
        close(taskId);
        deliverW3(w3Report(taskId, bidders[winnerIdx], 1000, salt, 1, leaf(taskId, bidders[winnerIdx], c)));
    }

    function deliverW2(uint256 taskId) internal {
        vm.prank(transmitter);
        forwarder.deliver(address(receipts), W2_ID, W2_NAME, workflowOwner, bytes2(0x0002), abi.encode(taskId));
    }

    /// @dev The vector scenario: jobs before epoch E, then the four receipts at the start of E, in vector order.
    ///      Ends at `epochStart(E) + 10`.
    function scenario() internal returns (uint256[4] memory tasks) {
        vm.warp(epochStart(epoch) - 6 hours);
        tasks[0] = completedJob(clientAddrs[0], clientIds[0], CATEGORY, 0); // client 0 hires alice
        tasks[1] = completedJob(clientAddrs[1], clientIds[1], CATEGORY, 1); // client 1 hires bob
        tasks[2] = completedJob(clientAddrs[2], clientIds[2], CATEGORY, 0); // client 2 hires alice
        tasks[3] = completedJob(clientAddrs[0], clientIds[0], KYC, 0); // client 0 hires alice in KYC
        vm.warp(epochStart(epoch) + 10);
        for (uint256 i; i < 4; i++) deliverW2(tasks[i]);
    }

    function proofOf(string memory name) internal view returns (ISemaphore.SemaphoreProof memory p) {
        string memory k = string.concat(".proofs.", name);
        p.merkleTreeDepth = vm.parseJsonUint(fjson, string.concat(k, ".merkleTreeDepth"));
        p.merkleTreeRoot = vm.parseUint(vm.parseJsonString(fjson, string.concat(k, ".merkleTreeRoot")));
        p.nullifier = vm.parseUint(vm.parseJsonString(fjson, string.concat(k, ".nullifier")));
        p.message = vm.parseUint(vm.parseJsonString(fjson, string.concat(k, ".message")));
        p.scope = vm.parseUint(vm.parseJsonString(fjson, string.concat(k, ".scope")));
        string[] memory points = vm.parseJsonStringArray(fjson, string.concat(k, ".points"));
        for (uint256 i; i < 8; i++) p.points[i] = vm.parseUint(points[i]);
    }

    function rootOf(string memory name) internal view returns (uint256) {
        return vm.parseUint(vm.parseJsonString(fjson, string.concat(".roots.", name)));
    }

    /// @dev Submits from a fresh relayer address: who sends the rating does not matter.
    function rate(uint256 agent, bytes32 category, ISemaphore.SemaphoreProof memory p) internal {
        vm.prank(makeAddr("relayer"));
        feedback.submit(agent, category, epoch, p);
    }
}
