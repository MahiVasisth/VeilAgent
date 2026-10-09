// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReceiverTemplate} from "@chainlink/cre/ReceiverTemplate.sol";
import {ReceiptsFixture} from "./utils/ReceiptsFixture.sol";
import {ReceiptGroupManager} from "../src/receipts/ReceiptGroupManager.sol";
import {IVeilReceipts} from "../src/interfaces/IVeilReceipts.sol";
import {SealedBidHiring} from "../src/consumers/SealedBidHiring.sol";

/// @notice Receipts (Phase 5, Flow D step 2): only a completed, awarded job yields a receipt, once, into the group for
///         its category and the current epoch.
contract ReceiptGroupManagerTest is ReceiptsFixture {
    function test_receiptAddsClientAndRecordsAgent() public {
        vm.warp(epochStart(epoch) - 2 hours);
        uint256 taskId = completedJob(clientAddrs[0], clientIds[0], CATEGORY, 0);
        vm.warp(epochStart(epoch) + 5);
        assertFalse(receipts.hasGroup(CATEGORY, epoch));

        vm.expectEmit(true, true, true, true, address(receipts));
        emit IVeilReceipts.ReceiptIssued(taskId, CATEGORY, epoch, 0, alice);
        deliverW2(taskId);

        assertTrue(receipts.receiptIssued(taskId));
        uint256 gid = receipts.groupId(CATEGORY, epoch);
        assertTrue(semaphore.hasMember(gid, clientIds[0]));
        assertEq(semaphore.getMerkleTreeRoot(gid), rootOf("sanctionsFirst"), "same root as the SDK group");
        assertEq(semaphore.getGroupAdmin(gid), address(receipts));
        assertEq(semaphore.groups(gid), EPOCH_LENGTH + RATING_WINDOW, "S-1: roots outlive the rating window");
        assertTrue(receipts.agentInGroup(CATEGORY, epoch, alice));
        assertFalse(receipts.agentInGroup(CATEGORY, epoch, bob));
        assertFalse(receipts.agentInGroup(KYC, epoch, alice));
    }

    function test_scenarioBuildsTheVectorGroups() public {
        scenario();
        assertEq(semaphore.getMerkleTreeRoot(receipts.groupId(CATEGORY, epoch)), rootOf("sanctions"));
        assertEq(semaphore.getMerkleTreeRoot(receipts.groupId(KYC, epoch)), rootOf("kyc"));
        assertTrue(receipts.agentInGroup(CATEGORY, epoch, alice));
        assertTrue(receipts.agentInGroup(CATEGORY, epoch, bob));
        assertFalse(receipts.agentInGroup(CATEGORY, epoch, carol));
        assertTrue(receipts.agentInGroup(KYC, epoch, alice));
    }

    function test_noReceiptWithoutACompletedAwardedJob() public {
        vm.warp(epochStart(epoch) - 2 hours);
        uint256 awarded = awardedJob(clientAddrs[0], clientIds[0], CATEGORY, 0);
        vm.prank(clientAddrs[1]);
        uint256 open = hiring.postTask(QUALIFIED, CATEGORY, uint64(block.timestamp + BIDDING_PERIOD), clientIds[1]);

        vm.expectRevert(abi.encodeWithSelector(ReceiptGroupManager.TaskNotCompleted.selector, awarded));
        deliverW2(awarded);
        vm.expectRevert(abi.encodeWithSelector(ReceiptGroupManager.TaskNotCompleted.selector, open));
        deliverW2(open);
        vm.expectRevert(abi.encodeWithSelector(ReceiptGroupManager.TaskNotCompleted.selector, 999));
        deliverW2(999);

        // A task that ended with no award can never be completed, so it can never yield a receipt.
        vm.prank(clientAddrs[1]);
        uint256 noAward = hiring.postTask(QUALIFIED, CATEGORY, uint64(block.timestamp + BIDDING_PERIOD), clientIds[1]);
        close(noAward);
        deliverW3(w3Report(noAward, 0, 0, bytes32(0), 0, bytes32(0)));
        vm.prank(clientAddrs[1]);
        vm.expectRevert(abi.encodeWithSelector(SealedBidHiring.TaskNotAwarded.selector, noAward));
        hiring.markCompleted(noAward);
        vm.expectRevert(abi.encodeWithSelector(ReceiptGroupManager.TaskNotCompleted.selector, noAward));
        deliverW2(noAward);
    }

    function test_oneReceiptPerTask() public {
        vm.warp(epochStart(epoch) - 2 hours);
        uint256 taskId = completedJob(clientAddrs[0], clientIds[0], CATEGORY, 0);
        deliverW2(taskId);
        vm.expectRevert(abi.encodeWithSelector(ReceiptGroupManager.ReceiptAlreadyIssued.selector, taskId));
        deliverW2(taskId);
    }

    function test_noReceiptWithoutIdentityCommitment() public {
        uint256 taskId = completedJob(clientAddrs[0], 0, CATEGORY, 0);
        vm.expectRevert(abi.encodeWithSelector(ReceiptGroupManager.NoIdentityCommitment.selector, taskId));
        deliverW2(taskId);
    }

    function test_sameClientTwoJobsSameGroupKeepsBothAgents() public {
        vm.warp(epochStart(epoch) - 3 hours);
        uint256 a = completedJob(clientAddrs[0], clientIds[0], CATEGORY, 0);
        uint256 b = completedJob(clientAddrs[0], clientIds[0], CATEGORY, 1);
        vm.warp(epochStart(epoch) + 5);
        deliverW2(a);
        deliverW2(b); // the commitment is already a member: not added twice, no revert
        uint256 gid = receipts.groupId(CATEGORY, epoch);
        assertEq(semaphore.getMerkleTreeSize(gid), 1);
        assertTrue(receipts.agentInGroup(CATEGORY, epoch, alice));
        assertTrue(receipts.agentInGroup(CATEGORY, epoch, bob));
    }

    function test_groupsArePerCategoryAndEpoch() public {
        vm.warp(epochStart(epoch) - 3 hours);
        uint256 a = completedJob(clientAddrs[0], clientIds[0], CATEGORY, 0);
        uint256 b = completedJob(clientAddrs[1], clientIds[1], CATEGORY, 1);
        vm.warp(epochStart(epoch) + 5);
        deliverW2(a);
        vm.warp(epochStart(epoch + 1) + 5);
        deliverW2(b);
        assertTrue(receipts.groupId(CATEGORY, epoch) != receipts.groupId(CATEGORY, epoch + 1));
        assertFalse(receipts.agentInGroup(CATEGORY, epoch, bob));
        assertTrue(receipts.agentInGroup(CATEGORY, epoch + 1, bob));
        vm.expectRevert(abi.encodeWithSelector(ReceiptGroupManager.NoGroup.selector, KYC, epoch));
        receipts.groupId(KYC, epoch);
    }

    function test_epochAndWindowArithmetic() public {
        vm.warp(epochStart(epoch) + 1234);
        assertEq(receipts.currentEpoch(), epoch);
        assertEq(receipts.ratingClosesAt(epoch), epochStart(epoch + 1) + RATING_WINDOW);
        vm.expectRevert(ReceiptGroupManager.ZeroEpochLength.selector);
        new ReceiptGroupManager(address(forwarder), semaphore, hiring, 0, RATING_WINDOW);
    }

    function test_onlyTheForwarderAndOnlyW2() public {
        uint256 taskId = completedJob(clientAddrs[0], clientIds[0], CATEGORY, 0);
        bytes memory metadata = abi.encodePacked(W2_ID, W2_NAME, workflowOwner, bytes2(0x0002));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.InvalidSender.selector, stranger, address(forwarder)));
        receipts.onReport(metadata, abi.encode(taskId));

        vm.prank(transmitter);
        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.InvalidWorkflowId.selector, W3_ID, W2_ID));
        forwarder.deliver(address(receipts), W3_ID, W2_NAME, workflowOwner, bytes2(0x0002), abi.encode(taskId));
    }

    function test_onlyTheManagerAdministersItsGroups() public {
        vm.warp(epochStart(epoch) - 2 hours);
        uint256 taskId = completedJob(clientAddrs[0], clientIds[0], CATEGORY, 0);
        vm.warp(epochStart(epoch) + 5);
        deliverW2(taskId);
        uint256 gid = receipts.groupId(CATEGORY, epoch);
        vm.prank(stranger);
        vm.expectRevert(bytes4(keccak256("Semaphore__CallerIsNotTheGroupAdmin()")));
        semaphore.addMember(gid, clientIds[3]);
    }
}
