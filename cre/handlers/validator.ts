// W1 Validator: pure handler steps, shared by the CRE workflow (cre/workflows/w1-validator) and the local DON
// simulation (cre/local-runner). No I/O here: callers fetch the sealed payload, call the screening API, and deliver
// the report. Runs under QuickJS in CRE, so it uses only viem and the noble-based seal module.
//
//   prepareValidation(event, sealedPayload, decryptKey)  -> { subject } | stop      (decrypt + commitment check)
//   finishValidation(prepared, screening, now, window)   -> report bytes            (decision + expiry + encoding)
import { decodeAbiParameters, decodeEventLog, encodeAbiParameters, type Hex } from "viem";
import { inputCommitment, policyId } from "@veil8004/sdk/commitments";
import { open } from "@veil8004/sdk/seal";
import { privateValidationRegistryAbi } from "@veil8004/sdk/abi/veil";

/** IAssuranceTier.Tier. W1 reports Don in a standard workflow and TeeDon only as a Confidential Workflow. */
export const Tier = { PublicReputation: 0, Don: 1, TeeDon: 2, Zk: 3 } as const;
export type TierValue = (typeof Tier)[keyof typeof Tier];

/** Policies W1 knows how to evaluate. Anything else stops without a report. */
export const W1_POLICIES = { SANCTIONS_SCREEN_V1: policyId("SANCTIONS_SCREEN_V1") } as const;

export type ValidationRequest = { requestId: Hex; agentId: bigint; policyId: Hex; commitment: Hex };
export type Stop = { stop: true; reason: string };
export type Prepared = { stop: false; request: ValidationRequest; subject: string };
export type ScreeningResult = { hit: boolean };
export type ValidatorReport = {
  requestId: Hex;
  commitment: Hex;
  passed: boolean;
  policyId: Hex;
  tier: TierValue;
  expiry: bigint;
};

const REPORT_PARAMS = [
  { type: "bytes32" }, // requestId
  { type: "bytes32" }, // commitment
  { type: "bool" }, // passed
  { type: "bytes32" }, // policyId
  { type: "uint8" }, // tier
  { type: "uint64" }, // expiry
] as const;

/** Decodes a PrivateValidationRequested log (the W1 trigger). */
export function decodeValidationRequested(log: { topics: Hex[]; data: Hex }): ValidationRequest {
  const { eventName, args } = decodeEventLog({
    abi: privateValidationRegistryAbi,
    eventName: "PrivateValidationRequested",
    topics: log.topics as [Hex, ...Hex[]],
    data: log.data,
  });
  if (eventName !== "PrivateValidationRequested") throw new Error(`unexpected event ${eventName}`);
  return { requestId: args.requestId, agentId: args.agentId, policyId: args.policyId, commitment: args.commitment };
}

const stop = (reason: string): Stop => ({ stop: true, reason });
const isW1Policy = (id: Hex) => (Object.values(W1_POLICIES) as Hex[]).includes(id);

/** Opens the sealed `{input, salt}` and recomputes the commitment. Stops (no report) on a missing or undecryptable
 *  payload, a malformed opening, a commitment mismatch, or a policy W1 does not evaluate. */
export function prepareValidation(
  request: ValidationRequest,
  sealedPayload: string | null,
  decryptKeyB64: string,
): Prepared | Stop {
  if (!isW1Policy(request.policyId)) return stop("unsupported policy");
  if (sealedPayload === null) return stop("no sealed payload");

  let opening: unknown;
  try {
    opening = open(decryptKeyB64, sealedPayload);
  } catch {
    return stop("payload does not open with the W1 key");
  }
  const { input, salt } = (opening ?? {}) as { input?: unknown; salt?: unknown };
  if (typeof input !== "string" || typeof salt !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(salt))
    return stop("malformed opening: expected {input: string, salt: bytes32}");

  const recomputed = inputCommitment({ agentId: request.agentId, policyId: request.policyId, input, salt: salt as Hex });
  if (recomputed.toLowerCase() !== request.commitment.toLowerCase()) return stop("commitment mismatch");

  // SANCTIONS_SCREEN_V1: the input is the subject to screen.
  return { stop: false, request, subject: input };
}

/** Expiry for a result decided at `now`: inside (now, now + validityWindow], with a small margin so that clock skew
 *  between the deciding clock and the block that includes the report cannot push it past the on-chain limit. */
export function expiryFor(nowSeconds: bigint, validityWindow: bigint): bigint {
  if (validityWindow <= 0n) throw new Error("validityWindow must be positive");
  const margin = validityWindow / 10n < 60n ? validityWindow / 10n : 60n;
  return nowSeconds + validityWindow - margin;
}

/** Turns the screening answer into the W1 report. A hit fails the screen. */
export function finishValidation(
  prepared: Prepared,
  screening: ScreeningResult,
  nowSeconds: bigint,
  validityWindow: bigint,
  tier: TierValue,
): { report: Hex; decoded: ValidatorReport } {
  if (typeof screening?.hit !== "boolean") throw new Error("screening response must be {hit: boolean}");
  const decoded: ValidatorReport = {
    requestId: prepared.request.requestId,
    commitment: prepared.request.commitment,
    passed: !screening.hit,
    policyId: prepared.request.policyId,
    tier,
    expiry: expiryFor(nowSeconds, validityWindow),
  };
  return { report: encodeValidatorReport(decoded), decoded };
}

export function encodeValidatorReport(r: ValidatorReport): Hex {
  return encodeAbiParameters(REPORT_PARAMS, [r.requestId, r.commitment, r.passed, r.policyId, r.tier, r.expiry]);
}

export function decodeValidatorReport(report: Hex): ValidatorReport {
  const [requestId, commitment, passed, pid, tier, expiry] = decodeAbiParameters(REPORT_PARAMS, report);
  return { requestId, commitment, passed, policyId: pid, tier: tier as TierValue, expiry };
}

/** I/O the orchestrator needs. The local runner supplies HTTP and RPC; tests supply fakes. */
export type ValidatorDeps = {
  fetchSealedPayload(requestId: Hex): Promise<string | null>;
  decryptKey: string;
  screen(subject: string): Promise<ScreeningResult>;
  validityWindow(policyId: Hex): Promise<bigint>;
  now(): Promise<bigint>;
  tier: TierValue;
};

/** Composes the pure steps with async I/O. Returns the report to deliver, or why W1 stopped. */
export async function runValidator(
  request: ValidationRequest,
  deps: ValidatorDeps,
): Promise<{ stop: false; report: Hex; decoded: ValidatorReport } | Stop> {
  if (!isW1Policy(request.policyId)) return stop("unsupported policy"); // no need to wait for a payload
  const prepared = prepareValidation(request, await deps.fetchSealedPayload(request.requestId), deps.decryptKey);
  if (prepared.stop) return prepared;
  const screening = await deps.screen(prepared.subject);
  const window = await deps.validityWindow(request.policyId);
  return { stop: false, ...finishValidation(prepared, screening, await deps.now(), window, deps.tier) };
}
