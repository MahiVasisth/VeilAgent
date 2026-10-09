// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {IVeilFeedback} from "../interfaces/IVeilReceipts.sol";
import {IERC8004Reputation} from "../interfaces/erc8004/IERC8004Reputation.sol";
import {NullifierRegistry} from "./NullifierRegistry.sol";
import {ReceiptGroupManager} from "./ReceiptGroupManager.sol";

/// @title AnonymousFeedback
/// @notice Anonymous 1-to-5 ratings from receipt holders, and their per-epoch average anchored into the ERC-8004
///         Reputation Registry. See IVeilFeedback.
/// @dev Must be an allow-listed consumer of the NullifierRegistry. The Reputation Registry rejects feedback from an
///      agent's owner or operators; this contract is neither.
contract AnonymousFeedback is IVeilFeedback {
    string public constant TAG1 = "veil8004";
    string public constant TAG2 = "anon-aggregate";
    uint8 public constant MIN_SCORE = 1;
    uint8 public constant MAX_SCORE = 5;

    ReceiptGroupManager public immutable receipts;
    ISemaphore public immutable semaphore;
    NullifierRegistry public immutable nullifiers;
    IERC8004Reputation public immutable reputation;

    struct Aggregate {
        uint128 sum;
        uint64 count;
        bool anchored;
    }

    mapping(uint256 agentId => mapping(uint64 epoch => Aggregate)) private _aggregates;

    error AgentNotInGroup(uint256 agentId, bytes32 category, uint64 epoch);
    error ScoreOutOfRange(uint256 score);
    error ScopeMismatch(uint256 scope, uint256 expected);
    error AlreadyAnchored(uint256 agentId, uint64 epoch);
    error RatingClosed(uint64 epoch, uint256 closedAt);
    error RatingStillOpen(uint64 epoch, uint256 closesAt);
    error NoRatings(uint256 agentId, uint64 epoch);

    constructor(ReceiptGroupManager receipts_, NullifierRegistry nullifiers_, IERC8004Reputation reputation_) {
        receipts = receipts_;
        semaphore = receipts_.semaphore();
        nullifiers = nullifiers_;
        reputation = reputation_;
    }

    /// @notice The scope a rating of `agentId` in `epoch` must carry.
    function scopeOf(uint256 agentId, uint64 epoch) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(agentId, epoch)));
    }

    /// @notice The NullifierRegistry context for ratings of `agentId` in `epoch`.
    function nullifierContext(uint256 agentId, uint64 epoch) public pure returns (bytes32) {
        return keccak256(abi.encode("feedback", agentId, epoch));
    }

    /// @inheritdoc IVeilFeedback
    function submit(uint256 agentId, bytes32 category, uint64 epoch, ISemaphore.SemaphoreProof calldata proof)
        external
    {
        if (!receipts.agentInGroup(category, epoch, agentId)) revert AgentNotInGroup(agentId, category, epoch);
        if (proof.message < MIN_SCORE || proof.message > MAX_SCORE) revert ScoreOutOfRange(proof.message);
        uint256 expected = scopeOf(agentId, epoch);
        if (proof.scope != expected) revert ScopeMismatch(proof.scope, expected);
        Aggregate storage a = _aggregates[agentId][epoch];
        if (a.anchored) revert AlreadyAnchored(agentId, epoch);
        uint256 closesAt = receipts.ratingClosesAt(epoch);
        if (block.timestamp >= closesAt) revert RatingClosed(epoch, closesAt);

        semaphore.validateProof(receipts.groupId(category, epoch), proof);
        nullifiers.consume(nullifierContext(agentId, epoch), proof.nullifier);

        a.sum += uint128(proof.message);
        a.count += 1;
        emit FeedbackSubmitted(agentId, epoch, category, uint8(proof.message), proof.nullifier);
    }

    /// @inheritdoc IVeilFeedback
    function anchor(uint256 agentId, uint64 epoch) external {
        uint256 closesAt = receipts.ratingClosesAt(epoch);
        if (block.timestamp < closesAt) revert RatingStillOpen(epoch, closesAt);
        Aggregate storage a = _aggregates[agentId][epoch];
        if (a.anchored) revert AlreadyAnchored(agentId, epoch);
        if (a.count == 0) revert NoRatings(agentId, epoch);
        a.anchored = true;
        // At most 5 * 100 = 500 with 2 decimals, well inside int128 and the registry's value bound.
        int128 value = int128(uint128(uint256(a.sum) * 100 / a.count));
        reputation.giveFeedback(agentId, value, 2, TAG1, TAG2, "", "", bytes32(0));
        emit FeedbackAnchored(agentId, epoch, value, a.count);
    }

    /// @inheritdoc IVeilFeedback
    function aggregate(uint256 agentId, uint64 epoch) external view returns (uint256 sum, uint256 count) {
        Aggregate storage a = _aggregates[agentId][epoch];
        return (a.sum, a.count);
    }

    /// @inheritdoc IVeilFeedback
    function anchored(uint256 agentId, uint64 epoch) external view returns (bool) {
        return _aggregates[agentId][epoch].anchored;
    }
}
