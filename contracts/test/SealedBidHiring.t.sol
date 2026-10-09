// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReceiverTemplate} from "@chainlink/cre/ReceiverTemplate.sol";
import {IVeilGate} from "../src/interfaces/IVeilGate.sol";
import {SealedBidHiring} from "../src/consumers/SealedBidHiring.sol";
import {HiringFixture} from "./utils/HiringFixture.sol";

contract SealedBidHiringTest is HiringFixture {
    bytes32 constant SALT_A = keccak256("salt a");
    bytes32 constant SALT_B = keccak256("salt b");
    bytes32 constant SALT_C = keccak256("salt c");

    // ---- postTask ------------------------------------------------------------------------------

    function test_postTask_storesAndEmits() public {
        uint64 deadline = uint64(block.timestamp + BIDDING_PERIOD);
        vm.expectEmit(address(hiring));
        emit SealedBidHiring.TaskPosted(1, client, QUALIFIED, CATEGORY, deadline, CLIENT_IDENTITY);
        uint256 taskId = post();
        assertEq(taskId, 1);
        SealedBidHiring.Task memory t = hiring.getTask(taskId);
        assertEq(t.client, client);
        assertEq(t.policyId, QUALIFIED);
        assertEq(t.category, CATEGORY);
        assertEq(t.deadline, deadline);
        assertEq(t.identityCommitment, CLIENT_IDENTITY);
        assertEq(uint8(t.status), uint8(SealedBidHiring.TaskStatus.Open));
        assertEq(post(), 2);
    }

    function test_postTask_revertsOnInactiveOrUnknownPolicy() public {
        vm.expectRevert(abi.encodeWithSelector(SealedBidHiring.PolicyInactive.selector, keccak256("NOPE")));
        hiring.postTask(keccak256("NOPE"), CATEGORY, uint64(block.timestamp + 1), 0);
        vm.prank(policyOwner);
        policies.setActive(QUALIFIED, false);
        vm.expectRevert(abi.encodeWithSelector(SealedBidHiring.PolicyInactive.selector, QUALIFIED));
        hiring.postTask(QUALIFIED, CATEGORY, uint64(block.timestamp + 1), 0);
    }

    function test_postTask_revertsOnPastDeadline() public {
        vm.expectRevert(abi.encodeWithSelector(SealedBidHiring.DeadlineNotInFuture.selector, uint64(block.timestamp)));
        hiring.postTask(QUALIFIED, CATEGORY, uint64(block.timestamp), 0);
    }

    // ---- bid: the gate -------------------------------------------------------------------------

    function test_unattestedAgentCannotBid() public {
        uint256 taskId = post();
        vm.prank(unattestedOwner);
        vm.expectRevert(IVeilGate.NotAttested.selector);
        hiring.bid(taskId, unattested, bidCommit(taskId, unattested, 1, SALT_A));
    }

    function test_failedAttestationCannotBid() public {
        attest(unattestedOwner, unattested, false);
        uint256 taskId = post();
        vm.prank(unattestedOwner);
        vm.expectRevert(IVeilGate.NotAttested.selector);
        hiring.bid(taskId, unattested, bidCommit(taskId, unattested, 1, SALT_A));
    }

    function test_laterFailRevokesEarlierPass() public {
        attest(bidderOwners[0], bidders[0], false);
        uint256 taskId = post();
        vm.prank(bidderOwners[0]);
        vm.expectRevert(IVeilGate.NotAttested.selector);
        hiring.bid(taskId, bidders[0], bidCommit(taskId, bidders[0], 1, SALT_A));
    }

    function test_attestationUnderAnotherPolicyCannotBid() public {
        recorded(unattestedOwner, unattested, SANCTIONS, "Northwind Trading LLC", SALT_A, true);
        uint256 taskId = post();
        vm.prank(unattestedOwner);
        vm.expectRevert(IVeilGate.NotAttested.selector);
        hiring.bid(taskId, unattested, bidCommit(taskId, unattested, 1, SALT_A));
    }

    function test_expiredAttestationCannotBid() public {
        vm.prank(client);
        uint256 taskId = hiring.postTask(QUALIFIED, CATEGORY, uint64(block.timestamp + 2 * WINDOW), 0);
        vm.warp(registry.getRequest(registry.latestRequest(bidders[0], QUALIFIED)).expiry);
        vm.prank(bidderOwners[0]);
        vm.expectRevert(IVeilGate.NotAttested.selector);
        hiring.bid(taskId, bidders[0], bidCommit(taskId, bidders[0], 1, SALT_A));
    }

    function test_nonControllerCannotBid() public {
        uint256 taskId = post();
        vm.prank(stranger);
        vm.expectRevert(IVeilGate.NotAgentController.selector);
        hiring.bid(taskId, bidders[0], bidCommit(taskId, bidders[0], 1, SALT_A));
    }

    function test_agentWalletCanBid() public {
        (address wallet, uint256 walletKey) = makeAddrAndKey("aliceAgentWallet");
        _setAgentWallet(bidders[0], bidderOwners[0], wallet, walletKey);
        uint256 taskId = post();
        placeBid(wallet, taskId, bidders[0], 1, SALT_A);
        assertEq(hiring.bidCommitmentOf(taskId, bidders[0]), bidCommit(taskId, bidders[0], 1, SALT_A));
    }

    function test_bidOnUnknownTaskReverts() public {
        vm.prank(bidderOwners[0]);
        vm.expectRevert(IVeilGate.NotAttested.selector); // the unknown task has no policy, so nobody holds it
        hiring.bid(99, bidders[0], bytes32(uint256(1)));
    }

    // ---- bid: rules ----------------------------------------------------------------------------

    function test_bidsStoredInOrderAndEmitted() public {
        uint256 taskId = post();
        bytes32 c1 = bidCommit(taskId, bidders[1], 300, SALT_B);
        vm.expectEmit(address(hiring));
        emit SealedBidHiring.BidPlaced(taskId, bidders[1], c1);
        placeBid(bidderOwners[1], taskId, bidders[1], 300, SALT_B);
        bytes32 c0 = placeBid(bidderOwners[0], taskId, bidders[0], 400, SALT_A);
        SealedBidHiring.Bid[] memory bids = hiring.getBids(taskId);
        assertEq(bids.length, 2);
        assertEq(bids[0].agentId, bidders[1]);
        assertEq(bids[0].commitment, c1);
        assertEq(bids[1].agentId, bidders[0]);
        assertEq(bids[1].commitment, c0);
    }

    function test_deadlineEnforced() public {
        uint256 taskId = post();
        uint64 deadline = hiring.getTask(taskId).deadline;
        vm.warp(deadline - 1);
        placeBid(bidderOwners[0], taskId, bidders[0], 1, SALT_A); // last second: accepted
        vm.warp(deadline);
        vm.prank(bidderOwners[1]);
        vm.expectRevert(abi.encodeWithSelector(SealedBidHiring.BiddingOver.selector, taskId, deadline));
        hiring.bid(taskId, bidders[1], bidCommit(taskId, bidders[1], 1, SALT_B));
    }

    function test_duplicateBidRejected() public {
        uint256 taskId = post();
        placeBid(bidderOwners[0], taskId, bidders[0], 500, SALT_A);
        vm.prank(bidderOwners[0]);
        vm.expectRevert(abi.encodeWithSelector(SealedBidHiring.AlreadyBid.selector, taskId, bidders[0]));
        hiring.bid(taskId, bidders[0], bidCommit(taskId, bidders[0], 100, SALT_B)); // a different, lower price
        assertEq(hiring.getBids(taskId).length, 1);
    }

    function test_zeroCommitmentRejected() public {
        uint256 taskId = post();
        vm.prank(bidderOwners[0]);
        vm.expectRevert(SealedBidHiring.ZeroCommitment.selector);
        hiring.bid(taskId, bidders[0], bytes32(0));
    }

    function test_bidOnClosedTaskRejected() public {
        uint256 taskId = post();
        close(taskId);
        vm.prank(bidderOwners[0]);
        vm.expectRevert(abi.encodeWithSelector(SealedBidHiring.TaskNotOpen.selector, taskId));
        hiring.bid(taskId, bidders[0], bidCommit(taskId, bidders[0], 1, SALT_A));
    }

    // ---- closeBidding --------------------------------------------------------------------------

    function test_closeBidding_onlyAfterDeadline_byAnyone() public {
        uint256 taskId = post();
        placeBid(bidderOwners[0], taskId, bidders[0], 1, SALT_A);
        placeBid(bidderOwners[1], taskId, bidders[1], 2, SALT_B);
        uint64 deadline = hiring.getTask(taskId).deadline;
        vm.warp(deadline - 1);
        vm.expectRevert(abi.encodeWithSelector(SealedBidHiring.BiddingNotOver.selector, taskId, deadline));
        hiring.closeBidding(taskId);

        vm.warp(deadline);
        vm.expectEmit(address(hiring));
        emit SealedBidHiring.BiddingClosed(taskId, 2);
        vm.prank(stranger);
        hiring.closeBidding(taskId);
        assertEq(uint8(hiring.getTask(taskId).status), uint8(SealedBidHiring.TaskStatus.Closed));

        vm.expectRevert(abi.encodeWithSelector(SealedBidHiring.TaskNotOpen.selector, taskId));
        hiring.closeBidding(taskId);
        vm.expectRevert(abi.encodeWithSelector(SealedBidHiring.TaskNotOpen.selector, 99));
        hiring.closeBidding(99);
    }

    // ---- W3 report -----------------------------------------------------------------------------

    /// @dev Three bids (500, 300, 400); returns the task and the leaves.
    function _threeBids() internal returns (uint256 taskId, bytes32[3] memory leaves) {
        taskId = post();
        bytes32 c0 = placeBid(bidderOwners[0], taskId, bidders[0], 500, SALT_A);
        bytes32 c1 = placeBid(bidderOwners[1], taskId, bidders[1], 300, SALT_B);
        bytes32 c2 = placeBid(bidderOwners[2], taskId, bidders[2], 400, SALT_C);
        leaves = [leaf(taskId, bidders[0], c0), leaf(taskId, bidders[1], c1), leaf(taskId, bidders[2], c2)];
        close(taskId);
    }

    function test_lowestValidBid_awarded() public {
        (uint256 taskId, bytes32[3] memory l) = _threeBids();
        bytes32 root = _root3(l);
        vm.expectEmit(address(hiring));
        emit SealedBidHiring.JobAwarded(taskId, bidders[1], 300, 3, root);
        deliverW3(w3Report(taskId, bidders[1], 300, SALT_B, 3, root));

        SealedBidHiring.Award memory a = hiring.getAward(taskId);
        assertEq(a.winnerAgentId, bidders[1]);
        assertEq(a.winningPrice, 300);
        assertEq(a.validBidCount, 3);
        assertEq(a.merkleRoot, root);
        assertEq(uint8(hiring.getTask(taskId).status), uint8(SealedBidHiring.TaskStatus.Awarded));
    }

    function test_report_winnerMustOpenItsCommitment() public {
        (uint256 taskId, bytes32[3] memory l) = _threeBids();
        bytes32 root = _root3(l);
        bytes memory err = abi.encodeWithSelector(SealedBidHiring.WinnerCommitmentMismatch.selector, taskId, bidders[1]);
        // wrong price (W3 cannot lower the winner's price)
        vm.expectRevert(err);
        deliverW3(w3Report(taskId, bidders[1], 299, SALT_B, 3, root));
        // wrong salt
        vm.expectRevert(err);
        deliverW3(w3Report(taskId, bidders[1], 300, SALT_A, 3, root));
        // an agent that never bid
        vm.expectRevert(abi.encodeWithSelector(SealedBidHiring.WinnerCommitmentMismatch.selector, taskId, unattested));
        deliverW3(w3Report(taskId, unattested, 0, bytes32(0), 3, root));
    }

    function test_mismatchedBid_cannotWin_andIsNotIncluded() public {
        // bidders[1] committed to 300 but its sealed opening says 100: W3 drops it and counts the other two.
        (uint256 taskId, bytes32[3] memory l) = _threeBids();
        vm.expectRevert(abi.encodeWithSelector(SealedBidHiring.WinnerCommitmentMismatch.selector, taskId, bidders[1]));
        deliverW3(w3Report(taskId, bidders[1], 100, SALT_B, 3, _root3(l)));

        bytes32 root = pairRoot(l[0], l[2]);
        deliverW3(w3Report(taskId, bidders[2], 400, SALT_C, 2, root));
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = l[2];
        assertTrue(hiring.verifyInclusion(taskId, bidders[0], proof));
        proof[0] = l[0];
        assertTrue(hiring.verifyInclusion(taskId, bidders[2], proof));
        // the dropped bid is not in the tree, whatever proof it offers
        assertFalse(hiring.verifyInclusion(taskId, bidders[1], proof));
        proof[0] = l[2];
        assertFalse(hiring.verifyInclusion(taskId, bidders[1], proof));
        assertFalse(hiring.verifyInclusion(taskId, bidders[1], new bytes32[](0)));
    }

    function test_report_beforeCloseRejected() public {
        uint256 taskId = post();
        placeBid(bidderOwners[0], taskId, bidders[0], 1, SALT_A);
        vm.expectRevert(abi.encodeWithSelector(SealedBidHiring.TaskNotClosed.selector, taskId));
        deliverW3(w3Report(taskId, bidders[0], 1, SALT_A, 1, bytes32(uint256(1))));
    }

    function test_awardIsFinal() public {
        (uint256 taskId, bytes32[3] memory l) = _threeBids();
        bytes32 root = _root3(l);
        bytes memory report = w3Report(taskId, bidders[1], 300, SALT_B, 3, root);
        deliverW3(report);

        vm.expectRevert(abi.encodeWithSelector(SealedBidHiring.TaskNotClosed.selector, taskId));
        deliverW3(report); // replay
        vm.expectRevert(abi.encodeWithSelector(SealedBidHiring.TaskNotClosed.selector, taskId));
        deliverW3(w3Report(taskId, bidders[2], 400, SALT_C, 3, root)); // a different, also valid opening
        vm.expectRevert(abi.encodeWithSelector(SealedBidHiring.TaskNotClosed.selector, taskId));
        deliverW3(w3Report(taskId, 0, 0, bytes32(0), 0, bytes32(0))); // a NoAward after the award
        vm.expectRevert(abi.encodeWithSelector(SealedBidHiring.TaskNotOpen.selector, taskId));
        hiring.closeBidding(taskId);

        assertEq(hiring.getAward(taskId).winnerAgentId, bidders[1]);
        assertEq(hiring.getAward(taskId).winningPrice, 300);
    }

    function test_report_tooManyValidBids() public {
        (uint256 taskId, bytes32[3] memory l) = _threeBids();
        vm.expectRevert(abi.encodeWithSelector(SealedBidHiring.TooManyValidBids.selector, uint32(4), uint256(3)));
        deliverW3(w3Report(taskId, bidders[1], 300, SALT_B, 4, _root3(l)));
    }

    function test_report_zeroRootRejected() public {
        (uint256 taskId,) = _threeBids();
        vm.expectRevert(SealedBidHiring.ZeroMerkleRoot.selector);
        deliverW3(w3Report(taskId, bidders[1], 300, SALT_B, 3, bytes32(0)));
    }

    function test_noValidBid_noAward_final() public {
        (uint256 taskId,) = _threeBids();
        vm.expectEmit(address(hiring));
        emit SealedBidHiring.NoAward(taskId);
        deliverW3(w3Report(taskId, 0, 0, bytes32(0), 0, bytes32(0)));
        assertEq(uint8(hiring.getTask(taskId).status), uint8(SealedBidHiring.TaskStatus.NoAward));
        assertFalse(hiring.verifyInclusion(taskId, bidders[0], new bytes32[](0)));

        vm.expectRevert(abi.encodeWithSelector(SealedBidHiring.TaskNotClosed.selector, taskId));
        deliverW3(w3Report(taskId, bidders[1], 300, SALT_B, 3, bytes32(uint256(1))));
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(SealedBidHiring.TaskNotAwarded.selector, taskId));
        hiring.markCompleted(taskId);
    }

    function test_noBids_closeThenNoAward() public {
        uint256 taskId = post();
        vm.expectEmit(address(hiring));
        emit SealedBidHiring.BiddingClosed(taskId, 0);
        close(taskId);
        deliverW3(w3Report(taskId, 0, 0, bytes32(0), 0, bytes32(0)));
        assertEq(uint8(hiring.getTask(taskId).status), uint8(SealedBidHiring.TaskStatus.NoAward));
    }

    function test_report_onlyFromForwarderAndW3() public {
        (uint256 taskId, bytes32[3] memory l) = _threeBids();
        bytes memory report = w3Report(taskId, bidders[1], 300, SALT_B, 3, _root3(l));

        bytes memory metadata = abi.encodePacked(W3_ID, W3_NAME, workflowOwner, bytes2(0x0003));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.InvalidSender.selector, stranger, address(forwarder)));
        hiring.onReport(metadata, report);

        // W1's reports are not accepted here
        vm.prank(transmitter);
        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.InvalidWorkflowId.selector, W1_ID, W3_ID));
        forwarder.deliver(address(hiring), W1_ID, W1_NAME, workflowOwner, bytes2(0x0001), report);

        // and W3's are not accepted by the validation registry
        vm.prank(transmitter);
        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.InvalidWorkflowId.selector, W3_ID, W1_ID));
        forwarder.deliver(address(registry), W3_ID, W3_NAME, workflowOwner, bytes2(0x0003), report);
    }

    // ---- inclusion and completion --------------------------------------------------------------

    function test_verifyInclusion_threeLeaves() public {
        (uint256 taskId, bytes32[3] memory l) = _threeBids();
        deliverW3(w3Report(taskId, bidders[1], 300, SALT_B, 3, _root3(l)));
        for (uint256 i; i < 3; i++) {
            assertTrue(hiring.verifyInclusion(taskId, bidders[i], _proof3(l, i)), "counted bid included");
        }
        assertFalse(hiring.verifyInclusion(taskId, bidders[0], _proof3(l, 1)), "wrong proof");
        assertFalse(hiring.verifyInclusion(taskId, unattested, _proof3(l, 0)), "non-bidder");
    }

    function test_verifyInclusion_falseBeforeAward() public {
        (uint256 taskId, bytes32[3] memory l) = _threeBids();
        assertFalse(hiring.verifyInclusion(taskId, bidders[0], _proof3(l, 0)));
    }

    function test_markCompleted() public {
        (uint256 taskId, bytes32[3] memory l) = _threeBids();
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(SealedBidHiring.TaskNotAwarded.selector, taskId));
        hiring.markCompleted(taskId);
        deliverW3(w3Report(taskId, bidders[1], 300, SALT_B, 3, _root3(l)));

        vm.prank(bidderOwners[1]);
        vm.expectRevert(abi.encodeWithSelector(SealedBidHiring.NotClient.selector, bidderOwners[1]));
        hiring.markCompleted(taskId);

        vm.expectEmit(address(hiring));
        emit SealedBidHiring.JobCompleted(taskId, bidders[1], CATEGORY, CLIENT_IDENTITY);
        vm.prank(client);
        hiring.markCompleted(taskId);
        assertEq(uint8(hiring.getTask(taskId).status), uint8(SealedBidHiring.TaskStatus.Completed));
        assertTrue(hiring.verifyInclusion(taskId, bidders[0], _proof3(l, 0)), "inclusion still verifiable");

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(SealedBidHiring.TaskNotAwarded.selector, taskId));
        hiring.markCompleted(taskId);
    }

    // ---- cross-language vectors (test/vectors/bids.json) ---------------------------------------

    function test_bidCommitmentMatchesVectors() public view {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/test/vectors/bids.json"));
        for (uint256 i; i < 4; i++) {
            string memory p = string.concat(".vectors[", vm.toString(i), "]");
            uint256 taskId = vm.parseUint(vm.parseJsonString(json, string.concat(p, ".taskId")));
            uint256 agent = vm.parseUint(vm.parseJsonString(json, string.concat(p, ".agentId")));
            uint256 price = vm.parseUint(vm.parseJsonString(json, string.concat(p, ".price")));
            bytes32 salt = vm.parseJsonBytes32(json, string.concat(p, ".salt"));
            bytes32 c = vm.parseJsonBytes32(json, string.concat(p, ".commitment"));
            assertEq(bidCommit(taskId, agent, price, salt), c, "commitment");
            assertEq(leaf(taskId, agent, c), vm.parseJsonBytes32(json, string.concat(p, ".leaf")), "leaf");
        }
    }

    /// @dev The tree in bids.json was built by @openzeppelin/merkle-tree (the library W3 uses). Agents 0 and 1 are
    ///      VeilFixture's, agent 2 is the first bidder; task 1 is the first task. Vector 0 is a real opening of
    ///      agent 0's leaf, so it can win.
    function test_verifyInclusion_typescriptTree() public {
        assertEq(bidders[0], 2);
        attest(agentOwner, agentId, true);
        attest(stranger, otherAgentId, true);
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/test/vectors/bids.json"));
        uint256 taskId = post();
        assertEq(taskId, vm.parseUint(vm.parseJsonString(json, ".tree.taskId")));

        address[3] memory owners = [agentOwner, stranger, bidderOwners[0]];
        for (uint256 i; i < 3; i++) {
            string memory p = string.concat(".tree.leaves[", vm.toString(i), "]");
            uint256 agent = vm.parseUint(vm.parseJsonString(json, string.concat(p, ".agentId")));
            vm.prank(owners[i]);
            hiring.bid(taskId, agent, vm.parseJsonBytes32(json, string.concat(p, ".commitment")));
        }
        close(taskId);
        bytes32 root = vm.parseJsonBytes32(json, ".tree.root");
        deliverW3(w3Report(taskId, 0, 3100, bytes32(uint256(0x1111111111111111111111111111111111111111111111111111111111111111)), 3, root));

        for (uint256 i; i < 3; i++) {
            string memory p = string.concat(".tree.leaves[", vm.toString(i), "]");
            uint256 agent = vm.parseUint(vm.parseJsonString(json, string.concat(p, ".agentId")));
            bytes32[] memory proof = vm.parseJsonBytes32Array(json, string.concat(p, ".proof"));
            assertTrue(hiring.verifyInclusion(taskId, agent, proof), "TypeScript proof verifies on-chain");
        }
    }

    // ---- helpers -------------------------------------------------------------------------------

    /// @dev StandardMerkleTree layout for 3 leaves (sorted ascending into tree[4], tree[3], tree[2]): the two smallest
    ///      pair up in tree[1], and root = hash(tree[1], largest). `_sorted` returns them largest first.
    function _sorted(bytes32[3] memory l) internal pure returns (bytes32[3] memory s) {
        (s[0], s[1], s[2]) = (l[0], l[1], l[2]); // copy: `s = l` would alias and sort the caller's array
        for (uint256 i; i < 3; i++) {
            for (uint256 j = i + 1; j < 3; j++) {
                if (s[j] > s[i]) (s[i], s[j]) = (s[j], s[i]);
            }
        }
    }

    function _root3(bytes32[3] memory l) internal pure returns (bytes32) {
        bytes32[3] memory s = _sorted(l);
        return pairRoot(pairRoot(s[1], s[2]), s[0]);
    }

    function _proof3(bytes32[3] memory l, uint256 i) internal pure returns (bytes32[] memory proof) {
        bytes32[3] memory s = _sorted(l);
        if (l[i] == s[0]) {
            proof = new bytes32[](1);
            proof[0] = pairRoot(s[1], s[2]);
        } else {
            proof = new bytes32[](2);
            proof[0] = l[i] == s[1] ? s[2] : s[1];
            proof[1] = s[0];
        }
    }
}
