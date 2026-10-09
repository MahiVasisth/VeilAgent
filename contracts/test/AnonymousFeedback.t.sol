// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {ReceiptsFixture} from "./utils/ReceiptsFixture.sol";
import {AnonymousFeedback} from "../src/receipts/AnonymousFeedback.sol";
import {NullifierRegistry} from "../src/receipts/NullifierRegistry.sol";
import {ReceiptGroupManager} from "../src/receipts/ReceiptGroupManager.sol";
import {IVeilFeedback} from "../src/interfaces/IVeilReceipts.sol";
import {BytesSearch} from "./utils/BytesSearch.sol";
import {Vm} from "forge-std/Vm.sol";

/// @notice Anonymous feedback (Phase 5, Flow D steps 3-5) with real Semaphore proofs from test/vectors/feedback.json.
///         Exit criteria covered here: a rating is accepted, a second one in the same epoch is rejected, and the
///         aggregate is readable through the Reputation Registry.
contract AnonymousFeedbackTest is ReceiptsFixture {
    function setUp() public override {
        super.setUp();
        scenario();
    }

    function test_ratingsAreAcceptedAggregatedAndAnchored() public {
        vm.warp(epochStart(epoch + 1) + 100); // epoch over, rating window open

        vm.expectEmit(true, true, true, true, address(feedback));
        emit IVeilFeedback.FeedbackSubmitted(alice, epoch, CATEGORY, 5, proofOf("early").nullifier);
        rate(alice, CATEGORY, proofOf("early")); // built against the 1-member root, replaced since (S-1)
        rate(alice, CATEGORY, proofOf("alice2"));
        rate(bob, CATEGORY, proofOf("bob"));
        (uint256 sum, uint256 count) = feedback.aggregate(alice, epoch);
        assertEq(sum, 9);
        assertEq(count, 2);

        uint256 closesAt = receipts.ratingClosesAt(epoch);
        vm.expectRevert(abi.encodeWithSelector(AnonymousFeedback.RatingStillOpen.selector, epoch, closesAt));
        feedback.anchor(alice, epoch);

        vm.warp(closesAt);
        vm.expectEmit(true, true, true, true, address(feedback));
        emit IVeilFeedback.FeedbackAnchored(alice, epoch, 450, 2);
        feedback.anchor(alice, epoch);
        feedback.anchor(bob, epoch);
        assertTrue(feedback.anchored(alice, epoch));

        address[] memory from = new address[](1);
        from[0] = address(feedback);
        (uint64 n, int128 value, uint8 decimals) = reputation.getSummary(alice, from, "veil8004", "anon-aggregate");
        assertEq(n, 1);
        assertEq(value, 450); // 4.50
        assertEq(decimals, 2);
        (, value,) = reputation.getSummary(bob, from, "veil8004", "anon-aggregate");
        assertEq(value, 400);

        vm.expectRevert(abi.encodeWithSelector(AnonymousFeedback.AlreadyAnchored.selector, alice, epoch));
        feedback.anchor(alice, epoch);
        vm.expectRevert(abi.encodeWithSelector(AnonymousFeedback.NoRatings.selector, carol, epoch));
        feedback.anchor(carol, epoch);
    }

    function test_ratingDuringTheEpochIsAccepted() public {
        rate(bob, CATEGORY, proofOf("bob"));
        (, uint256 count) = feedback.aggregate(bob, epoch);
        assertEq(count, 1);
    }

    function test_secondRatingSameAgentSameEpochIsRejected() public {
        rate(alice, CATEGORY, proofOf("early"));
        vm.expectRevert(ISemaphore.Semaphore__YouAreUsingTheSameNullifierTwice.selector);
        rate(alice, CATEGORY, proofOf("again")); // same client, new proof, new score, same group
    }

    /// S-2: the same client also holds a KYC receipt. Semaphore alone would accept a second rating of alice from that
    ///      group; the NullifierRegistry context (agentId, epoch) rejects it.
    function test_S2_secondRatingFromAnotherCategoryIsRejected() public {
        uint256 snap = vm.snapshotState();
        rate(alice, KYC, proofOf("crossGroup")); // on its own, a valid rating
        vm.revertToState(snap);

        rate(alice, CATEGORY, proofOf("early"));
        bytes32 ctx = feedback.nullifierContext(alice, epoch);
        uint256 nullifier = proofOf("crossGroup").nullifier;
        assertTrue(nullifiers.isUsed(ctx, nullifier));
        vm.expectRevert(abi.encodeWithSelector(NullifierRegistry.NullifierAlreadyUsed.selector, ctx, nullifier));
        rate(alice, KYC, proofOf("crossGroup"));
    }

    function test_agentWithoutACompletedJobCannotBeRated() public {
        vm.expectRevert(abi.encodeWithSelector(AnonymousFeedback.AgentNotInGroup.selector, carol, CATEGORY, epoch));
        rate(carol, CATEGORY, proofOf("carol")); // a valid membership proof, but carol had no job in this group
        vm.expectRevert(abi.encodeWithSelector(AnonymousFeedback.AgentNotInGroup.selector, bob, KYC, epoch));
        rate(bob, KYC, proofOf("crossGroup"));
    }

    function test_outsiderCannotRate() public {
        vm.expectRevert(ISemaphore.Semaphore__MerkleTreeRootIsNotPartOfTheGroup.selector);
        rate(alice, CATEGORY, proofOf("forged")); // client 3 has no receipt; its proof is for a group not on-chain
    }

    function test_scopeBindsAgentAndEpoch() public {
        ISemaphore.SemaphoreProof memory p = proofOf("alice2");
        vm.expectRevert(abi.encodeWithSelector(AnonymousFeedback.ScopeMismatch.selector, p.scope, feedback.scopeOf(bob, epoch)));
        rate(bob, CATEGORY, p); // an alice rating cannot be counted for bob
        assertEq(p.scope, feedback.scopeOf(alice, epoch));
    }

    function test_scoreMustBeOneToFiveAndIsBoundByTheProof() public {
        ISemaphore.SemaphoreProof memory p = proofOf("alice2");
        p.message = 6;
        vm.expectRevert(abi.encodeWithSelector(AnonymousFeedback.ScoreOutOfRange.selector, 6));
        rate(alice, CATEGORY, p);
        p.message = 0;
        vm.expectRevert(abi.encodeWithSelector(AnonymousFeedback.ScoreOutOfRange.selector, 0));
        rate(alice, CATEGORY, p);
        p.message = 5; // in range, but not the score the proof was made for (4)
        vm.expectRevert(ISemaphore.Semaphore__InvalidProof.selector);
        rate(alice, CATEGORY, p);
    }

    function test_ratingsCloseWithTheWindowAndAfterAnchoring() public {
        rate(alice, CATEGORY, proofOf("early"));
        uint256 closesAt = receipts.ratingClosesAt(epoch);
        vm.warp(closesAt);
        vm.expectRevert(abi.encodeWithSelector(AnonymousFeedback.RatingClosed.selector, epoch, closesAt));
        rate(alice, CATEGORY, proofOf("alice2"));
        feedback.anchor(alice, epoch);
        vm.expectRevert(abi.encodeWithSelector(AnonymousFeedback.AlreadyAnchored.selector, alice, epoch));
        rate(alice, CATEGORY, proofOf("alice2"));
    }

    function test_epochIsBoundByTheScope() public {
        // bob is also hired in epoch + 1; a rating made for epoch cannot be counted there.
        uint256 taskId = completedJob(clientAddrs[3], clientIds[3], KYC, 1); // takes about an hour: now in epoch + 1
        assertEq(receipts.currentEpoch(), epoch + 1);
        deliverW2(taskId);
        ISemaphore.SemaphoreProof memory p = proofOf("bob");
        vm.prank(makeAddr("relayer"));
        vm.expectRevert(abi.encodeWithSelector(AnonymousFeedback.ScopeMismatch.selector, p.scope, feedback.scopeOf(bob, epoch + 1)));
        feedback.submit(bob, KYC, epoch + 1, p);
    }

    /// Rater unlinkable to wallet: the rating's calldata and every log it emits carry no group member's identity
    /// commitment, and the sender is a relayer. The public facts are the agent, epoch, category, score and nullifier.
    function test_ratingCarriesNoIdentityCommitment() public {
        ISemaphore.SemaphoreProof memory p = proofOf("alice2"); // made by client 2
        bytes memory data = abi.encodeCall(feedback.submit, (alice, CATEGORY, epoch, p));
        vm.recordLogs();
        address relayer = makeAddr("relayer");
        vm.prank(relayer);
        (bool ok,) = address(feedback).call(data);
        assertTrue(ok);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes memory seen = data;
        for (uint256 i; i < logs.length; i++) {
            for (uint256 t; t < logs[i].topics.length; t++) seen = bytes.concat(seen, logs[i].topics[t]);
            seen = bytes.concat(seen, logs[i].data);
        }
        for (uint256 i; i < 3; i++) {
            assertFalse(BytesSearch.contains(seen, abi.encode(clientIds[i])), "a member's identity commitment leaked");
            assertFalse(BytesSearch.contains(seen, abi.encodePacked(clientAddrs[i])), "a client's address leaked");
        }
        assertTrue(BytesSearch.contains(seen, abi.encode(p.nullifier)), "the scan sees the nullifier (scanner works)");
    }

    function test_anchorIsAnonymousAggregateFromTheFeedbackContract() public {
        rate(alice, CATEGORY, proofOf("early"));
        vm.warp(receipts.ratingClosesAt(epoch));
        vm.prank(stranger); // anyone can anchor
        feedback.anchor(alice, epoch);
        assertEq(reputation.getLastIndex(alice, address(feedback)), 1);
        (int128 value, uint8 decimals, string memory tag1, string memory tag2, bool revoked) =
            reputation.readFeedback(alice, address(feedback), 1);
        assertEq(value, 500);
        assertEq(decimals, 2);
        assertEq(tag1, "veil8004");
        assertEq(tag2, "anon-aggregate");
        assertFalse(revoked);
    }
}

/// @notice NullifierRegistry on its own.
contract NullifierRegistryTest is ReceiptsFixture {
    function test_onlyConsumersConsumeOnce() public {
        bytes32 ctx = keccak256("ctx");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(NullifierRegistry.NotConsumer.selector, stranger));
        nullifiers.consume(ctx, 1);

        nullifiers.setConsumer(address(this), true);
        nullifiers.consume(ctx, 1);
        assertTrue(nullifiers.isUsed(ctx, 1));
        assertFalse(nullifiers.isUsed(ctx, 2));
        assertFalse(nullifiers.isUsed(keccak256("other"), 1));
        vm.expectRevert(abi.encodeWithSelector(NullifierRegistry.NullifierAlreadyUsed.selector, ctx, 1));
        nullifiers.consume(ctx, 1);
        nullifiers.consume(keccak256("other"), 1); // contexts are independent

        nullifiers.setConsumer(address(this), false);
        vm.expectRevert(abi.encodeWithSelector(NullifierRegistry.NotConsumer.selector, address(this)));
        nullifiers.consume(ctx, 3);
    }

    function test_onlyOwnerSetsConsumers() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", stranger));
        nullifiers.setConsumer(stranger, true);
    }
}
