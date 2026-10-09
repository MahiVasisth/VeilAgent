// What any indexer can reconstruct about sealed-bid hiring (Phase 3), from public events and transactions only.
// fetchAuctionData does the I/O (including the on-chain inclusion checks); buildAuctionView is pure.
import { getAddress, keccak256, stringToBytes, type Address, type Hash, type Hex, type PublicClient } from "viem";
import { sealedBidHiringAbi } from "../abi/veil";
import type { Deployment } from "../deployments";
import { bidInclusionProof, reconstructBidTree } from "../merkle";
import { KNOWN_POLICY_NAMES } from "./veilView";
import { policyId } from "../commitments";

/** Category names an observer can label by hashing guesses (category is keccak256 of a public name). */
export const KNOWN_CATEGORIES = ["sanctions-screening", "compliance-screening"];

export type RawAuctionData = {
  tasks: {
    taskId: bigint;
    client: Address;
    policyId: Hex;
    category: Hex;
    deadline: bigint;
    identityCommitment: bigint;
    txHash: Hash;
  }[];
  bids: { taskId: bigint; agentId: bigint; commitment: Hex; bidder: Address; txHash: Hash }[];
  closed: { taskId: bigint; bidCount: bigint; closer: Address }[];
  awards: { taskId: bigint; winnerAgentId: bigint; winningPrice: bigint; validBidCount: number; merkleRoot: Hex; txHash: Hash }[];
  noAwards: { taskId: bigint }[];
  completed: { taskId: bigint }[];
  /** `${taskId}:${agentId}` -> result of SealedBidHiring.verifyInclusion with a proof rebuilt from public data. */
  inclusion: Record<string, boolean>;
  now: bigint;
};

export type AuctionBid = {
  agentId: bigint;
  agentName: string;
  bidder: Address;
  commitment: Hex;
  /** Counted by W3 (its leaf verifies on-chain), not counted, or unknown (no award yet / tree not rebuilt). */
  inclusion: "counted" | "not counted" | "unknown";
  winner: boolean;
};

export type AuctionTask = {
  taskId: bigint;
  client: Address;
  policyName: string | null;
  policyId: Hex;
  categoryName: string | null;
  category: Hex;
  deadline: bigint;
  status: "open" | "closed" | "awarded" | "no award" | "completed";
  bids: AuctionBid[];
  award: { winnerAgentId: bigint; winnerName: string; winningPrice: bigint; validBidCount: number; merkleRoot: Hex } | null;
};

export type AuctionView = { tasks: AuctionTask[]; leaks: string[]; hidden: string[] };

export async function fetchAuctionData(client: PublicClient, d: Deployment): Promise<RawAuctionData | null> {
  const hiring = d.veil?.sealedBidHiring;
  if (!hiring) return null;
  const range = { fromBlock: BigInt(d.startBlock), toBlock: "latest" } as const;
  const ev = <N extends "TaskPosted" | "BidPlaced" | "BiddingClosed" | "JobAwarded" | "NoAward" | "JobCompleted">(eventName: N) =>
    client.getContractEvents({ address: hiring, abi: sealedBidHiringAbi, eventName, ...range });
  const [posted, placed, closed, awarded, noAward, completed, block] = await Promise.all([
    ev("TaskPosted"),
    ev("BidPlaced"),
    ev("BiddingClosed"),
    ev("JobAwarded"),
    ev("NoAward"),
    ev("JobCompleted"),
    client.getBlock({ blockTag: "latest" }),
  ]);
  const sender = async (hash: Hash) => getAddress((await client.getTransaction({ hash })).from);

  const raw: RawAuctionData = {
    tasks: posted.map((l) => ({
      taskId: l.args.taskId!,
      client: l.args.client!,
      policyId: l.args.policyId!,
      category: l.args.category!,
      deadline: l.args.deadline!,
      identityCommitment: l.args.identityCommitment!,
      txHash: l.transactionHash,
    })),
    bids: await Promise.all(
      placed.map(async (l) => ({
        taskId: l.args.taskId!,
        agentId: l.args.agentId!,
        commitment: l.args.bidCommitment!,
        bidder: await sender(l.transactionHash),
        txHash: l.transactionHash,
      })),
    ),
    closed: await Promise.all(closed.map(async (l) => ({ taskId: l.args.taskId!, bidCount: l.args.bidCount!, closer: await sender(l.transactionHash) }))),
    awards: awarded.map((l) => ({
      taskId: l.args.taskId!,
      winnerAgentId: l.args.winnerAgentId!,
      winningPrice: l.args.winningPrice!,
      validBidCount: Number(l.args.validBidCount!),
      merkleRoot: l.args.merkleRoot!,
      txHash: l.transactionHash,
    })),
    noAwards: noAward.map((l) => ({ taskId: l.args.taskId! })),
    completed: completed.map((l) => ({ taskId: l.args.taskId! })),
    inclusion: {},
    now: block.timestamp,
  };

  // Inclusion check, as any loser can do it: rebuild W3's tree from the public bids and the award, then ask the
  // contract to verify each bid's proof.
  for (const a of raw.awards) {
    const bids = raw.bids.filter((b) => b.taskId === a.taskId);
    const tree = reconstructBidTree(a.taskId, bids, a.validBidCount, a.merkleRoot);
    if (!tree) continue; // cannot rebuild: inclusion stays unknown
    for (const b of bids) {
      let proof: Hex[] = [];
      try {
        proof = bidInclusionProof(tree, a.taskId, b);
      } catch {
        // not a leaf: W3 dropped it. The contract still gets asked, with an empty proof, and says no.
      }
      raw.inclusion[`${a.taskId}:${b.agentId}`] = await client.readContract({
        address: hiring,
        abi: sealedBidHiringAbi,
        functionName: "verifyInclusion",
        args: [a.taskId, b.agentId, proof],
      });
    }
  }
  return raw;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function buildAuctionView(raw: RawAuctionData, agentNames: Map<bigint, string> = new Map()): AuctionView {
  const policyNames = new Map(KNOWN_POLICY_NAMES.map((n) => [policyId(n), n]));
  const categoryNames = new Map(KNOWN_CATEGORIES.map((n) => [keccak256(stringToBytes(n)), n]));
  const nameOf = (id: bigint) => agentNames.get(id) ?? `agent #${id}`;
  const closed = new Set(raw.closed.map((c) => c.taskId));
  const awards = new Map(raw.awards.map((a) => [a.taskId, a]));
  const noAward = new Set(raw.noAwards.map((n) => n.taskId));
  const completed = new Set(raw.completed.map((c) => c.taskId));

  const tasks: AuctionTask[] = raw.tasks.map((t) => {
    const a = awards.get(t.taskId);
    const status: AuctionTask["status"] = completed.has(t.taskId)
      ? "completed"
      : a
        ? "awarded"
        : noAward.has(t.taskId)
          ? "no award"
          : closed.has(t.taskId)
            ? "closed"
            : "open";
    const bids: AuctionBid[] = raw.bids
      .filter((b) => b.taskId === t.taskId)
      .map((b) => {
        const key = `${t.taskId}:${b.agentId}`;
        return {
          agentId: b.agentId,
          agentName: nameOf(b.agentId),
          bidder: b.bidder,
          commitment: b.commitment,
          inclusion: key in raw.inclusion ? (raw.inclusion[key] ? "counted" : "not counted") : "unknown",
          winner: a?.winnerAgentId === b.agentId,
        };
      });
    return {
      taskId: t.taskId,
      client: t.client,
      policyId: t.policyId,
      policyName: policyNames.get(t.policyId) ?? null,
      category: t.category,
      categoryName: categoryNames.get(t.category) ?? null,
      deadline: t.deadline,
      status,
      bids,
      award: a
        ? { winnerAgentId: a.winnerAgentId, winnerName: nameOf(a.winnerAgentId), winningPrice: a.winningPrice, validBidCount: a.validBidCount, merkleRoot: a.merkleRoot }
        : null,
    };
  });

  const leaks: string[] = [];
  for (const t of tasks) {
    leaks.push(
      `task ${t.taskId}: posted by ${short(t.client)} for ${t.categoryName ?? short(t.category)}, bidders must hold ${t.policyName ?? short(t.policyId)}`,
    );
    for (const b of t.bids) leaks.push(`task ${t.taskId}: ${b.agentName} bid from ${short(b.bidder)} (commitment ${short(b.commitment)})`);
    if (t.award)
      leaks.push(
        `task ${t.taskId}: awarded to ${t.award.winnerName} at ${t.award.winningPrice}; ${t.award.validBidCount} of ${t.bids.length} bids counted`,
      );
    else if (t.status === "no award") leaks.push(`task ${t.taskId}: no valid bid, not awarded`);
  }
  const hidden = tasks.some((t) => t.bids.length)
    ? ["every losing bid price (never opened on-chain)", "every losing bid's salt, so a commitment cannot be brute-forced over likely prices"]
    : [];
  return { tasks, leaks, hidden };
}
