// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {VeilGate} from "../core/VeilGate.sol";
import {IVeilValidation} from "../interfaces/IVeilValidation.sol";
import {IERC8004Identity} from "../interfaces/erc8004/IERC8004Identity.sol";

/// @title TreasuryAction
/// @notice First VeilGate consumer: a public action unlocked by one passing, unexpired SANCTIONS_SCREEN_V1 result
///         that the treasury operator requested. The action itself (event and counter) is public.
contract TreasuryAction is VeilGate {
    bytes32 public constant SANCTIONS_SCREEN_V1 = keccak256("SANCTIONS_SCREEN_V1");

    address public immutable treasuryOperator;
    uint256 public actionCount;
    mapping(bytes32 requestId => bool) public executed;

    event ActionExecuted(bytes32 indexed requestId);

    error NotOperatorRequest(address requester);
    error AlreadyExecuted(bytes32 requestId);

    constructor(IVeilValidation veilRegistry_, IERC8004Identity identityRegistry_, address treasuryOperator_)
        VeilGate(veilRegistry_, identityRegistry_)
    {
        treasuryOperator = treasuryOperator_;
    }

    function execute(bytes32 requestId) external onlyAttestedRequest(requestId, SANCTIONS_SCREEN_V1) {
        // Without this, anyone's passing result for the same policy would unlock the action.
        address requester = veilRegistry.getRequest(requestId).requester;
        if (requester != treasuryOperator) revert NotOperatorRequest(requester);
        if (executed[requestId]) revert AlreadyExecuted(requestId);
        executed[requestId] = true;
        actionCount++;
        emit ActionExecuted(requestId);
    }
}
