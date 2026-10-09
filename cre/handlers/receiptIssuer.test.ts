import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, keccak256, toHex, type Hex } from "viem";
import { sealedBidHiringAbi } from "@veil8004/sdk/abi/veil";
import {
  checkTask,
  decodeJobCompleted,
  decodeReceiptReport,
  encodeReceiptReport,
  runReceiptIssuer,
  SNARK_SCALAR_FIELD,
  TASK_COMPLETED,
  type JobCompleted,
  type TaskView,
} from "./receiptIssuer";

const CATEGORY = keccak256(toHex("sanctions-screening"));
const COMMITMENT = 1234567890123456789n;
const EVENT: JobCompleted = { taskId: 7n, agentId: 3n, category: CATEGORY, identityCommitment: COMMITMENT };
const completed: TaskView = { status: TASK_COMPLETED, identityCommitment: COMMITMENT };

const deps = (task: TaskView, issued = false) => ({
  readTask: async () => task,
  receiptIssued: async () => issued,
});

describe("W2 receipt issuer handler", () => {
  test("decodes the trigger log", () => {
    const topics = encodeEventTopics({
      abi: sealedBidHiringAbi,
      eventName: "JobCompleted",
      args: { taskId: EVENT.taskId, agentId: EVENT.agentId },
    }) as Hex[];
    const data = encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [CATEGORY, COMMITMENT]);
    expect(decodeJobCompleted({ topics, data })).toEqual(EVENT);
  });

  test("report is abi.encode(uint256 taskId)", () => {
    const report = encodeReceiptReport(7n);
    expect(report).toBe(encodeAbiParameters([{ type: "uint256" }], [7n]));
    expect(decodeReceiptReport(report)).toEqual({ taskId: 7n });
  });

  test("completed task with a commitment -> report", async () => {
    const out = await runReceiptIssuer(EVENT, deps(completed));
    if (out.stop) throw new Error(out.reason);
    expect(decodeReceiptReport(out.report)).toEqual({ taskId: 7n });
  });

  test("reads the task from chain, not the event", async () => {
    // The event claims a commitment, but the stored task has none: no report.
    const out = await runReceiptIssuer(EVENT, deps({ status: TASK_COMPLETED, identityCommitment: 0n }));
    expect(out.stop).toBe(true);
  });

  test.each([
    ["Open", { status: 1, identityCommitment: COMMITMENT }, false, /not Completed/],
    ["Awarded", { status: 3, identityCommitment: COMMITMENT }, false, /not Completed/],
    ["NoAward", { status: 4, identityCommitment: COMMITMENT }, false, /not Completed/],
    ["no commitment", { status: TASK_COMPLETED, identityCommitment: 0n }, false, /no identity commitment/],
    ["outside the field", { status: TASK_COMPLETED, identityCommitment: SNARK_SCALAR_FIELD }, false, /SNARK field/],
    ["already issued", completed, true, /already issued/],
  ] as const)("stops: %s", (_name, task, issued, reason) => {
    expect(checkTask(7n, task, issued)).toMatch(reason);
  });

  test("largest in-field commitment is accepted", () => {
    expect(checkTask(7n, { status: TASK_COMPLETED, identityCommitment: SNARK_SCALAR_FIELD - 1n }, false)).toBeNull();
  });
});
