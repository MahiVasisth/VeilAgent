// What any indexer can reconstruct about Veil8004 receipts and anonymous ratings (Phase 5), from public events,
// transactions and views only. The "after" side of the ratings split. fetchFeedbackData does the I/O;
// buildFeedbackView is pure.
import { getAddress, keccak256, stringToBytes, type Address, type Hash, type Hex, type PublicClient } from "viem";
import { anonymousFeedbackAbi, receiptGroupManagerAbi, sealedBidHiringAbi } from "../abi/veil";
import { semaphoreAbi } from "../abi/semaphore";
import type { Deployment } from "../deployments";
import { KNOWN_CATEGORIES } from "./auctionView";

export type RawFeedbackData = {
  receipts: { taskId: bigint; category: Hex; epoch: bigint; groupId: bigint; agentId: bigint; client: Address | null }[];
  /** Semaphore group size per group id: the anonymity set of a rating in that group. */
  groupSizes: Record<string, number>;
  ratings: { agentId: bigint; epoch: bigint; category: Hex; score: number; nullifier: bigint; sender: Address; txHash: Hash }[];
  anchors: { agentId: bigint; epoch: bigint; value: bigint; count: bigint; txHash: Hash }[];
  epochLength: bigint;
  ratingWindow: bigint;
  now: bigint;
};

export type FeedbackRating = {
  agentId: bigint;
  agentName: string;
  epoch: bigint;
  categoryName: string | null;
  score: number;
  nullifier: bigint;
  sender: Address;
  /** Receipt holders in the rating's group: the rater is one of them. */
  anonymitySet: number;
  /** The sending wallet is also a client address seen in a TaskPosted (no relayer, no fresh wallet). */
  senderIsClient: boolean;
};

export type FeedbackAggregate = {
  agentId: bigint;
  agentName: string;
  epoch: bigint;
  count: number;
  /** Average with 2 decimals, rounded down, as AnonymousFeedback anchors it. */
  average: bigint;
  status: "open" | "closed" | "anchored";
  anchoredValue: bigint | null;
};

export type FeedbackView = {
  ratings: FeedbackRating[];
  aggregates: FeedbackAggregate[];
  receiptCount: number;
  leaks: string[];
  hidden: string[];
};

export async function fetchFeedbackData(client: PublicClient, d: Deployment): Promise<RawFeedbackData | null> {
  const v = d.veil;
  if (!v?.receiptGroupManager || !v.anonymousFeedback || !v.semaphore || !v.sealedBidHiring) return null;
  const range = { fromBlock: BigInt(d.startBlock), toBlock: "latest" } as const;
  const [issued, posted, submitted, anchored, epochLength, ratingWindow, block] = await Promise.all([
    client.getContractEvents({ address: v.receiptGroupManager, abi: receiptGroupManagerAbi, eventName: "ReceiptIssued", ...range }),
    client.getContractEvents({ address: v.sealedBidHiring, abi: sealedBidHiringAbi, eventName: "TaskPosted", ...range }),
    client.getContractEvents({ address: v.anonymousFeedback, abi: anonymousFeedbackAbi, eventName: "FeedbackSubmitted", ...range }),
    client.getContractEvents({ address: v.anonymousFeedback, abi: anonymousFeedbackAbi, eventName: "FeedbackAnchored", ...range }),
    client.readContract({ address: v.receiptGroupManager, abi: receiptGroupManagerAbi, functionName: "epochLength" }),
    client.readContract({ address: v.receiptGroupManager, abi: receiptGroupManagerAbi, functionName: "ratingWindow" }),
    client.getBlock({ blockTag: "latest" }),
  ]);
  const clients = new Map(posted.map((l) => [l.args.taskId!, getAddress(l.args.client!)]));
  const groupIds = [...new Set(issued.map((l) => l.args.groupId!))];
  const sizes = await Promise.all(
    groupIds.map((g) => client.readContract({ address: v.semaphore!, abi: semaphoreAbi, functionName: "getMerkleTreeSize", args: [g] })),
  );
  return {
    receipts: issued.map((l) => ({
      taskId: l.args.taskId!,
      category: l.args.category!,
      epoch: BigInt(l.args.epoch!),
      groupId: l.args.groupId!,
      agentId: l.args.agentId!,
      client: clients.get(l.args.taskId!) ?? null,
    })),
    groupSizes: Object.fromEntries(groupIds.map((g, i) => [g.toString(), Number(sizes[i])])),
    ratings: await Promise.all(
      submitted.map(async (l) => ({
        agentId: l.args.agentId!,
        epoch: BigInt(l.args.epoch!),
        category: l.args.category!,
        score: Number(l.args.score!),
        nullifier: l.args.nullifier!,
        sender: getAddress((await client.getTransaction({ hash: l.transactionHash })).from),
        txHash: l.transactionHash,
      })),
    ),
    anchors: anchored.map((l) => ({ agentId: l.args.agentId!, epoch: BigInt(l.args.epoch!), value: BigInt(l.args.value!), count: BigInt(l.args.count!), txHash: l.transactionHash })),
    epochLength: BigInt(epochLength),
    ratingWindow: BigInt(ratingWindow),
    now: block.timestamp,
  };
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const shortNum = (n: bigint) => `${n.toString().slice(0, 8)}…`;
export const formatAverage = (v: bigint) => `${v / 100n}.${(v % 100n).toString().padStart(2, "0")}`;

export function buildFeedbackView(raw: RawFeedbackData, agentNames: Map<bigint, string> = new Map()): FeedbackView {
  const categories = new Map(KNOWN_CATEGORIES.map((n) => [keccak256(stringToBytes(n)), n]));
  const name = (id: bigint) => agentNames.get(id) ?? `agent #${id}`;
  const groupOf = new Map(raw.receipts.map((r) => [`${r.category}:${r.epoch}`, r.groupId]));
  const clientAddrs = new Set(raw.receipts.flatMap((r) => (r.client ? [r.client.toLowerCase()] : [])));

  const ratings: FeedbackRating[] = raw.ratings.map((r) => {
    const g = groupOf.get(`${r.category}:${r.epoch}`);
    return {
      agentId: r.agentId,
      agentName: name(r.agentId),
      epoch: r.epoch,
      categoryName: categories.get(r.category) ?? null,
      score: r.score,
      nullifier: r.nullifier,
      sender: r.sender,
      anonymitySet: g === undefined ? 0 : (raw.groupSizes[g.toString()] ?? 0),
      senderIsClient: clientAddrs.has(r.sender.toLowerCase()),
    };
  });

  const byKey = new Map<string, FeedbackAggregate>();
  for (const r of ratings) {
    const key = `${r.agentId}:${r.epoch}`;
    const a = byKey.get(key) ?? { agentId: r.agentId, agentName: r.agentName, epoch: r.epoch, count: 0, average: 0n, status: "open" as const, anchoredValue: null };
    a.count += 1;
    a.average += BigInt(r.score); // sum for now
    byKey.set(key, a);
  }
  const aggregates = [...byKey.values()].map((a) => {
    const anchor = raw.anchors.find((x) => x.agentId === a.agentId && x.epoch === a.epoch);
    const closesAt = (a.epoch + 1n) * raw.epochLength + raw.ratingWindow;
    return {
      ...a,
      average: (a.average * 100n) / BigInt(a.count),
      status: anchor ? ("anchored" as const) : raw.now >= closesAt ? ("closed" as const) : ("open" as const),
      anchoredValue: anchor ? anchor.value : null,
    };
  });

  const leaks: string[] = [];
  for (const r of raw.receipts) {
    const cat = categories.get(r.category) ?? short(r.category);
    leaks.push(`receipt: task ${r.taskId}${r.client ? ` (client ${short(r.client)})` : ""} joined the ${cat} group for epoch ${r.epoch} after a job with ${name(r.agentId)}`);
  }
  for (const r of ratings)
    leaks.push(
      `rating: ${r.agentName} got ${r.score}/5 in epoch ${r.epoch}, nullifier ${shortNum(r.nullifier)}, sent from ${short(r.sender)}` +
        (r.senderIsClient ? " (a client's own address: this links the rating)" : ""),
    );
  for (const a of raw.anchors) leaks.push(`anchored: ${name(a.agentId)} epoch ${a.epoch} average ${formatAverage(a.value)} from ${a.count} rating${a.count === 1n ? "" : "s"}, written to the Reputation Registry`);

  const hidden = ratings.length
    ? [
        "which receipt holder gave each rating (the rater is one of the group's members)",
        "the rater's identity secret (only the commitment, given at postTask, is public)",
        "any link between a rating's sending wallet and a client, when a relayer or fresh wallet sends it",
      ]
    : [];
  return { ratings, aggregates, receiptCount: raw.receipts.length, leaks, hidden };
}
