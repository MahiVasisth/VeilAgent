// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title NullifierRegistry
/// @notice One-time use of a nullifier within a context, across Semaphore groups. AnonymousFeedback consumes each
///         rating's nullifier under `keccak256(abi.encode("feedback", agentId, epoch))`, because Semaphore stores
///         nullifiers per group (docs/phase0.md S-2).
/// @dev Contexts are shared by all consumers, so only the owner's allow-listed consumer contracts may consume.
contract NullifierRegistry is Ownable {
    mapping(address consumer => bool) public isConsumer;
    mapping(bytes32 context => mapping(uint256 nullifier => bool)) private _used;

    event ConsumerSet(address indexed consumer, bool allowed);
    event NullifierConsumed(bytes32 indexed context, uint256 indexed nullifier, address indexed consumer);

    error NotConsumer(address caller);
    error NullifierAlreadyUsed(bytes32 context, uint256 nullifier);

    constructor() Ownable(msg.sender) {}

    function setConsumer(address consumer, bool allowed) external onlyOwner {
        isConsumer[consumer] = allowed;
        emit ConsumerSet(consumer, allowed);
    }

    /// @notice Marks `(context, nullifier)` used. Reverts if it already was, or if the caller is not a consumer.
    function consume(bytes32 context, uint256 nullifier) external {
        if (!isConsumer[msg.sender]) revert NotConsumer(msg.sender);
        if (_used[context][nullifier]) revert NullifierAlreadyUsed(context, nullifier);
        _used[context][nullifier] = true;
        emit NullifierConsumed(context, nullifier, msg.sender);
    }

    function isUsed(bytes32 context, uint256 nullifier) external view returns (bool) {
        return _used[context][nullifier];
    }
}
