// Measured gas per operation (Phase 6 cost panel), read from the transaction receipts of public events.
// fetchCostData does the I/O; buildCostView is pure. Gas only: the price per unit depends on the chain, and on Anvil it
// is meaningless. Reports delivered through the MockForwarder include its overhead, not the CRE forwarder's.
import type { Address, Hash, PublicClient } from "viem";
import { identityRegistryAbi, reputationRegistryAbi, validationRegistryAbi } from "../abi/erc8004";
import { anonymousFeedbackAbi, privateValidationRegistryAbi, receiptGroupManagerAbi, sealedBidHiringAbi } from "../abi/veil";
import type { Deployment } from "../deployments";

export const COST_OPS = [
  { op: "register", side: "plain", label: "Agent registration", what: "IdentityRegistry.register" },
  { op: "plainValidationRequest", side: "plain", label: "Validation request", what: "ValidationRegistry.validationRequest, input in a public request file" },
  { op: "plainValidationResponse", side: "plain", label: "Validation response", what: "ValidationRegistry.validationResponse by a public validator" },
  { op: "plainFeedback", side: "plain", label: "Feedback", what: "ReputationRegistry.giveFeedback from the client's wallet" },
  { op: "requestPrivate", side: "veil", label: "Attestation: request", what: "PrivateValidationRegistry.requestPrivate (commitment only)" },
  { op: "w1Report", side: "veil", label: "Attestation: W1 result", what: "forwarder → PrivateValidationRegistry.onReport" },
  { op: "mirror", side: "veil", label: "ERC-8004 mirror", what: "PrivateValidationRegistry.mirrorToERC8004" },
  { op: "bid", side: "veil", label: "Sealed bid", what: "SealedBidHiring.bid (commitment only)" },
  { op: "w3Award", side: "veil", label: "Award: W3 result", what: "forwarder → SealedBidHiring.onReport" },
  { op: "w2Receipt", side: "veil", label: "Receipt: W2", what: "forwarder → ReceiptGroupManager.onReport (Semaphore addMember)" },
  { op: "rating", side: "veil", label: "Anonymous rating", what: "AnonymousFeedback.submit (Semaphore proof check)" },
  { op: "anchor", side: "veil", label: "Anchor the average", what: "AnonymousFeedback.anchor → ReputationRegistry.giveFeedback" },
] as const;

export type CostOp = (typeof COST_OPS)[number]["op"];

export type RawCostData = {
  samples: { op: CostOp; txHash: Hash; gasUsed: bigint }[];
  /** Reports came through the MockForwarder (local SIMULATION), not the CRE forwarder. */
  forwarderIsMock: boolean;
};

export type CostRow = {
  op: CostOp;
  side: "plain" | "veil";
  label: string;
  what: string;
  count: number;
  min: bigint;
  median: bigint;
  max: bigint;
};

export type CostView = {
  rows: CostRow[];
  /** Median request + median W1 result: one private attestation end to end. Null until both were measured. */
  attestationTotal: bigint | null;
  forwarderIsMock: boolean;
};

export async function fetchCostData(client: PublicClient, d: Deployment): Promise<RawCostData> {
  const range = { fromBlock: BigInt(d.startBlock), toBlock: "latest" } as const;
  const v = d.veil;
  const anon = v?.anonymousFeedback?.toLowerCase();
  const veilRegistry = v?.privateValidationRegistry?.toLowerCase();
  const hashes: { op: CostOp; txHash: Hash }[] = [];
  const add = (op: CostOp, logs: { transactionHash: Hash | null }[]) => {
    for (const l of logs) if (l.transactionHash) hashes.push({ op, txHash: l.transactionHash });
  };

  const [registered, vReq, vResp, feedback] = await Promise.all([
    client.getContractEvents({ address: d.identityRegistry, abi: identityRegistryAbi, eventName: "Registered", ...range }),
    client.getContractEvents({ address: d.validationRegistry, abi: validationRegistryAbi, eventName: "ValidationRequest", ...range }),
    client.getContractEvents({ address: d.validationRegistry, abi: validationRegistryAbi, eventName: "ValidationResponse", ...range }),
    client.getContractEvents({ address: d.reputationRegistry, abi: reputationRegistryAbi, eventName: "NewFeedback", ...range }),
  ]);
  add("register", registered);
  // Requests naming the Veil8004 registry and responses tagged by it are the mirror's, not plain ERC-8004 traffic.
  add("plainValidationRequest", vReq.filter((l) => (l.args.validatorAddress as Address | undefined)?.toLowerCase() !== veilRegistry));
  add("plainValidationResponse", vResp.filter((l) => l.args.tag !== "veil8004-private"));
  add("plainFeedback", feedback.filter((l) => (l.args.clientAddress as Address | undefined)?.toLowerCase() !== anon));

  if (v) {
    const pvr = { address: v.privateValidationRegistry, abi: privateValidationRegistryAbi, ...range } as const;
    const [requested, recorded, mirrored] = await Promise.all([
      client.getContractEvents({ ...pvr, eventName: "PrivateValidationRequested" }),
      client.getContractEvents({ ...pvr, eventName: "PrivateValidationRecorded" }),
      client.getContractEvents({ ...pvr, eventName: "MirroredToERC8004" }),
    ]);
    add("requestPrivate", requested);
    add("w1Report", recorded);
    add("mirror", mirrored);
  }
  if (v?.sealedBidHiring) {
    const h = { address: v.sealedBidHiring, abi: sealedBidHiringAbi, ...range } as const;
    const [bids, awards] = await Promise.all([client.getContractEvents({ ...h, eventName: "BidPlaced" }), client.getContractEvents({ ...h, eventName: "JobAwarded" })]);
    add("bid", bids);
    add("w3Award", awards);
  }
  if (v?.receiptGroupManager) {
    add("w2Receipt", await client.getContractEvents({ address: v.receiptGroupManager, abi: receiptGroupManagerAbi, eventName: "ReceiptIssued", ...range }));
  }
  if (v?.anonymousFeedback) {
    const f = { address: v.anonymousFeedback, abi: anonymousFeedbackAbi, ...range } as const;
    const [submitted, anchored] = await Promise.all([
      client.getContractEvents({ ...f, eventName: "FeedbackSubmitted" }),
      client.getContractEvents({ ...f, eventName: "FeedbackAnchored" }),
    ]);
    add("rating", submitted);
    add("anchor", anchored);
  }

  const unique = [...new Set(hashes.map((h) => h.txHash))];
  const gas = new Map(
    await Promise.all(unique.map(async (hash) => [hash, (await client.getTransactionReceipt({ hash })).gasUsed] as const)),
  );
  return { samples: hashes.map((h) => ({ ...h, gasUsed: gas.get(h.txHash)! })), forwarderIsMock: v?.forwarderIsMock ?? false };
}

const median = (sorted: bigint[]) => {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2n;
};

export function buildCostView(raw: RawCostData): CostView {
  const rows: CostRow[] = [];
  for (const meta of COST_OPS) {
    // One sample per transaction: a transaction that emits the same event twice is still one cost.
    const byTx = new Map(raw.samples.filter((s) => s.op === meta.op).map((s) => [s.txHash, s.gasUsed]));
    if (byTx.size === 0) continue;
    const gas = [...byTx.values()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    rows.push({ ...meta, count: gas.length, min: gas[0]!, median: median(gas), max: gas.at(-1)! });
  }
  const req = rows.find((r) => r.op === "requestPrivate");
  const rep = rows.find((r) => r.op === "w1Report");
  return { rows, attestationTotal: req && rep ? req.median + rep.median : null, forwarderIsMock: raw.forwarderIsMock };
}

/** 1234567n → "1,234,567". */
export const formatGas = (g: bigint) => g.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
