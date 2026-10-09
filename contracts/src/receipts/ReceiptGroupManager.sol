// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReceiverTemplate} from "@chainlink/cre/ReceiverTemplate.sol";
import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {ISemaphoreGroups} from "@semaphore-protocol/contracts/interfaces/ISemaphoreGroups.sol";
import {IVeilReceipts} from "../interfaces/IVeilReceipts.sol";
import {SealedBidHiring} from "../consumers/SealedBidHiring.sol";

/// @title ReceiptGroupManager
/// @notice Issues job receipts into Semaphore groups, one group per job category and epoch, from W2 reports
///         (`abi.encode(uint256 taskId)`) delivered through the CRE forwarder. See IVeilReceipts for epochs and the
///         rating window.
/// @dev The task is read back from SealedBidHiring, so W2 can only name a task; it cannot choose the commitment, the
///      category or the agent. Turn on the template's workflow-identity checks after deployment
///      (`setExpectedWorkflowId`) so only W2 can write here.
contract ReceiptGroupManager is ReceiverTemplate, IVeilReceipts {
    ISemaphore public immutable semaphore;
    SealedBidHiring public immutable hiring;
    uint64 public immutable epochLength;
    uint64 public immutable ratingWindow;

    /// @dev Semaphore group ids start at 0, so the stored value is groupId + 1 and zero means "no group".
    mapping(bytes32 category => mapping(uint64 epoch => uint256 groupIdPlusOne)) private _groups;
    mapping(bytes32 category => mapping(uint64 epoch => mapping(uint256 agentId => bool))) public agentInGroup;
    mapping(uint256 taskId => bool) public receiptIssued;

    error ZeroEpochLength();
    error NoGroup(bytes32 category, uint64 epoch);
    error ReceiptAlreadyIssued(uint256 taskId);
    error TaskNotCompleted(uint256 taskId);
    error NoIdentityCommitment(uint256 taskId);

    constructor(address forwarder, ISemaphore semaphore_, SealedBidHiring hiring_, uint64 epochLength_, uint64 ratingWindow_)
        ReceiverTemplate(forwarder)
    {
        if (epochLength_ == 0) revert ZeroEpochLength();
        semaphore = semaphore_;
        hiring = hiring_;
        epochLength = epochLength_;
        ratingWindow = ratingWindow_;
    }

    /// @inheritdoc IVeilReceipts
    function currentEpoch() public view returns (uint64) {
        return uint64(block.timestamp / epochLength);
    }

    /// @inheritdoc IVeilReceipts
    function ratingClosesAt(uint64 epoch) external view returns (uint256) {
        return (uint256(epoch) + 1) * epochLength + ratingWindow;
    }

    /// @inheritdoc IVeilReceipts
    function hasGroup(bytes32 category, uint64 epoch) external view returns (bool) {
        return _groups[category][epoch] != 0;
    }

    /// @inheritdoc IVeilReceipts
    function groupId(bytes32 category, uint64 epoch) external view returns (uint256) {
        uint256 g = _groups[category][epoch];
        if (g == 0) revert NoGroup(category, epoch);
        return g - 1;
    }

    /// @dev Reverts unless the task is Completed, has no receipt yet and carries an identity commitment. A commitment
    ///      already in the group (the same client, another job this epoch) is not added twice, but the job's agent is
    ///      still recorded. Semaphore rejects a commitment outside the SNARK field, which blocks only that receipt.
    function _processReport(bytes calldata report) internal override {
        uint256 taskId = abi.decode(report, (uint256));
        if (receiptIssued[taskId]) revert ReceiptAlreadyIssued(taskId);
        SealedBidHiring.Task memory t = hiring.getTask(taskId);
        if (t.status != SealedBidHiring.TaskStatus.Completed) revert TaskNotCompleted(taskId);
        if (t.identityCommitment == 0) revert NoIdentityCommitment(taskId);
        receiptIssued[taskId] = true;

        uint64 epoch = currentEpoch();
        uint256 gid = _groupFor(t.category, epoch);
        if (!ISemaphoreGroups(address(semaphore)).hasMember(gid, t.identityCommitment)) semaphore.addMember(gid, t.identityCommitment);
        uint256 agentId = hiring.getAward(taskId).winnerAgentId;
        agentInGroup[t.category][epoch][agentId] = true;
        emit ReceiptIssued(taskId, t.category, epoch, gid, agentId);
    }

    function _groupFor(bytes32 category, uint64 epoch) private returns (uint256 gid) {
        uint256 g = _groups[category][epoch];
        if (g != 0) return g - 1;
        // docs/phase0.md S-1: a replaced root must stay valid until ratings for the epoch close.
        gid = semaphore.createGroup(address(this), uint256(epochLength) + ratingWindow);
        _groups[category][epoch] = gid + 1;
        emit ReceiptGroupCreated(category, epoch, gid);
    }
}
