// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReceiverTemplate} from "@chainlink/cre/ReceiverTemplate.sol";
import {MockForwarder} from "../src/mocks/MockForwarder.sol";

contract RecordingReceiver is ReceiverTemplate {
    bytes public lastReport;
    bytes32 public lastWorkflowId;
    bytes10 public lastWorkflowName;
    address public lastWorkflowOwner;

    constructor(address forwarder) ReceiverTemplate(forwarder) {}

    function _processReport(bytes calldata report) internal override {
        lastReport = report;
    }

    /// @dev Re-decodes metadata the way ReceiverTemplate does, to prove the layout.
    function decode(bytes calldata metadata) external pure returns (bytes32, bytes10, address) {
        return _decodeMetadata(metadata);
    }
}

contract MockForwarderTest is Test {
    MockForwarder forwarder;
    RecordingReceiver receiver;
    address transmitter = makeAddr("transmitter");
    address workflowOwner = makeAddr("workflowOwner");
    bytes32 constant WID = keccak256("wf");

    function setUp() public {
        forwarder = new MockForwarder();
        forwarder.setTransmitter(transmitter, true);
        receiver = new RecordingReceiver(address(forwarder));
    }

    function test_deliver_callsOnReport() public {
        vm.expectEmit(address(forwarder));
        emit MockForwarder.ReportProcessed(address(receiver), WID, bytes2(0x0001), true);
        vm.prank(transmitter);
        forwarder.deliver(address(receiver), WID, bytes10("abcdefghij"), workflowOwner, bytes2(0x0001), hex"c0ffee");
        assertEq(receiver.lastReport(), hex"c0ffee");
    }

    function test_metadataLayoutMatchesReceiverTemplate() public view {
        bytes memory metadata = abi.encodePacked(WID, bytes10("abcdefghij"), workflowOwner, bytes2(0x0001));
        assertEq(metadata.length, 64);
        (bytes32 id, bytes10 name, address owner) = receiver.decode(metadata);
        assertEq(id, WID);
        assertEq(name, bytes10("abcdefghij"));
        assertEq(owner, workflowOwner);
    }

    function test_workflowIdentityChecksSeeForwardedMetadata() public {
        receiver.setExpectedAuthor(workflowOwner);
        receiver.setExpectedWorkflowName("veil8004-w1");
        bytes10 name = forwarder.workflowNameOf("veil8004-w1");
        assertEq(name, receiver.getExpectedWorkflowName());

        vm.prank(transmitter);
        forwarder.deliver(address(receiver), WID, name, workflowOwner, bytes2(0), hex"01");

        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.InvalidAuthor.selector, address(this), workflowOwner));
        vm.prank(transmitter);
        forwarder.deliver(address(receiver), WID, name, address(this), bytes2(0), hex"01");
    }

    function test_deliver_nonTransmitterReverts() public {
        vm.expectRevert(abi.encodeWithSelector(MockForwarder.NotTransmitter.selector, address(this)));
        forwarder.deliver(address(receiver), WID, bytes10(0), workflowOwner, bytes2(0), hex"01");
    }

    function test_deliver_nonReceiverReverts() public {
        vm.expectRevert(abi.encodeWithSelector(MockForwarder.ReceiverNotSupported.selector, address(this)));
        vm.prank(transmitter);
        forwarder.deliver(address(this), WID, bytes10(0), workflowOwner, bytes2(0), hex"01");
    }

    function test_setTransmitter_ownerOnly() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, transmitter));
        vm.prank(transmitter);
        forwarder.setTransmitter(transmitter, false);
    }
}
