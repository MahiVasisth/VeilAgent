// The explorer's activity feed: every public event, plain ERC-8004 and Veil8004, as one time-ordered list. Built from
// the same raw public data as the indexer views; for each event it lists what is on-chain and, for Veil8004, what is
// not. Server-only (reads receipts and blocks for block numbers and times).
import { formatUnits, type Hash, type PublicClient } from "viem";
import {
  formatAverage,
  type AuctionView,
  type FeedbackView,
  type PublicGraph,
  type RawAuctionData,
  type RawFeedbackData,
  type RawPublicData,
  type RawVeilData,
  type VeilView,
} from "@veil8004/sdk";
import { formatDate, label, short } from "./format";

export type EventKind = "screening" | "result" | "payout" | "task" | "bid" | "award" | "rating" | "anchor" | "payment";
export type ActivityEvent = {
  id: string;
  kind: EventKind;
  system: "plain" | "veil";
  title: string;
  summary: string;
  agent: string | null;
  actor: string | null;
  txHash: Hash;
  block: number | null;
  time: number | null;
  /** Every field an observer reads from this event. */
  fields: { k: string; v: string; mono?: boolean; leak?: boolean }[];
  /** For Veil8004 events: what this event deliberately does not put on-chain. */
  sealed: string[];
};

type Inputs = {
  graph: PublicGraph;
  rawPublic: RawPublicData;
  rawVeil: RawVeilData | null;
  veil: VeilView | null;
  rawAuction: RawAuctionData | null;
  auction: AuctionView | null;
  rawFeedback: RawFeedbackData | null;
  feedback: FeedbackView | null;
  veilRegistry: string | null;
};

export async function buildActivity(client: PublicClient, x: Inputs): Promise<ActivityEvent[]> {
  const name = new Map(x.graph.agents.map((a) => [a.agentId, a.name]));
  const agentName = (id: bigint) => name.get(id) ?? `agent #${id}`;
  const ev: Omit<ActivityEvent, "block" | "time">[] = [];

  // ---- plain ERC-8004 -----------------------------------------------------------------------------------------------
  const veilRegistry = x.veilRegistry?.toLowerCase();
  const plainVal = new Map(x.graph.validations.map((v) => [v.requestHash, v]));
  for (const r of x.rawPublic.validationRequests) {
    if (r.validator.toLowerCase() === veilRegistry) continue; // mirrors of Veil8004 results
    const v = plainVal.get(r.requestHash);
    const input = (v?.request as { input?: { subject?: string } } | null)?.input;
    ev.push({
      id: `pv:${r.requestHash}`, kind: "screening", system: "plain", title: "Screening requested",
      summary: `${input?.subject ?? "a counterparty"} for ${agentName(r.agentId)}`,
      agent: agentName(r.agentId), actor: r.requester, txHash: r.txHash,
      fields: [
        { k: "Agent", v: agentName(r.agentId) },
        { k: "Requested by", v: r.requester, mono: true },
        { k: "Validator", v: r.validator, mono: true },
        { k: "Input", v: JSON.stringify(input ?? v?.request ?? null), mono: true, leak: true },
      ],
      sealed: [],
    });
  }
  for (const r of x.rawPublic.validationResponses) {
    if (r.validator.toLowerCase() === veilRegistry) continue;
    const v = plainVal.get(r.requestHash);
    const subject = (v?.request as { input?: { subject?: string } } | null)?.input?.subject;
    const res = r.response === 100 ? "pass" : r.response === 0 ? "fail" : `${r.response}/100`;
    ev.push({
      id: `pr:${r.requestHash}`, kind: "result", system: "plain", title: "Screening result",
      summary: `${subject ?? agentName(r.agentId)} → ${res}`,
      agent: agentName(r.agentId), actor: r.validator, txHash: r.txHash,
      fields: [
        { k: "Agent", v: agentName(r.agentId) },
        { k: "Screened", v: subject ?? "—", leak: true },
        { k: "Result", v: res, leak: true },
        { k: "Tag", v: r.tag || "—" },
      ],
      sealed: [],
    });
  }
  for (const f of x.graph.feedback) {
    const raw = x.rawPublic.feedback.find((r) => r.client === f.client && r.agentId === f.agentId);
    if (f.payment) {
      ev.push({
        id: `pp:${f.payment.txHash}`, kind: "payment", system: "plain", title: "Payment",
        summary: `${short(f.payment.from)} paid ${f.agentName} ${f.payment.amountEth} ETH`,
        agent: f.agentName, actor: f.payment.from, txHash: f.payment.txHash,
        fields: [
          { k: "From client", v: f.payment.from, mono: true, leak: true },
          { k: "To agent", v: f.payment.to ?? "—", mono: true },
          { k: "Amount", v: `${f.payment.amountEth} ETH`, leak: true },
        ],
        sealed: [],
      });
    }
    if (raw) {
      ev.push({
        id: `pf:${raw.txHash}`, kind: "rating", system: "plain", title: "Rating",
        summary: `${short(f.client)} rated ${f.agentName} ${f.score}/100`,
        agent: f.agentName, actor: f.client, txHash: raw.txHash,
        fields: [
          { k: "Rated by", v: f.client, mono: true, leak: true },
          { k: "Agent", v: f.agentName },
          { k: "Score", v: `${f.score}/100`, leak: true },
          { k: "Tags", v: [f.tag1, f.tag2].filter(Boolean).map(label).join(", ") || "—" },
          { k: "Proof of payment", v: f.payment ? `${f.payment.amountEth} ETH` : "—", leak: !!f.payment },
        ],
        sealed: [],
      });
    }
  }

  // ---- Veil8004: private validation -----------------------------------------------------------------------------
  if (x.rawVeil && x.veil) {
    const rows = new Map(x.veil.rows.map((r) => [r.requestId, r]));
    for (const q of x.rawVeil.requested) {
      const r = rows.get(q.requestId);
      const policy = r?.policyName ?? short(q.policyId);
      ev.push({
        id: `vq:${q.requestId}`, kind: "screening", system: "veil", title: "Screening requested",
        summary: `${label(policy)} for ${agentName(q.agentId)}`,
        agent: agentName(q.agentId), actor: q.requester, txHash: q.txHash,
        fields: [
          { k: "Agent", v: agentName(q.agentId) },
          { k: "Requested by", v: q.requester, mono: true },
          { k: "Check", v: `${label(policy)} (${policy})` },
          { k: "Fingerprint", v: q.commitment, mono: true },
        ],
        sealed: ["what was screened (the input)", "the salt that keeps the fingerprint from being guessed"],
      });
    }
    for (const d of x.rawVeil.recorded) {
      const r = rows.get(d.requestId);
      ev.push({
        id: `vr:${d.requestId}`, kind: "result", system: "veil", title: "Screening result",
        summary: `${r?.policyName ? label(r.policyName) : "Screening"} for ${r?.agentName ?? "an agent"} → ${d.passed ? "pass" : "fail"}`,
        agent: r?.agentName ?? null, actor: null, txHash: d.txHash,
        fields: [
          { k: "Request", v: d.requestId, mono: true },
          { k: "Result", v: d.passed ? "pass" : "fail" },
          { k: "Valid until", v: d.expiry ? formatDate(d.expiry) : "—" },
        ],
        sealed: ["what was screened", "the screening provider's answer details"],
      });
    }
    for (const e of x.rawVeil.executed) {
      const r = rows.get(e.requestId);
      ev.push({
        id: `vx:${e.requestId}`, kind: "payout", system: "veil", title: "Gated payout",
        summary: `Allowed by a passed screening for ${r?.agentName ?? "an agent"}`,
        agent: r?.agentName ?? null, actor: null, txHash: e.txHash,
        fields: [{ k: "Gated on request", v: e.requestId, mono: true }],
        sealed: ["who the counterparty was"],
      });
    }
  }

  // ---- Veil8004: sealed-bid hiring ----------------------------------------------------------------------------------
  if (x.rawAuction && x.auction) {
    const tasks = new Map(x.auction.tasks.map((t) => [t.taskId, t]));
    for (const t of x.rawAuction.tasks) {
      const v = tasks.get(t.taskId);
      ev.push({
        id: `at:${t.taskId}`, kind: "task", system: "veil", title: "Task posted",
        summary: `${label(v?.categoryName ?? short(t.category))} · task #${t.taskId}`,
        agent: null, actor: t.client, txHash: t.txHash,
        fields: [
          { k: "Client", v: t.client, mono: true },
          { k: "Category", v: label(v?.categoryName ?? short(t.category)) },
          { k: "Bidders must hold", v: label(v?.policyName ?? short(t.policyId)) },
          { k: "Deadline", v: formatDate(t.deadline) },
          { k: "Rating identity", v: short(`0x${t.identityCommitment.toString(16).padStart(64, "0")}`), mono: true },
        ],
        sealed: ["the client's identity secret (needed later to rate anonymously)"],
      });
    }
    for (const b of x.rawAuction.bids) {
      ev.push({
        id: `ab:${b.taskId}:${b.agentId}`, kind: "bid", system: "veil", title: "Sealed bid",
        summary: `${agentName(b.agentId)} bid on task #${b.taskId}`,
        agent: agentName(b.agentId), actor: b.bidder, txHash: b.txHash,
        fields: [
          { k: "Task", v: `#${b.taskId}` },
          { k: "Agent", v: agentName(b.agentId) },
          { k: "Sent by", v: b.bidder, mono: true },
          { k: "Commitment", v: b.commitment, mono: true },
        ],
        sealed: ["the price", "the salt that seals it"],
      });
    }
    for (const a of x.rawAuction.awards) {
      const t = tasks.get(a.taskId);
      ev.push({
        id: `aa:${a.taskId}`, kind: "award", system: "veil", title: "Agent hired",
        summary: `${agentName(a.winnerAgentId)} won task #${a.taskId} at ${formatUnits(a.winningPrice, 18)}`,
        agent: agentName(a.winnerAgentId), actor: null, txHash: a.txHash,
        fields: [
          { k: "Task", v: `#${a.taskId}` },
          { k: "Winner", v: agentName(a.winnerAgentId) },
          { k: "Winning price", v: formatUnits(a.winningPrice, 18) },
          { k: "Bids counted", v: `${a.validBidCount} of ${t?.bids.length ?? a.validBidCount}` },
          { k: "Merkle root", v: a.merkleRoot, mono: true },
        ],
        sealed: (t?.bids.length ?? 0) > 1 ? ["every losing price", "every losing bid's salt"] : [],
      });
    }
  }

  // ---- Veil8004: anonymous feedback ---------------------------------------------------------------------------------
  if (x.rawFeedback && x.feedback) {
    const views = new Map(x.feedback.ratings.map((r) => [r.nullifier, r]));
    for (const r of x.rawFeedback.ratings) {
      const v = views.get(r.nullifier);
      ev.push({
        id: `fr:${r.nullifier}`, kind: "rating", system: "veil", title: "Anonymous rating",
        summary: `${v ? `One of ${v.anonymitySet} clients` : "A client"} rated ${agentName(r.agentId)} ${r.score}/5`,
        agent: agentName(r.agentId), actor: r.sender, txHash: r.txHash,
        fields: [
          { k: "Agent", v: agentName(r.agentId) },
          { k: "Score", v: `${r.score}/5` },
          { k: "Hidden among", v: v ? `${v.anonymitySet} receipt holders` : "—" },
          { k: "Rating period", v: r.epoch.toString(), mono: true },
          { k: "Sent from", v: r.sender, mono: true },
        ],
        sealed: ["which client gave the rating"],
      });
    }
    for (const a of x.rawFeedback.anchors) {
      ev.push({
        id: `fa:${a.agentId}:${a.epoch}`, kind: "anchor", system: "veil", title: "Reputation update",
        summary: `${agentName(a.agentId)} average ${formatAverage(a.value)} from ${a.count} rating${a.count === 1n ? "" : "s"}`,
        agent: agentName(a.agentId), actor: null, txHash: a.txHash,
        fields: [
          { k: "Agent", v: agentName(a.agentId) },
          { k: "Average", v: formatAverage(a.value) },
          { k: "Ratings", v: a.count.toString() },
          { k: "Rating period", v: a.epoch.toString(), mono: true },
        ],
        sealed: ["who gave each rating"],
      });
    }
  }

  // Block number and time for each transaction (a handful on a demo chain).
  const hashes = [...new Set(ev.map((e) => e.txHash))];
  const receipts = await Promise.all(hashes.map((hash) => client.getTransactionReceipt({ hash }).catch(() => null)));
  const blockOf = new Map(hashes.map((h, i) => [h, receipts[i]?.blockNumber ?? null]));
  const blocks = [...new Set([...blockOf.values()].filter((b): b is bigint => b !== null))];
  const times = new Map(
    await Promise.all(blocks.map(async (b) => [b, (await client.getBlock({ blockNumber: b })).timestamp] as const)),
  );
  return ev
    .map((e) => {
      const b = blockOf.get(e.txHash) ?? null;
      return { ...e, block: b === null ? null : Number(b), time: b === null ? null : Number(times.get(b) ?? 0n) };
    })
    .sort((a, b) => (b.block ?? 0) - (a.block ?? 0) || a.id.localeCompare(b.id));
}
