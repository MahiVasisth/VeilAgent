// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";

/// @title IVeilReceipts
/// @notice Job receipts for anonymous feedback. When a hired job is completed, a CRE workflow (W2) reports the task and
///         the receipt manager adds the client's Semaphore identity commitment to the receipt group for the task's
///         category and the current epoch. It also records that the hired agent had a completed job in that group, so
///         only such agents can be rated from it.
/// @dev Epochs: `epoch = block.timestamp / epochLength`, taken when the receipt lands. Ratings for an epoch are open
///      until `ratingClosesAt(epoch) = (epoch + 1) * epochLength + ratingWindow`. Each group's Semaphore
///      `merkleTreeDuration` is `epochLength + ratingWindow`, so a proof built against any root of the group still
///      verifies until ratings close, even after later receipts change the root.
///      W2 report payload: `abi.encode(uint256 taskId)`.
interface IVeilReceipts {
    /// @notice A receipt was issued: the client's identity commitment is in `groupId` (unless it already was).
    event ReceiptIssued(
        uint256 indexed taskId, bytes32 indexed category, uint64 indexed epoch, uint256 groupId, uint256 agentId
    );
    /// @notice The receipt group for `(category, epoch)` was created in Semaphore.
    event ReceiptGroupCreated(bytes32 indexed category, uint64 indexed epoch, uint256 groupId);

    /// @notice The Semaphore deployment that holds the receipt groups. This contract is the admin of every group.
    function semaphore() external view returns (ISemaphore);

    /// @notice Seconds per epoch.
    function epochLength() external view returns (uint64);

    /// @notice Seconds after an epoch ends during which its ratings are still accepted.
    function ratingWindow() external view returns (uint64);

    /// @notice `block.timestamp / epochLength`.
    function currentEpoch() external view returns (uint64);

    /// @notice First timestamp at which ratings for `epoch` are no longer accepted and its aggregates can be anchored.
    function ratingClosesAt(uint64 epoch) external view returns (uint256);

    /// @notice True once the receipt group for `(category, epoch)` exists.
    function hasGroup(bytes32 category, uint64 epoch) external view returns (bool);

    /// @notice The Semaphore group id for `(category, epoch)`. Reverts if no receipt has created it yet.
    function groupId(bytes32 category, uint64 epoch) external view returns (uint256);

    /// @notice True if a receipt in `(category, epoch)` came from a job completed by `agentId`.
    function agentInGroup(bytes32 category, uint64 epoch, uint256 agentId) external view returns (bool);

    /// @notice True once `taskId` has had its receipt. One receipt per task.
    function receiptIssued(uint256 taskId) external view returns (bool);
}

/// @title IVeilFeedback
/// @notice Anonymous ratings of ERC-8004 agents by clients holding a receipt. A rating is a Semaphore proof of
///         membership in a receipt group with `message = score` (1 to 5) and
///         `scope = uint256(keccak256(abi.encode(uint256 agentId, uint64 epoch)))`, so each identity rates each agent
///         at most once per epoch. Anyone can relay it. After ratings close, anyone anchors the agent's average for the
///         epoch into the ERC-8004 Reputation Registry, as feedback from this contract.
/// @dev Individual scores are public; the rater is hidden among the group's members. The nullifier is consumed in a
///      NullifierRegistry under `keccak256(abi.encode("feedback", agentId, epoch))` as well as in Semaphore, because
///      Semaphore stores nullifiers per group and one identity can sit in several categories' groups in the same epoch.
interface IVeilFeedback {
    /// @notice A rating was accepted. `nullifier` is public and unlinkable to the rater's identity.
    event FeedbackSubmitted(
        uint256 indexed agentId, uint64 indexed epoch, bytes32 indexed category, uint8 score, uint256 nullifier
    );
    /// @notice The average for `(agentId, epoch)` was written to the Reputation Registry (`value` has 2 decimals).
    event FeedbackAnchored(uint256 indexed agentId, uint64 indexed epoch, int128 value, uint64 count);

    /// @notice Submits one anonymous rating. Callable by anyone (a relayer or a fresh wallet).
    /// @dev Reverts unless: the agent had a completed job in `(category, epoch)`; `proof.message` is 1 to 5;
    ///      `proof.scope` is `uint256(keccak256(abi.encode(agentId, epoch)))`; ratings for the epoch are still open and
    ///      not anchored; Semaphore accepts the proof for the group; and the nullifier is unused for `(agentId, epoch)`.
    function submit(uint256 agentId, bytes32 category, uint64 epoch, ISemaphore.SemaphoreProof calldata proof)
        external;

    /// @notice Writes the average score for `(agentId, epoch)` to the Reputation Registry as
    ///         `giveFeedback(agentId, int128(sum * 100 / count), 2, "veil8004", "anon-aggregate", "", "", 0)`.
    /// @dev Callable by anyone once ratings for the epoch have closed, once per agent and epoch, if it has a rating.
    ///      Readers fetch it with `getSummary(agentId, [address(this)], "veil8004", "anon-aggregate")`.
    function anchor(uint256 agentId, uint64 epoch) external;

    /// @notice Sum and count of the scores accepted for `(agentId, epoch)`.
    function aggregate(uint256 agentId, uint64 epoch) external view returns (uint256 sum, uint256 count);

    /// @notice True once `(agentId, epoch)` has been anchored.
    function anchored(uint256 agentId, uint64 epoch) external view returns (bool);
}
