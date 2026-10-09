// W2 Receipt issuer: pure handler steps, shared by the CRE workflow (cre/workflows/w2-receipt-issuer) and the local DON
// simulation (cre/local-runner). No I/O here: callers read the task from chain and deliver the report. Runs under
// QuickJS in CRE, so it uses only viem.
//
//   decodeJobCompleted(log)          -> JobCompleted          (the trigger)
//   checkTask(taskId, task, issued)  -> stop reason | null    (mirrors ReceiptGroupManager's reverts)
//   encodeReceiptReport(taskId)      -> report bytes          (abi.encode(uint256 taskId), SPEC W2 payload)
//
// The report names only the task. ReceiptGroupManager reads the commitment, category and agent back from
// SealedBidHiring, so W2 cannot choose them; the checks here only avoid delivering a report that would revert.
import { decodeAbiParameters, decodeEventLog, encodeAbiParameters, type Hex } from "viem";
import { sealedBidHiringAbi } from "@veil8004/sdk/abi/veil";

export type JobCompleted = { taskId: bigint; agentId: bigint; category: Hex; identityCommitment: bigint };
/** The fields of SealedBidHiring.getTask that W2 checks. */
export type TaskView = { status: number; identityCommitment: bigint };

/** SealedBidHiring.TaskStatus.Completed. */
export const TASK_COMPLETED = 5;
/** BN254 scalar field. Semaphore reverts on a leaf outside it. */
export const SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const REPORT_PARAMS = [{ type: "uint256" }] as const;

/** Decodes a JobCompleted log (the W2 trigger). */
export function decodeJobCompleted(log: { topics: Hex[]; data: Hex }): JobCompleted {
  const { eventName, args } = decodeEventLog({
    abi: sealedBidHiringAbi,
    eventName: "JobCompleted",
    topics: log.topics as [Hex, ...Hex[]],
    data: log.data,
  });
  if (eventName !== "JobCompleted") throw new Error(`unexpected event ${eventName}`);
  return { taskId: args.taskId, agentId: args.agentId, category: args.category, identityCommitment: args.identityCommitment };
}

/** Why no receipt should be issued for this task, or null if the report would be accepted. Reads the task from chain
 *  rather than trusting the event, as ReceiptGroupManager does. */
export function checkTask(taskId: bigint, task: TaskView, receiptIssued: boolean): string | null {
  if (receiptIssued) return `task ${taskId}: receipt already issued`;
  if (task.status !== TASK_COMPLETED) return `task ${taskId}: not Completed (status ${task.status})`;
  if (task.identityCommitment === 0n) return `task ${taskId}: no identity commitment, no receipt (docs/phase0.md P5-5)`;
  if (task.identityCommitment >= SNARK_SCALAR_FIELD) return `task ${taskId}: identity commitment outside the SNARK field`;
  return null;
}

export function encodeReceiptReport(taskId: bigint): Hex {
  return encodeAbiParameters(REPORT_PARAMS, [taskId]);
}

export function decodeReceiptReport(report: Hex): { taskId: bigint } {
  const [taskId] = decodeAbiParameters(REPORT_PARAMS, report);
  return { taskId };
}

/** I/O the orchestrator needs. The local runner supplies RPC; tests supply fakes. */
export type ReceiptIssuerDeps = {
  readTask(taskId: bigint): Promise<TaskView>;
  receiptIssued(taskId: bigint): Promise<boolean>;
};

export type ReceiptIssuerResult = { stop: true; reason: string } | { stop: false; report: Hex; taskId: bigint };

/** Composes the pure steps with async I/O. */
export async function runReceiptIssuer(event: JobCompleted, deps: ReceiptIssuerDeps): Promise<ReceiptIssuerResult> {
  const [task, issued] = await Promise.all([deps.readTask(event.taskId), deps.receiptIssued(event.taskId)]);
  const reason = checkTask(event.taskId, task, issued);
  if (reason !== null) return { stop: true, reason };
  return { stop: false, report: encodeReceiptReport(event.taskId), taskId: event.taskId };
}
