// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {VeilFixture} from "./VeilFixture.sol";
import {IAssuranceTier} from "../../src/interfaces/IAssuranceTier.sol";
import {SealedBidHiring} from "../../src/consumers/SealedBidHiring.sol";

/// @notice Phase 3 setup on top of VeilFixture: the QUALIFIED_SCREENER_V1 policy, SealedBidHiring pinned to a local
///         W3 workflow id, three bidder agents that hold the policy (each attested at its owner's request) and one
///         agent that does not.
abstract contract HiringFixture is VeilFixture {
    bytes32 constant QUALIFIED = keccak256("QUALIFIED_SCREENER_V1");
    bytes32 constant CATEGORY = keccak256("sanctions-screening");
    bytes32 constant W3_ID = keccak256("veil8004.local.w3-bid-opener");
    bytes10 constant W3_NAME = bytes10("abcdef0123");
    uint256 constant CLIENT_IDENTITY = 0x1234;
    uint64 constant BIDDING_PERIOD = 1 hours;

    SealedBidHiring hiring;

    address[3] bidderOwners;
    uint256[3] bidders;
    address unattestedOwner = makeAddr("unattestedOwner");
    uint256 unattested;
    uint256 private _attestNonce;

    function setUp() public virtual override {
        super.setUp();
        vm.prank(policyOwner);
        policies.createPolicy(QUALIFIED, keccak256("qualified screener"), IAssuranceTier.Tier.Don, WINDOW, 0);

        hiring = new SealedBidHiring(address(forwarder), registry, identity, policies);
        hiring.setExpectedWorkflowId(W3_ID);

        string[3] memory names = ["alice", "bob", "carol"];
        for (uint256 i; i < 3; i++) {
            bidderOwners[i] = makeAddr(names[i]);
            vm.prank(bidderOwners[i]);
            bidders[i] = identity.register();
            attest(bidderOwners[i], bidders[i], true);
        }
        vm.prank(unattestedOwner);
        unattested = identity.register();
    }

    // ---- helpers -------------------------------------------------------------------------------

    /// @dev A QUALIFIED_SCREENER_V1 result for `agent`, requested by `owner` so it becomes the agent-level result.
    function attest(address owner, uint256 agent, bool passed) internal returns (bytes32) {
        bytes32 salt = keccak256(abi.encode("attest", agent, ++_attestNonce));
        return recorded(owner, agent, QUALIFIED, string.concat("QS-credential-", vm.toString(agent)), salt, passed);
    }

    function post() internal returns (uint256 taskId) {
        vm.prank(client);
        taskId = hiring.postTask(QUALIFIED, CATEGORY, uint64(block.timestamp + BIDDING_PERIOD), CLIENT_IDENTITY);
    }

    function bidCommit(uint256 taskId, uint256 agent, uint256 price, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(taskId, agent, price, salt));
    }

    function placeBid(address owner, uint256 taskId, uint256 agent, uint256 price, bytes32 salt)
        internal
        returns (bytes32 c)
    {
        c = bidCommit(taskId, agent, price, salt);
        vm.prank(owner);
        hiring.bid(taskId, agent, c);
    }

    function close(uint256 taskId) internal {
        vm.warp(hiring.getTask(taskId).deadline);
        hiring.closeBidding(taskId);
    }

    function leaf(uint256 taskId, uint256 agent, bytes32 c) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(taskId, agent, c))));
    }

    /// @dev Root of a two-leaf StandardMerkleTree (sorted pair hash).
    function pairRoot(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    function w3Report(uint256 taskId, uint256 winner, uint256 price, bytes32 salt, uint32 count, bytes32 root)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(taskId, winner, price, salt, count, root);
    }

    function deliverW3(bytes memory report) internal {
        vm.prank(transmitter);
        forwarder.deliver(address(hiring), W3_ID, W3_NAME, workflowOwner, bytes2(0x0003), report);
    }
}
