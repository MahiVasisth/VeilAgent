// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReceiverTemplate} from "@chainlink/cre/ReceiverTemplate.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {VeilGate} from "../core/VeilGate.sol";
import {PolicyRegistry} from "../core/PolicyRegistry.sol";
import {IVeilValidation} from "../interfaces/IVeilValidation.sol";
import {IERC8004Identity} from "../interfaces/erc8004/IERC8004Identity.sol";

/// @title SealedBidHiring
/// @notice Second VeilGate consumer: sealed-bid hiring of ERC-8004 agents. Only agents that hold the task's policy
///         (an unexpired pass from their own controller, `onlyAttested`) can bid. A bid is a commitment
///         `keccak256(abi.encode(uint256 taskId, uint256 agentId, uint256 price, bytes32 salt))`; the opening goes
///         sealed to the W3 bid-opener workflow. After the deadline anyone closes bidding, W3 opens the bids
///         off-chain, and its report reveals only the winner, the winning price and salt, the number of counted bids
///         and a Merkle root over them. Losing prices never reach the chain.
/// @dev Report payload (W3): `abi.encode(uint256 taskId, uint256 winnerAgentId, uint256 winningPrice,
///      bytes32 winnerSalt, uint32 validBidCount, bytes32 merkleRoot)`. The chain checks that the winner's opening
///      matches its commitment; that the winner was the lowest valid bid is trusted to W3 (docs/threat-model.md).
///      Merkle leaves follow OpenZeppelin's StandardMerkleTree over `[taskId, agentId, bidCommitment]` with types
///      `["uint256", "uint256", "bytes32"]`: `keccak256(bytes.concat(keccak256(abi.encode(taskId, agentId, c))))`.
///      Turn on the template's workflow-identity checks after deployment (`setExpectedWorkflowId`) so only W3 can
///      write here.
contract SealedBidHiring is VeilGate, ReceiverTemplate {
    enum TaskStatus {
        None,
        Open,
        Closed,
        Awarded,
        NoAward,
        Completed
    }

    struct Task {
        address client;
        uint64 deadline;
        TaskStatus status;
        bytes32 policyId;
        bytes32 category;
        uint256 identityCommitment;
    }

    struct Bid {
        uint256 agentId;
        bytes32 commitment;
    }

    struct Award {
        uint256 winnerAgentId;
        uint256 winningPrice;
        uint32 validBidCount;
        bytes32 merkleRoot;
    }

    PolicyRegistry public immutable policyRegistry;

    /// @notice Number of tasks posted. Task ids start at 1.
    uint256 public taskCount;
    mapping(uint256 taskId => Task) private _tasks;
    mapping(uint256 taskId => Bid[]) private _bids;
    mapping(uint256 taskId => mapping(uint256 agentId => bytes32 commitment)) public bidCommitmentOf;
    mapping(uint256 taskId => Award) private _awards;

    event TaskPosted(
        uint256 indexed taskId,
        address indexed client,
        bytes32 indexed policyId,
        bytes32 category,
        uint64 deadline,
        uint256 identityCommitment
    );
    event BidPlaced(uint256 indexed taskId, uint256 indexed agentId, bytes32 bidCommitment);
    event BiddingClosed(uint256 indexed taskId, uint256 bidCount);
    event JobAwarded(
        uint256 indexed taskId,
        uint256 indexed winnerAgentId,
        uint256 winningPrice,
        uint32 validBidCount,
        bytes32 merkleRoot
    );
    /// @notice W3 counted no valid bid. Final, like an award.
    event NoAward(uint256 indexed taskId);
    event JobCompleted(uint256 indexed taskId, uint256 indexed agentId, bytes32 category, uint256 identityCommitment);

    error PolicyInactive(bytes32 policyId);
    error DeadlineNotInFuture(uint64 deadline);
    error TaskNotOpen(uint256 taskId);
    error BiddingOver(uint256 taskId, uint64 deadline);
    error BiddingNotOver(uint256 taskId, uint64 deadline);
    error AlreadyBid(uint256 taskId, uint256 agentId);
    error ZeroCommitment();
    error TaskNotClosed(uint256 taskId);
    error TooManyValidBids(uint32 validBidCount, uint256 bidCount);
    error WinnerCommitmentMismatch(uint256 taskId, uint256 winnerAgentId);
    error ZeroMerkleRoot();
    error NotClient(address caller);
    error TaskNotAwarded(uint256 taskId);

    constructor(
        address forwarder,
        IVeilValidation veilRegistry_,
        IERC8004Identity identityRegistry_,
        PolicyRegistry policyRegistry_
    ) VeilGate(veilRegistry_, identityRegistry_) ReceiverTemplate(forwarder) {
        policyRegistry = policyRegistry_;
    }

    /// @notice Posts a task. Bids are accepted while `block.timestamp < deadline`.
    /// @param policyId           Agent-level policy a bidder must hold, e.g. `keccak256("QUALIFIED_SCREENER_V1")`.
    /// @param category           Public job category (receipt groups are per category in Phase 5).
    /// @param identityCommitment The client's Semaphore identity commitment, used for the receipt in Phase 5.
    function postTask(bytes32 policyId, bytes32 category, uint64 deadline, uint256 identityCommitment)
        external
        returns (uint256 taskId)
    {
        if (!policyRegistry.getPolicy(policyId).active) revert PolicyInactive(policyId);
        if (deadline <= block.timestamp) revert DeadlineNotInFuture(deadline);
        taskId = ++taskCount;
        _tasks[taskId] = Task(msg.sender, deadline, TaskStatus.Open, policyId, category, identityCommitment);
        emit TaskPosted(taskId, msg.sender, policyId, category, deadline, identityCommitment);
    }

    /// @notice Places a sealed bid for `agentId`. The caller must control the agent and the agent must hold the
    ///         task's policy. One bid per agent per task; bids are stored in order (ties go to the earliest).
    function bid(uint256 taskId, uint256 agentId, bytes32 bidCommitment)
        external
        onlyAttested(agentId, _tasks[taskId].policyId)
    {
        Task storage t = _tasks[taskId];
        if (t.status != TaskStatus.Open) revert TaskNotOpen(taskId);
        if (block.timestamp >= t.deadline) revert BiddingOver(taskId, t.deadline);
        if (bidCommitmentOf[taskId][agentId] != bytes32(0)) revert AlreadyBid(taskId, agentId);
        if (bidCommitment == bytes32(0)) revert ZeroCommitment();
        bidCommitmentOf[taskId][agentId] = bidCommitment;
        _bids[taskId].push(Bid(agentId, bidCommitment));
        emit BidPlaced(taskId, agentId, bidCommitment);
    }

    /// @notice Anyone, once `block.timestamp >= deadline`. W3 triggers on `BiddingClosed`.
    function closeBidding(uint256 taskId) external {
        Task storage t = _tasks[taskId];
        if (t.status != TaskStatus.Open) revert TaskNotOpen(taskId);
        if (block.timestamp < t.deadline) revert BiddingNotOver(taskId, t.deadline);
        t.status = TaskStatus.Closed;
        emit BiddingClosed(taskId, _bids[taskId].length);
    }

    /// @notice The client confirms the awarded job is done.
    function markCompleted(uint256 taskId) external {
        Task storage t = _tasks[taskId];
        if (msg.sender != t.client) revert NotClient(msg.sender);
        if (t.status != TaskStatus.Awarded) revert TaskNotAwarded(taskId);
        t.status = TaskStatus.Completed;
        emit JobCompleted(taskId, _awards[taskId].winnerAgentId, t.category, t.identityCommitment);
    }

    /// @notice True if `agentId`'s bid on `taskId` is a leaf of the award's Merkle tree, i.e. W3 counted it.
    ///         False before an award, after `NoAward`, or if the agent did not bid.
    function verifyInclusion(uint256 taskId, uint256 agentId, bytes32[] calldata proof) external view returns (bool) {
        TaskStatus s = _tasks[taskId].status;
        if (s != TaskStatus.Awarded && s != TaskStatus.Completed) return false;
        bytes32 commitment = bidCommitmentOf[taskId][agentId];
        if (commitment == bytes32(0)) return false;
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(taskId, agentId, commitment))));
        return MerkleProof.verify(proof, _awards[taskId].merkleRoot, leaf);
    }

    function getTask(uint256 taskId) external view returns (Task memory) {
        return _tasks[taskId];
    }

    /// @notice All bids on `taskId`, in the order they were placed.
    function getBids(uint256 taskId) external view returns (Bid[] memory) {
        return _bids[taskId];
    }

    function getAward(uint256 taskId) external view returns (Award memory) {
        return _awards[taskId];
    }

    /// @dev Decodes and checks a W3 report. The task must be Closed, which also makes an award final and is the
    ///      replay guard. With no valid bid the task ends as NoAward; otherwise the winner's price and salt must
    ///      open the winner's stored commitment.
    function _processReport(bytes calldata report) internal override {
        (
            uint256 taskId,
            uint256 winnerAgentId,
            uint256 winningPrice,
            bytes32 winnerSalt,
            uint32 validBidCount,
            bytes32 merkleRoot
        ) = abi.decode(report, (uint256, uint256, uint256, bytes32, uint32, bytes32));

        Task storage t = _tasks[taskId];
        if (t.status != TaskStatus.Closed) revert TaskNotClosed(taskId);
        uint256 bidCount = _bids[taskId].length;
        if (validBidCount > bidCount) revert TooManyValidBids(validBidCount, bidCount);

        if (validBidCount == 0) {
            t.status = TaskStatus.NoAward;
            emit NoAward(taskId);
            return;
        }

        bytes32 opened = keccak256(abi.encode(taskId, winnerAgentId, winningPrice, winnerSalt));
        if (opened != bidCommitmentOf[taskId][winnerAgentId]) revert WinnerCommitmentMismatch(taskId, winnerAgentId);
        if (merkleRoot == bytes32(0)) revert ZeroMerkleRoot();

        _awards[taskId] = Award(winnerAgentId, winningPrice, validBidCount, merkleRoot);
        t.status = TaskStatus.Awarded;
        emit JobAwarded(taskId, winnerAgentId, winningPrice, validBidCount, merkleRoot);
    }
}
