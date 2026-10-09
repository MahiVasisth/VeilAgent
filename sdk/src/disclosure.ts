// Selective disclosure (Phase 4, Flow C). The requester of one private validation hands an auditor a bundle with the
// opening of that request's commitment: {chainId, registry, requestId, agentId, policyId, input, salt}. The auditor
// recomputes the commitment, reads the request from the registry and compares. Nothing goes on-chain, and the bundle
// opens no other request: every request has its own 32-byte salt.
// exportBundle and verifyBundle do the I/O; parseBundle and auditBundle are pure.
import { getAddress, isAddress, type Address, type Hex, type PublicClient } from "viem";
import { policyRegistryAbi, privateValidationRegistryAbi } from "./abi/veil";
import { inputCommitment, policyId as policyIdOf } from "./commitments";
import { KNOWN_POLICY_NAMES } from "./indexer/veilView";

export const DISCLOSURE_VERSION = "veil8004-disclosure/1";

const TIER_NAMES = ["PublicReputation", "Don", "TeeDon", "Zk"] as const;

/** What the requester hands the auditor. `agentId` is a decimal string so uint256 values survive JSON. */
export type DisclosureBundle = {
  version: typeof DISCLOSURE_VERSION;
  chainId: number;
  registry: Address;
  requestId: Hex;
  agentId: string;
  policyId: Hex;
  input: string;
  salt: Hex;
};

/** The registry's stored request (IVeilValidation.Request), as viem decodes it. */
export type OnChainRequest = {
  agentId: bigint;
  policyId: Hex;
  commitment: Hex;
  requester: Address;
  requestedAt: bigint;
  expiry: bigint;
  tier: number;
  status: number;
};

/** What the auditor reads from the chain to judge a bundle. All of it is public. */
export type AuditContext = {
  chainId: number;
  /** The registry the auditor trusts. Without it, a bundle could point at a look-alike contract. */
  expectedRegistry?: Address;
  request: OnChainRequest;
  /** The policy's tier from PolicyRegistry, or null if the policy is unknown. */
  policyTier: number | null;
  /** `verifyResult(requestId, policyId)` at `now`. */
  currentlyValid: boolean;
  /** Latest block timestamp. */
  now: bigint;
};

export type AuditCheck = { name: string; ok: boolean; detail: string };

export type AuditReport = {
  /** True when every check passed: the bundle opens this request's commitment on the expected registry. */
  valid: boolean;
  checks: AuditCheck[];
  /** The request as the auditor now understands it. Only meaningful when `valid`. */
  request: {
    requestId: Hex;
    agentId: bigint;
    policyId: Hex;
    policyName: string | null;
    requester: Address;
    requestedAt: bigint;
    input: string;
    result: "pending" | "pass" | "fail";
    tier: string | null;
    policyTier: string | null;
    /** The reported tier is below the policy's. Recorded, not enforced on-chain (threat model). */
    tierBelowPolicy: boolean;
    expiry: bigint | null;
    expired: boolean;
    currentlyValid: boolean;
  } | null;
  /** Plain statements of what the auditor learned and what stays hidden. */
  learned: string[];
};

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

/** Serialises a bundle for handing over. The output contains a secret salt: send it only to the auditor. */
export function bundleToJson(b: DisclosureBundle): string {
  return JSON.stringify(b, null, 2);
}

/** Parses and shape-checks a bundle. Throws with a reason on anything malformed or unexpected. */
export function parseBundle(json: string): DisclosureBundle {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("bundle is not JSON");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("bundle must be a JSON object");
  const o = raw as Record<string, unknown>;
  const keys = ["version", "chainId", "registry", "requestId", "agentId", "policyId", "input", "salt"];
  const extra = Object.keys(o).filter((k) => !keys.includes(k));
  if (extra.length) throw new Error(`unexpected field(s): ${extra.join(", ")}`);
  if (o.version !== DISCLOSURE_VERSION) throw new Error(`version must be ${DISCLOSURE_VERSION}`);
  if (typeof o.chainId !== "number" || !Number.isSafeInteger(o.chainId) || o.chainId <= 0) throw new Error("chainId must be a positive integer");
  if (typeof o.registry !== "string" || !isAddress(o.registry, { strict: false })) throw new Error("registry must be an address");
  for (const k of ["requestId", "policyId", "salt"] as const) {
    if (typeof o[k] !== "string" || !BYTES32.test(o[k] as string)) throw new Error(`${k} must be 0x-prefixed 32 bytes`);
  }
  if (typeof o.agentId !== "string" || !/^(0|[1-9][0-9]*)$/.test(o.agentId) || BigInt(o.agentId) >= 2n ** 256n) {
    throw new Error("agentId must be a uint256 decimal string");
  }
  if (typeof o.input !== "string") throw new Error("input must be a string");
  return {
    version: DISCLOSURE_VERSION,
    chainId: o.chainId,
    registry: getAddress(o.registry),
    requestId: (o.requestId as string).toLowerCase() as Hex,
    agentId: o.agentId,
    policyId: (o.policyId as string).toLowerCase() as Hex,
    input: o.input,
    salt: (o.salt as string).toLowerCase() as Hex,
  };
}

/**
 * Requester side: builds the bundle for one request from its opening, after checking that the opening matches the
 * on-chain commitment (so a mistake is caught before anything is handed over). Reads only; sends nothing.
 */
export async function exportBundle(
  client: PublicClient,
  p: { registry: Address; requestId: Hex; input: string; salt: Hex },
): Promise<DisclosureBundle> {
  const [chainId, request] = await Promise.all([
    client.getChainId(),
    client.readContract({ address: p.registry, abi: privateValidationRegistryAbi, functionName: "getRequest", args: [p.requestId] }),
  ]);
  if (request.status === 0) throw new Error(`no request ${p.requestId} on registry ${p.registry}`);
  const commitment = inputCommitment({ agentId: request.agentId, policyId: request.policyId, input: p.input, salt: p.salt });
  if (commitment !== request.commitment) throw new Error("this input and salt do not open the request's commitment");
  return {
    version: DISCLOSURE_VERSION,
    chainId,
    registry: getAddress(p.registry),
    requestId: p.requestId.toLowerCase() as Hex,
    agentId: request.agentId.toString(),
    policyId: request.policyId.toLowerCase() as Hex,
    input: p.input,
    salt: p.salt.toLowerCase() as Hex,
  };
}

/**
 * Auditor side: reads the request, the policy and the current result from the chain (eth_call only) and judges the
 * bundle. Pass `expectedRegistry` (the registry you trust); otherwise the bundle's own registry is taken on faith.
 */
export async function verifyBundle(client: PublicClient, bundle: DisclosureBundle, expectedRegistry?: Address): Promise<AuditReport> {
  const registry = bundle.registry;
  const [chainId, request, block] = await Promise.all([
    client.getChainId(),
    client.readContract({ address: registry, abi: privateValidationRegistryAbi, functionName: "getRequest", args: [bundle.requestId] }).catch(() => null),
    client.getBlock({ blockTag: "latest" }),
  ]);
  if (!request) {
    return judge(bundle, { chainId, expectedRegistry, request: EMPTY_REQUEST, policyTier: null, currentlyValid: false, now: block.timestamp }, false);
  }
  const [policyRegistry, currentlyValid] = await Promise.all([
    client.readContract({ address: registry, abi: privateValidationRegistryAbi, functionName: "policyRegistry" }),
    client.readContract({ address: registry, abi: privateValidationRegistryAbi, functionName: "verifyResult", args: [bundle.requestId, request.policyId] }),
  ]);
  const policy = await client.readContract({ address: policyRegistry, abi: policyRegistryAbi, functionName: "getPolicy", args: [request.policyId] });
  return auditBundle(bundle, {
    chainId,
    expectedRegistry,
    request,
    policyTier: policy.owner === "0x0000000000000000000000000000000000000000" ? null : policy.tier,
    currentlyValid,
    now: block.timestamp,
  });
}

const EMPTY_REQUEST: OnChainRequest = {
  agentId: 0n,
  policyId: `0x${"00".repeat(32)}`,
  commitment: `0x${"00".repeat(32)}`,
  requester: "0x0000000000000000000000000000000000000000",
  requestedAt: 0n,
  expiry: 0n,
  tier: 0,
  status: 0,
};

/** Pure: judges a bundle against what the auditor read from the chain. */
export function auditBundle(bundle: DisclosureBundle, ctx: AuditContext): AuditReport {
  return judge(bundle, ctx, true);
}

function judge(bundle: DisclosureBundle, ctx: AuditContext, registryReadable: boolean): AuditReport {
  const r = ctx.request;
  const checks: AuditCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  add("chain", bundle.chainId === ctx.chainId, `bundle names chain ${bundle.chainId}; the auditor is reading chain ${ctx.chainId}`);
  if (ctx.expectedRegistry) {
    const ok = getAddress(bundle.registry) === getAddress(ctx.expectedRegistry);
    add("registry", ok, ok ? `the expected PrivateValidationRegistry ${ctx.expectedRegistry}` : `bundle names ${bundle.registry}, expected ${ctx.expectedRegistry}`);
  } else {
    add("registry", registryReadable, `${bundle.registry} (not compared against a trusted address)`);
  }
  if (!registryReadable) {
    add("request exists", false, `could not read a PrivateValidationRegistry at ${bundle.registry}`);
    return { valid: false, checks, request: null, learned: [] };
  }
  const exists = r.status !== 0;
  add("request exists", exists, exists ? `request ${bundle.requestId} is on the registry` : `no request ${bundle.requestId} on the registry`);
  add("agent", exists && BigInt(bundle.agentId) === r.agentId, `bundle names agent ${bundle.agentId}; the request is for agent ${exists ? r.agentId : "-"}`);
  add("policy", exists && bundle.policyId.toLowerCase() === r.policyId.toLowerCase(), `bundle names ${policyLabel(bundle.policyId)}; the request is under ${exists ? policyLabel(r.policyId) : "-"}`);
  const recomputed = inputCommitment({ agentId: BigInt(bundle.agentId), policyId: bundle.policyId, input: bundle.input, salt: bundle.salt });
  const opens = exists && recomputed === r.commitment;
  add("commitment", opens, opens ? `keccak256(agent, policy, keccak256(input), salt) equals the on-chain commitment ${r.commitment}` : `recomputed ${recomputed}, on-chain ${exists ? r.commitment : "-"}`);

  const valid = checks.every((c) => c.ok);
  if (!valid) return { valid, checks, request: null, learned: ["nothing: the bundle does not open this request"] };

  const result = r.status === 2 ? "pass" : r.status === 3 ? "fail" : "pending";
  const recorded = result !== "pending";
  const tier = recorded ? (TIER_NAMES[r.tier] ?? `tier ${r.tier}`) : null;
  const policyTier = ctx.policyTier === null ? null : (TIER_NAMES[ctx.policyTier] ?? `tier ${ctx.policyTier}`);
  const request = {
    requestId: bundle.requestId,
    agentId: r.agentId,
    policyId: r.policyId,
    policyName: policyName(r.policyId),
    requester: r.requester,
    requestedAt: r.requestedAt,
    input: bundle.input,
    result: result as "pending" | "pass" | "fail",
    tier,
    policyTier,
    tierBelowPolicy: recorded && ctx.policyTier !== null && r.tier < ctx.policyTier,
    expiry: recorded ? r.expiry : null,
    expired: recorded && ctx.now >= r.expiry,
    currentlyValid: ctx.currentlyValid,
  };
  const outcome = recorded
    ? `the validator recorded ${result} at tier ${tier}${request.tierBelowPolicy ? `, below the policy's ${policyTier} (recorded, not enforced)` : ""}, ` +
      `valid until ${new Date(Number(r.expiry) * 1000).toISOString()}${request.expired ? " (expired)" : ""}`
    : "no result has been recorded yet";
  return {
    valid,
    checks,
    request,
    learned: [
      `the input of request ${short(bundle.requestId)}: ${JSON.stringify(bundle.input)}, bound to its on-chain commitment`,
      `${outcome}; verifyResult is ${ctx.currentlyValid} now`,
      `already public, now tied to that input: requester ${r.requester}, agent ${r.agentId}, ${request.policyName ?? r.policyId}`,
      "nothing about any other request: each has its own salt, and this bundle carries no other opening",
    ],
  };
}

function policyName(id: Hex): string | null {
  return KNOWN_POLICY_NAMES.find((n) => policyIdOf(n) === id.toLowerCase()) ?? null;
}
const policyLabel = (id: Hex) => policyName(id) ?? short(id);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
