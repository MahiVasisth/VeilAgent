// W3 Bid opener: pure handler steps, shared by the CRE workflow (cre/workflows/w3-bid-opener) and the local DON
// simulation (cre/local-runner). No I/O here: callers read the bids from chain, fetch the sealed openings and deliver
// the report. Runs under QuickJS in CRE, so it uses only viem, the noble-based seal module and the OZ Merkle tree.
//
//   openBids(taskId, bids, sealed[], decryptKey)  -> { counted, dropped }   (decrypt + commitment check per bid)
//   decideAward(taskId, counted)                  -> report bytes           (lowest price, ties to earliest; Merkle root)
import { decodeAbiParameters, decodeEventLog, encodeAbiParameters, type Hex } from "viem";
import { bidCommitment } from "@veil8004/sdk/commitments";
import { bidStoreKey } from "@veil8004/sdk/bids";
import { bidTreeRoot, ZERO_ROOT } from "@veil8004/sdk/merkle";
import { open } from "@veil8004/sdk/seal";
import { sealedBidHiringAbi } from "@veil8004/sdk/abi/veil";

export type BiddingClosed = { taskId: bigint; bidCount: bigint };
/** A bid as stored on-chain, in placement order. */
export type OnChainBid = { agentId: bigint; commitment: Hex };
export type OpenedBid = OnChainBid & { index: number; price: bigint; salt: Hex };
export type DroppedBid = OnChainBid & { index: number; reason: string };
export type BidOpenerReport = {
  taskId: bigint;
  winnerAgentId: bigint;
  winningPrice: bigint;
  winnerSalt: Hex;
  validBidCount: number;
  merkleRoot: Hex;
};

const REPORT_PARAMS = [
  { type: "uint256" }, // taskId
  { type: "uint256" }, // winnerAgentId
  { type: "uint256" }, // winningPrice
  { type: "bytes32" }, // winnerSalt
  { type: "uint32" }, // validBidCount
  { type: "bytes32" }, // merkleRoot
] as const;

const MAX_UINT256 = (1n << 256n) - 1n;

/** Decodes a BiddingClosed log (the W3 trigger). */
export function decodeBiddingClosed(log: { topics: Hex[]; data: Hex }): BiddingClosed {
  const { eventName, args } = decodeEventLog({
    abi: sealedBidHiringAbi,
    eventName: "BiddingClosed",
    topics: log.topics as [Hex, ...Hex[]],
    data: log.data,
  });
  if (eventName !== "BiddingClosed") throw new Error(`unexpected event ${eventName}`);
  return { taskId: args.taskId, bidCount: args.bidCount };
}

/** Where each bid's sealed opening lives in the sealed store. */
export const sealedKeyOf = (bid: OnChainBid) => bidStoreKey(bid.commitment);

/** Opens one bid. Drops it (never throws) when the opening is missing, undecryptable, malformed or does not match the
 *  on-chain commitment. */
export function openBid(taskId: bigint, bid: OnChainBid, index: number, sealed: string | null, decryptKeyB64: string): OpenedBid | DroppedBid {
  const drop = (reason: string): DroppedBid => ({ ...bid, index, reason });
  if (sealed === null) return drop("no sealed bid");
  let opening: unknown;
  try {
    opening = open(decryptKeyB64, sealed);
  } catch {
    return drop("does not open with the W3 key");
  }
  const { price, salt } = (opening ?? {}) as { price?: unknown; salt?: unknown };
  if (typeof price !== "string" || !/^\d{1,78}$/.test(price) || typeof salt !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(salt))
    return drop("malformed opening: expected {price: decimal string, salt: bytes32}");
  const p = BigInt(price);
  if (p > MAX_UINT256) return drop("price exceeds uint256");
  const recomputed = bidCommitment({ taskId, agentId: bid.agentId, price: p, salt: salt as Hex });
  if (recomputed.toLowerCase() !== bid.commitment.toLowerCase()) return drop("commitment mismatch");
  return { ...bid, index, price: p, salt: salt as Hex };
}

/** Opens every bid. `sealed[i]` is the opening fetched for `bids[i]` (null if none). */
export function openBids(taskId: bigint, bids: OnChainBid[], sealed: (string | null)[], decryptKeyB64: string) {
  if (sealed.length !== bids.length) throw new Error("one sealed entry per bid");
  const counted: OpenedBid[] = [];
  const dropped: DroppedBid[] = [];
  bids.forEach((b, i) => {
    const r = openBid(taskId, b, i, sealed[i]!, decryptKeyB64);
    if ("reason" in r) dropped.push(r);
    else counted.push(r);
  });
  return { counted, dropped };
}

/** Lowest price wins; ties go to the earliest bid (lowest on-chain index). Null when nothing was counted. */
export function pickWinner(counted: OpenedBid[]): OpenedBid | null {
  let best: OpenedBid | null = null;
  for (const b of counted) if (best === null || b.price < best.price || (b.price === best.price && b.index < best.index)) best = b;
  return best;
}

/** The W3 report for the counted bids. With none counted: winner 0, price 0, salt 0, count 0, root 0 (NoAward). */
export function decideAward(taskId: bigint, counted: OpenedBid[]): { report: Hex; decoded: BidOpenerReport } {
  const winner = pickWinner(counted);
  const decoded: BidOpenerReport = winner
    ? {
        taskId,
        winnerAgentId: winner.agentId,
        winningPrice: winner.price,
        winnerSalt: winner.salt,
        validBidCount: counted.length,
        merkleRoot: bidTreeRoot(taskId, counted),
      }
    : { taskId, winnerAgentId: 0n, winningPrice: 0n, winnerSalt: ZERO_ROOT, validBidCount: 0, merkleRoot: ZERO_ROOT };
  return { report: encodeBidOpenerReport(decoded), decoded };
}

export function encodeBidOpenerReport(r: BidOpenerReport): Hex {
  return encodeAbiParameters(REPORT_PARAMS, [r.taskId, r.winnerAgentId, r.winningPrice, r.winnerSalt, r.validBidCount, r.merkleRoot]);
}

export function decodeBidOpenerReport(report: Hex): BidOpenerReport {
  const [taskId, winnerAgentId, winningPrice, winnerSalt, validBidCount, merkleRoot] = decodeAbiParameters(REPORT_PARAMS, report);
  return { taskId, winnerAgentId, winningPrice, winnerSalt, validBidCount, merkleRoot };
}

/** I/O the orchestrator needs. The local runner supplies HTTP and RPC; tests supply fakes. */
export type BidOpenerDeps = {
  readBids(taskId: bigint): Promise<OnChainBid[]>;
  fetchSealedBid(key: string): Promise<string | null>;
  decryptKey: string;
};

/** Composes the pure steps with async I/O. Returns the report and what was counted and dropped (for logs only:
 *  the dropped reasons and counted prices must never be published). */
export async function runBidOpener(event: BiddingClosed, deps: BidOpenerDeps) {
  const bids = await deps.readBids(event.taskId);
  if (BigInt(bids.length) !== event.bidCount)
    throw new Error(`task ${event.taskId}: ${bids.length} bids on chain, event says ${event.bidCount}`);
  const sealed = await Promise.all(bids.map((b) => deps.fetchSealedBid(sealedKeyOf(b))));
  const { counted, dropped } = openBids(event.taskId, bids, sealed, deps.decryptKey);
  return { ...decideAward(event.taskId, counted), counted, dropped };
}
