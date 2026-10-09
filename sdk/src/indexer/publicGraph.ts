// What any indexer can reconstruct from plain ERC-8004 activity, using only public events and transactions.
// fetchPublicData does the I/O; buildPublicGraph is pure so it can be unit-tested and shared by the CLI and frontend.
import { formatEther, getAddress, type Address, type Hash, type PublicClient } from "viem";
import { identityRegistryAbi, reputationRegistryAbi, validationRegistryAbi } from "../abi/erc8004";
import { parseJsonDataUri } from "../dataUri";
import type { Deployment } from "../deployments";

export type RawPublicData = {
  registered: { agentId: bigint; owner: Address; agentURI: string }[];
  uriUpdates: { agentId: bigint; newURI: string }[];
  validationRequests: {
    validator: Address;
    agentId: bigint;
    requestURI: string;
    requestHash: Hash;
    requester: Address;
    txHash: Hash;
  }[];
  validationResponses: {
    validator: Address;
    agentId: bigint;
    requestHash: Hash;
    response: number;
    responseURI: string;
    tag: string;
    txHash: Hash;
  }[];
  feedback: {
    agentId: bigint;
    client: Address;
    feedbackIndex: bigint;
    value: bigint;
    valueDecimals: number;
    tag1: string;
    tag2: string;
    endpoint: string;
    feedbackURI: string;
    txHash: Hash;
  }[];
  /** Plain value transfers referenced by feedback files (`proofOfPayment.txHash`). */
  payments: Record<Hash, { from: Address; to: Address | null; value: bigint }>;
};

export type GraphNode = { id: string; kind: "client" | "agent" | "validator"; label: string; address: Address };
export type GraphEdge = {
  from: string;
  to: string;
  kind: "payment" | "validation" | "feedback";
  label: string;
  txHash: Hash;
};

export type PublicGraph = {
  agents: { agentId: bigint; owner: Address; name: string }[];
  validations: {
    requestHash: Hash;
    agentId: bigint;
    agentName: string;
    requester: Address;
    validator: Address;
    /** The request file as published: everything the validator needed, in the clear. */
    request: unknown;
    response: number | null;
    tag: string | null;
    responseDetail: unknown;
  }[];
  feedback: {
    agentId: bigint;
    agentName: string;
    client: Address;
    score: string;
    tag1: string;
    tag2: string;
    payment: { from: Address; to: Address | null; amountEth: string; txHash: Hash } | null;
  }[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** One line per fact an observer learns, for the CLI and the page. */
  leaks: string[];
};

export async function fetchPublicData(client: PublicClient, d: Deployment): Promise<RawPublicData> {
  const range = { fromBlock: BigInt(d.startBlock), toBlock: "latest" } as const;
  const [registered, uriUpdates, requests, responses, feedback] = await Promise.all([
    client.getContractEvents({ address: d.identityRegistry, abi: identityRegistryAbi, eventName: "Registered", ...range }),
    client.getContractEvents({ address: d.identityRegistry, abi: identityRegistryAbi, eventName: "URIUpdated", ...range }),
    client.getContractEvents({
      address: d.validationRegistry,
      abi: validationRegistryAbi,
      eventName: "ValidationRequest",
      ...range,
    }),
    client.getContractEvents({
      address: d.validationRegistry,
      abi: validationRegistryAbi,
      eventName: "ValidationResponse",
      ...range,
    }),
    client.getContractEvents({ address: d.reputationRegistry, abi: reputationRegistryAbi, eventName: "NewFeedback", ...range }),
  ]);

  const validationRequests = await Promise.all(
    requests.map(async (log) => ({
      validator: log.args.validatorAddress!,
      agentId: log.args.agentId!,
      requestURI: log.args.requestURI!,
      requestHash: log.args.requestHash!,
      requester: getAddress((await client.getTransaction({ hash: log.transactionHash })).from),
      txHash: log.transactionHash,
    })),
  );

  const payments: RawPublicData["payments"] = {};
  for (const log of feedback) {
    const txHash = paymentTxHash(parseJsonDataUri(log.args.feedbackURI ?? ""));
    if (!txHash || payments[txHash]) continue;
    const tx = await client.getTransaction({ hash: txHash }).catch(() => null);
    if (tx) payments[txHash] = { from: tx.from, to: tx.to, value: tx.value };
  }

  return {
    registered: registered.map((l) => ({ agentId: l.args.agentId!, owner: l.args.owner!, agentURI: l.args.agentURI! })),
    uriUpdates: uriUpdates.map((l) => ({ agentId: l.args.agentId!, newURI: l.args.newURI! })),
    validationRequests,
    validationResponses: responses.map((l) => ({
      validator: l.args.validatorAddress!,
      agentId: l.args.agentId!,
      requestHash: l.args.requestHash!,
      response: l.args.response!,
      responseURI: l.args.responseURI!,
      tag: l.args.tag!,
      txHash: l.transactionHash,
    })),
    feedback: feedback.map((l) => ({
      agentId: l.args.agentId!,
      client: l.args.clientAddress!,
      feedbackIndex: BigInt(l.args.feedbackIndex!),
      value: BigInt(l.args.value!),
      valueDecimals: l.args.valueDecimals!,
      tag1: l.args.tag1!,
      tag2: l.args.tag2!,
      endpoint: l.args.endpoint!,
      feedbackURI: l.args.feedbackURI!,
      txHash: l.transactionHash,
    })),
    payments,
  };
}

function paymentTxHash(file: unknown): Hash | null {
  const hash = (file as { proofOfPayment?: { txHash?: unknown } } | null)?.proofOfPayment?.txHash;
  return typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash) ? (hash as Hash) : null;
}

function formatScore(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();
  const negative = value < 0n;
  const abs = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const text = `${abs.slice(0, -decimals)}.${abs.slice(-decimals)}`.replace(/\.?0+$/, "");
  return negative ? `-${text}` : text;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function buildPublicGraph(raw: RawPublicData): PublicGraph {
  // Latest URI wins; name comes from the registration file when it is an on-chain data: URI.
  const uri = new Map<bigint, string>();
  for (const r of raw.registered) uri.set(r.agentId, r.agentURI);
  for (const u of raw.uriUpdates) uri.set(u.agentId, u.newURI);
  const agents = raw.registered.map((r) => {
    const file = parseJsonDataUri(uri.get(r.agentId) ?? "") as { name?: unknown } | null;
    const name = typeof file?.name === "string" ? file.name : `agent #${r.agentId}`;
    return { agentId: r.agentId, owner: r.owner, name };
  });
  const nameOf = (id: bigint) => agents.find((a) => a.agentId === id)?.name ?? `agent #${id}`;

  // Latest response per request (ERC-8004 allows repeated responses).
  const latestResponse = new Map<Hash, RawPublicData["validationResponses"][number]>();
  for (const r of raw.validationResponses) latestResponse.set(r.requestHash, r);

  const validations = raw.validationRequests.map((q) => {
    const r = latestResponse.get(q.requestHash);
    return {
      requestHash: q.requestHash,
      agentId: q.agentId,
      agentName: nameOf(q.agentId),
      requester: q.requester,
      validator: q.validator,
      request: parseJsonDataUri(q.requestURI) ?? q.requestURI,
      response: r ? r.response : null,
      tag: r ? r.tag : null,
      responseDetail: r ? (parseJsonDataUri(r.responseURI) ?? r.responseURI) : null,
    };
  });

  const feedback = raw.feedback.map((f) => {
    const txHash = paymentTxHash(parseJsonDataUri(f.feedbackURI));
    const p = txHash ? raw.payments[txHash] : undefined;
    return {
      agentId: f.agentId,
      agentName: nameOf(f.agentId),
      client: f.client,
      score: formatScore(f.value, f.valueDecimals),
      tag1: f.tag1,
      tag2: f.tag2,
      payment: p && txHash ? { from: p.from, to: p.to, amountEth: formatEther(p.value), txHash } : null,
    };
  });

  const nodes = new Map<string, GraphNode>();
  const agentNode = (id: bigint) => {
    const key = `agent:${id}`;
    const a = agents.find((x) => x.agentId === id);
    if (!nodes.has(key))
      nodes.set(key, { id: key, kind: "agent", label: nameOf(id), address: a?.owner ?? "0x0000000000000000000000000000000000000000" });
    return key;
  };
  const addrNode = (kind: "client" | "validator", address: Address) => {
    const key = `${kind}:${address.toLowerCase()}`;
    if (!nodes.has(key)) nodes.set(key, { id: key, kind, label: `${kind} ${short(address)}`, address });
    return key;
  };
  for (const a of agents) agentNode(a.agentId);

  const edges: GraphEdge[] = [];
  const leaks: string[] = [];
  for (const [i, v] of validations.entries()) {
    const q = raw.validationRequests[i]!;
    const result = v.response === null ? "pending" : v.response === 100 ? "pass" : v.response === 0 ? "fail" : `${v.response}/100`;
    edges.push({
      from: agentNode(v.agentId),
      to: addrNode("validator", v.validator),
      kind: "validation",
      label: `${v.tag ?? "validation"}: ${result}`,
      txHash: q.txHash,
    });
    leaks.push(
      `validation: ${v.agentName} (requested by ${short(v.requester)}) → validator ${short(v.validator)}; ` +
        `input ${JSON.stringify(v.request)}; result ${result}`,
    );
  }
  for (const [i, f] of feedback.entries()) {
    const raw_ = raw.feedback[i]!;
    const clientKey = addrNode("client", f.client);
    if (f.payment) {
      edges.push({ from: clientKey, to: agentNode(f.agentId), kind: "payment", label: `${f.payment.amountEth} ETH`, txHash: f.payment.txHash });
      leaks.push(`payment: client ${short(f.client)} paid ${f.agentName} ${f.payment.amountEth} ETH`);
    }
    edges.push({ from: clientKey, to: agentNode(f.agentId), kind: "feedback", label: `score ${f.score}`, txHash: raw_.txHash });
    leaks.push(`feedback: client ${short(f.client)} rated ${f.agentName} ${f.score} (${[f.tag1, f.tag2].filter(Boolean).join(", ")})`);
  }

  return { agents, validations, feedback, nodes: [...nodes.values()], edges, leaks };
}
