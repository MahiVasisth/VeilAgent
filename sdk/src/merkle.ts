// Counted-bids Merkle tree (Phase 3). OpenZeppelin StandardMerkleTree over [taskId, agentId, bidCommitment] with types
// ["uint256", "uint256", "bytes32"], one leaf per bid W3 counted. SealedBidHiring.verifyInclusion rebuilds the leaf
// from the stored commitment and checks it with MerkleProof.verify. Leaves are sorted, so the tree (and its root)
// depends only on the set of counted bids, not on their order.
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { Hex } from "viem";

export const BID_LEAF_ENCODING = ["uint256", "uint256", "bytes32"];
export const ZERO_ROOT = `0x${"00".repeat(32)}` as Hex;

export type BidLeaf = { agentId: bigint; commitment: Hex };
type LeafValue = [bigint, bigint, Hex];
export type BidTree = StandardMerkleTree<LeafValue>;

const leafValue = (taskId: bigint, b: BidLeaf): LeafValue => [taskId, b.agentId, b.commitment.toLowerCase() as Hex];

/** The tree over the counted bids of `taskId`. Throws on an empty list (there is no tree: the root is zero). */
export function buildBidTree(taskId: bigint, counted: readonly BidLeaf[]): BidTree {
  if (counted.length === 0) throw new Error("no counted bids: nothing to build");
  return StandardMerkleTree.of(counted.map((b) => leafValue(taskId, b)), BID_LEAF_ENCODING);
}

/** Root of the counted-bids tree, or zero when no bid was counted. */
export function bidTreeRoot(taskId: bigint, counted: readonly BidLeaf[]): Hex {
  return counted.length === 0 ? ZERO_ROOT : (buildBidTree(taskId, counted).root as Hex);
}

/** Inclusion proof for one counted bid. Throws if the bid is not a leaf of `tree`. */
export function bidInclusionProof(tree: BidTree, taskId: bigint, bid: BidLeaf): Hex[] {
  return tree.getProof(leafValue(taskId, bid)) as Hex[];
}

/** Off-chain check of what SealedBidHiring.verifyInclusion checks on-chain. */
export function verifyBidInclusion(root: Hex, taskId: bigint, bid: BidLeaf, proof: Hex[]): boolean {
  return StandardMerkleTree.verify(root, BID_LEAF_ENCODING, leafValue(taskId, bid), proof);
}

/**
 * Rebuilds W3's counted-bids tree from public data only: the on-chain bids, the award's validBidCount and root.
 * When every bid was counted this is one tree; otherwise it searches the subsets of size validBidCount (the chain does
 * not say which bids W3 dropped). Returns null if no subset matches, or if the search would exceed `maxTries`.
 */
export function reconstructBidTree(
  taskId: bigint,
  bids: readonly BidLeaf[],
  validBidCount: number,
  root: Hex,
  maxTries = 1 << 16,
): BidTree | null {
  if (validBidCount <= 0 || validBidCount > bids.length) return null;
  let tries = 0;
  for (const subset of combinations(bids, validBidCount)) {
    if (++tries > maxTries) return null;
    const tree = buildBidTree(taskId, subset);
    if (tree.root.toLowerCase() === root.toLowerCase()) return tree;
  }
  return null;
}

function* combinations<T>(items: readonly T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) {
    yield [...acc];
    return;
  }
  for (let i = start; i <= items.length - (k - acc.length); i++) {
    acc.push(items[i]!);
    yield* combinations(items, k, i + 1, acc);
    acc.pop();
  }
}
