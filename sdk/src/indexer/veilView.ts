// What any indexer can reconstruct from Veil8004 private validations, using only public events and transactions.
// The "after" side of the split view. fetchVeilData does the I/O; buildVeilView is pure.
import { getAddress, type Address, type Hash, type Hex, type PublicClient } from "viem";
import { privateValidationRegistryAbi, treasuryActionAbi } from "../abi/veil";
import { policyId } from "../commitments";
import type { Deployment } from "../deployments";

/** Policy names an observer can label by hashing guesses: policyId is keccak256(name), so names are not secret. */
export const KNOWN_POLICY_NAMES = ["SANCTIONS_SCREEN_V1", "QUALIFIED_SCREENER_V1"];
const TIER_NAMES = ["PublicReputation", "Don", "TeeDon", "Zk"] as const;

export type RawVeilData = {
  requested: { requestId: Hex; agentId: bigint; policyId: Hex; commitment: Hex; requester: Address; txHash: Hash; blockNumber: bigint }[];
  recorded: { requestId: Hex; passed: boolean; tier: number; expiry: bigint; txHash: Hash }[];
  latest: { agentId: bigint; policyId: Hex; requestId: Hex }[];
  mirrored: { requestId: Hex; response: number }[];
  executed: { requestId: Hex; txHash: Hash }[];
  /** Latest block timestamp, to say whether a result is still valid. */
  now: bigint;
};

export type VeilRow = {
  requestId: Hex;
  agentId: bigint;
  agentName: string;
  requester: Address;
  policyId: Hex;
  policyName: string | null;
  commitment: Hex;
  result: "pending" | "pass" | "fail";
  tier: (typeof TIER_NAMES)[number] | null;
  expiry: bigint | null;
  expired: boolean;
  /** This request is the agent-level result for (agent, policy). */
  agentLevel: boolean;
  treasuryExecuted: boolean;
  mirroredToERC8004: boolean;
};

export type VeilView = { rows: VeilRow[]; leaks: string[]; hidden: string[] };

export async function fetchVeilData(client: PublicClient, d: Deployment): Promise<RawVeilData | null> {
  if (!d.veil) return null;
  const range = { fromBlock: BigInt(d.startBlock), toBlock: "latest" } as const;
  const registry = d.veil.privateValidationRegistry;
  const [requested, recorded, latest, mirrored, executed, block] = await Promise.all([
    client.getContractEvents({ address: registry, abi: privateValidationRegistryAbi, eventName: "PrivateValidationRequested", ...range }),
    client.getContractEvents({ address: registry, abi: privateValidationRegistryAbi, eventName: "PrivateValidationRecorded", ...range }),
    client.getContractEvents({ address: registry, abi: privateValidationRegistryAbi, eventName: "LatestRequestUpdated", ...range }),
    client.getContractEvents({ address: registry, abi: privateValidationRegistryAbi, eventName: "MirroredToERC8004", ...range }),
    client.getContractEvents({ address: d.veil.treasuryAction, abi: treasuryActionAbi, eventName: "ActionExecuted", ...range }),
    client.getBlock({ blockTag: "latest" }),
  ]);
  return {
    requested: await Promise.all(
      requested.map(async (l) => ({
        requestId: l.args.requestId!,
        agentId: l.args.agentId!,
        policyId: l.args.policyId!,
        commitment: l.args.commitment!,
        requester: getAddress((await client.getTransaction({ hash: l.transactionHash })).from),
        txHash: l.transactionHash,
        blockNumber: l.blockNumber,
      })),
    ),
    recorded: recorded.map((l) => ({
      requestId: l.args.requestId!,
      passed: l.args.passed!,
      tier: l.args.tier!,
      expiry: l.args.expiry!,
      txHash: l.transactionHash,
    })),
    latest: latest.map((l) => ({ agentId: l.args.agentId!, policyId: l.args.policyId!, requestId: l.args.requestId! })),
    mirrored: mirrored.map((l) => ({ requestId: l.args.requestId!, response: l.args.response! })),
    executed: executed.map((l) => ({ requestId: l.args.requestId!, txHash: l.transactionHash })),
    now: block.timestamp,
  };
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function buildVeilView(raw: RawVeilData, agentNames: Map<bigint, string> = new Map()): VeilView {
  const names = new Map(KNOWN_POLICY_NAMES.map((n) => [policyId(n), n]));
  const recorded = new Map(raw.recorded.map((r) => [r.requestId, r]));
  const latest = new Map<string, Hex>();
  for (const l of raw.latest) latest.set(`${l.agentId}:${l.policyId}`, l.requestId);
  const executed = new Set(raw.executed.map((e) => e.requestId));
  const mirrored = new Set(raw.mirrored.map((m) => m.requestId));

  const rows: VeilRow[] = raw.requested.map((q) => {
    const r = recorded.get(q.requestId);
    return {
      requestId: q.requestId,
      agentId: q.agentId,
      agentName: agentNames.get(q.agentId) ?? `agent #${q.agentId}`,
      requester: q.requester,
      policyId: q.policyId,
      policyName: names.get(q.policyId) ?? null,
      commitment: q.commitment,
      result: r ? (r.passed ? "pass" : "fail") : "pending",
      tier: r ? (TIER_NAMES[r.tier] ?? null) : null,
      expiry: r ? r.expiry : null,
      expired: r ? raw.now >= r.expiry : false,
      agentLevel: latest.get(`${q.agentId}:${q.policyId}`) === q.requestId,
      treasuryExecuted: executed.has(q.requestId),
      mirroredToERC8004: mirrored.has(q.requestId),
    };
  });

  const leaks = rows.map((r) => {
    const policy = r.policyName ?? short(r.policyId);
    const outcome = r.result === "pending" ? "no result yet" : `result ${r.result} (tier ${r.tier}${r.expired ? ", expired" : ""})`;
    return `validation: ${short(r.requester)} asked for ${policy} on ${r.agentName}; commitment ${short(r.commitment)}; ${outcome}`;
  });
  for (const e of raw.executed) leaks.push(`treasury action executed on request ${short(e.requestId)} (the action itself is public)`);

  const hidden = rows.length
    ? [
        "the validation input (only a salted commitment is on-chain)",
        "the salt, so the commitment cannot be brute-forced from a list of likely inputs",
        "the screening API credential (simulated locally; Confidential HTTP on CRE)",
      ]
    : [];
  return { rows, leaks, hidden };
}
