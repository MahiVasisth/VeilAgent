// Cross-language check for bids: bidCommitment and the Merkle leaves/tree must reproduce
// contracts/test/vectors/bids.json, which contracts/test/SealedBidHiring.t.sol also checks.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { Hex } from "viem";
import { bidStoreKey, buildBid, type BidOpening } from "./bids";
import { bidCommitment } from "./commitments";
import { bidInclusionProof, bidTreeRoot, BID_LEAF_ENCODING, buildBidTree, reconstructBidTree, verifyBidInclusion, ZERO_ROOT } from "./merkle";
import { generateKeyPair, open } from "./seal";

type Vector = { taskId: string; agentId: string; price: string; salt: Hex; commitment: Hex; leaf: Hex };
type TreeVector = { taskId: string; root: Hex; leaves: { agentId: string; commitment: Hex; proof: Hex[] }[] };
const file = JSON.parse(readFileSync(join(import.meta.dir, "../../contracts/test/vectors/bids.json"), "utf8")) as {
  vectors: Vector[];
  tree: TreeVector;
};

describe("bid commitments (vectors)", () => {
  test("vector file is present", () => expect(file.vectors.length).toBe(4));
  for (const v of file.vectors) {
    test(`matches Solidity encoding: task ${v.taskId}, agent ${v.agentId.slice(0, 12)}, price ${v.price.slice(0, 12)}`, () => {
      const c = bidCommitment({ taskId: BigInt(v.taskId), agentId: BigInt(v.agentId), price: BigInt(v.price), salt: v.salt });
      expect(c).toBe(v.commitment);
      expect(StandardMerkleTree.of([[v.taskId, v.agentId, c]], BID_LEAF_ENCODING).leafHash([v.taskId, v.agentId, c])).toBe(v.leaf);
    });
  }
  test("tree root and proofs match", () => {
    const t = file.tree;
    const leaves = t.leaves.map((l) => ({ agentId: BigInt(l.agentId), commitment: l.commitment }));
    const tree = buildBidTree(BigInt(t.taskId), leaves);
    expect(tree.root).toBe(t.root);
    t.leaves.forEach((l, i) => {
      expect(bidInclusionProof(tree, BigInt(t.taskId), leaves[i]!)).toEqual(l.proof);
      expect(verifyBidInclusion(t.root, BigInt(t.taskId), leaves[i]!, l.proof)).toBe(true);
    });
  });
});

describe("bids", () => {
  const W3 = generateKeyPair();

  test("buildBid seals {price, salt} to W3 and keys it by commitment", () => {
    const bid = buildBid({ taskId: 2n, agentId: 3n, price: 4217n, w3PublicKey: W3.publicKey });
    expect(bid.commitment).toBe(bidCommitment({ taskId: 2n, agentId: 3n, price: 4217n, salt: bid.salt }));
    expect(bid.storeKey).toBe(`bid:${bid.commitment}`);
    expect(open<BidOpening>(W3.secretKey, bid.sealed)).toEqual({ price: "4217", salt: bid.salt });
    expect(bidStoreKey(bid.commitment.toUpperCase().replace("0X", "0x") as Hex)).toBe(bid.storeKey);
    expect(buildBid({ taskId: 2n, agentId: 3n, price: 4217n, w3PublicKey: W3.publicKey }).salt).not.toBe(bid.salt);
    expect(() => buildBid({ taskId: 2n, agentId: 3n, price: -1n, w3PublicKey: W3.publicKey })).toThrow();
  });
});

describe("merkle", () => {
  const leaves = [1n, 2n, 3n, 4n].map((a) => ({ agentId: a, commitment: `0x${a.toString(16).padStart(64, "a")}` as Hex }));

  test("order of counted bids does not change the root; empty set is zero", () => {
    expect(bidTreeRoot(9n, leaves)).toBe(bidTreeRoot(9n, [...leaves].reverse()));
    expect(bidTreeRoot(9n, [])).toBe(ZERO_ROOT);
    expect(() => buildBidTree(9n, [])).toThrow();
  });

  test("a proof does not verify for another task, agent or commitment", () => {
    const tree = buildBidTree(9n, leaves);
    const proof = bidInclusionProof(tree, 9n, leaves[0]!);
    const root = tree.root as Hex;
    expect(verifyBidInclusion(root, 9n, leaves[0]!, proof)).toBe(true);
    expect(verifyBidInclusion(root, 8n, leaves[0]!, proof)).toBe(false);
    expect(verifyBidInclusion(root, 9n, { ...leaves[0]!, agentId: 7n }, proof)).toBe(false);
    expect(verifyBidInclusion(root, 9n, { ...leaves[0]!, commitment: leaves[1]!.commitment }, proof)).toBe(false);
  });

  test("reconstruct from public data: all counted, or a dropped subset", () => {
    const all = bidTreeRoot(9n, leaves);
    expect(reconstructBidTree(9n, leaves, 4, all)?.root).toBe(all);
    const without2 = [leaves[0]!, leaves[2]!, leaves[3]!];
    const root = bidTreeRoot(9n, without2);
    const tree = reconstructBidTree(9n, leaves, 3, root);
    expect(tree?.root).toBe(root);
    expect(() => bidInclusionProof(tree!, 9n, leaves[1]!)).toThrow(); // the dropped bid has no proof
    expect(reconstructBidTree(9n, leaves, 3, all)).toBeNull();
    expect(reconstructBidTree(9n, leaves, 0, all)).toBeNull();
    expect(reconstructBidTree(9n, leaves, 3, root, 1)).toBeNull(); // search cap
  });
});
