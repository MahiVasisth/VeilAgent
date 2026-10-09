// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@chainlink/cre/IERC165.sol";
import {IReceiver} from "@chainlink/cre/IReceiver.sol";

/// @title MockForwarder (SIMULATION, local only)
/// @notice Stands in for the CRE KeystoneForwarder on Anvil and in tests. It does NOT verify DON signatures: an
///         allow-listed transmitter (the local runner's key) hands it a report and it calls `onReport` on the
///         receiver with the metadata layout the real forwarder uses (docs/phase0.md C-3):
///         `abi.encodePacked(bytes32 workflowId, bytes10 workflowName, address workflowOwner, bytes2 reportId)`.
/// @dev Differences from the real forwarder, on purpose:
///      - receiver reverts bubble up, so tests can assert the exact custom error (the real one records
///        `success=false` and emits `ReportProcessed(..., false)`, docs/phase0.md C-4);
///      - no signature check: trust rests on the transmitter allow-list.
contract MockForwarder is Ownable {
    mapping(address => bool) public isTransmitter;

    event TransmitterSet(address indexed transmitter, bool allowed);
    event ReportProcessed(address indexed receiver, bytes32 indexed workflowId, bytes2 indexed reportId, bool result);

    error NotTransmitter(address caller);
    error ReceiverNotSupported(address receiver);

    constructor() Ownable(msg.sender) {}

    function setTransmitter(address transmitter, bool allowed) external onlyOwner {
        isTransmitter[transmitter] = allowed;
        emit TransmitterSet(transmitter, allowed);
    }

    /// @notice Delivers `report` to `receiver` as workflow `(workflowId, workflowName, workflowOwner)`.
    function deliver(
        address receiver,
        bytes32 workflowId,
        bytes10 workflowName,
        address workflowOwner,
        bytes2 reportId,
        bytes calldata report
    ) external {
        if (!isTransmitter[msg.sender]) revert NotTransmitter(msg.sender);
        // The real forwarder checks ERC-165 before routing (docs/phase0.md C-5).
        if (!_supportsReceiver(receiver)) revert ReceiverNotSupported(receiver);
        bytes memory metadata = abi.encodePacked(workflowId, workflowName, workflowOwner, reportId);
        IReceiver(receiver).onReport(metadata, report);
        emit ReportProcessed(receiver, workflowId, reportId, true);
    }

    /// @notice The `bytes10` workflow name CRE puts in metadata: the ASCII bytes of the first 10 hex characters
    ///         of `sha256(name)`. Matches `ReceiverTemplate.setExpectedWorkflowName`.
    function workflowNameOf(string calldata name) external pure returns (bytes10 out) {
        bytes32 h = sha256(bytes(name));
        bytes memory hexChars = "0123456789abcdef";
        bytes memory first10 = new bytes(10);
        for (uint256 i; i < 5; i++) {
            first10[2 * i] = hexChars[uint8(h[i]) >> 4];
            first10[2 * i + 1] = hexChars[uint8(h[i]) & 0x0f];
        }
        out = bytes10(first10);
    }

    function _supportsReceiver(address receiver) private view returns (bool) {
        try IERC165(receiver).supportsInterface(type(IReceiver).interfaceId) returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }
}
