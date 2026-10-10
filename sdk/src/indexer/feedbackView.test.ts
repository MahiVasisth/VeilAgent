import { describe, expect, test } from "bun:test";
import { keccak256, stringToBytes, type Address, type Hex } from "viem";
import { buildFeedbackView, formatAverage, type RawFeedbackData } from "./feedbackView";

const id = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const CAT = keccak256(stringToBytes("sanctions-screening"));
const CLIENT_A = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" as Address;
const CLIENT_B = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc" as Address;
const FRESH = "0x1111111111111111111111111111111111111111" as Address;

const raw: RawFeedbackData = {
  receipts: [
    { taskId: 1n, category: CAT, epoch: 10n, groupId: 0n, agentId: 1n, client: CLIENT_A },
    { taskId: 2n, category: CAT, epoch: 10n, groupId: 0n, agentId: 1n, client: CLIENT_B },
    { taskId: 3n, category: CAT, epoch: 10n, groupId: 0n, agentId: 0n, client: null },
  ],
  groupSizes: { "0": 3 },
  ratings: [
    { agentId: 1n, epoch: 10n, category: CAT, score: 5, nullifier: 111n, sender: FRESH, txHash: id(1) },
    { agentId: 1n, epoch: 10n, category: CAT, score: 5, nullifier: 222n, sender: FRESH, txHash: id(2) },
    { agentId: 1n, epoch: 10n, category: CAT, score: 4, nullifier: 333n, sender: FRESH, txHash: id(3) },
    { agentId: 0n, epoch: 10n, category: CAT, score: 4, nullifier: 444n, sender: CLIENT_B, txHash: id(4) },
  ],
  anchors: [{ agentId: 1n, epoch: 10n, value: 466n, count: 3n, txHash: id(5) }],
  epochLength: 100n,
  ratingWindow: 50n,
  now: 1120n, // epoch 10 ratings close at 11 * 100 + 50 = 1150
};

describe("buildFeedbackView", () => {
  const view = buildFeedbackView(raw, new Map([[0n, "Atlas"], [1n, "Borealis"]]));

  test("ratings carry agent, epoch, score and anonymity set, never a rater", () => {
    expect(view.ratings.map((r) => [r.agentName, r.score, r.anonymitySet, r.categoryName])).toEqual([
      ["Borealis", 5, 3, "sanctions-screening"],
      ["Borealis", 5, 3, "sanctions-screening"],
      ["Borealis", 4, 3, "sanctions-screening"],
      ["Atlas", 4, 3, "sanctions-screening"],
    ]);
  });

  test("aggregates round down like the contract and track the window", () => {
    expect(view.aggregates.map((a) => [a.agentName, a.count, a.average, a.status, a.anchoredValue])).toEqual([
      ["Borealis", 3, 466n, "anchored", 466n],
      ["Atlas", 1, 400n, "open", null],
    ]);
    const closed = buildFeedbackView({ ...raw, now: 1150n }).aggregates.find((a) => a.agentId === 0n);
    expect(closed?.status).toBe("closed");
  });

  test("flags a rating sent from a client's own address", () => {
    expect(view.ratings.map((r) => r.senderIsClient)).toEqual([false, false, false, true]);
    expect(view.leaks.some((l) => l.includes("a client's own address"))).toBe(true);
  });

  test("leaks list receipts, ratings and anchors; hidden names the rater", () => {
    expect(view.leaks.filter((l) => l.startsWith("receipt:"))).toHaveLength(3);
    expect(view.leaks.filter((l) => l.startsWith("rating:"))).toHaveLength(4);
    expect(view.leaks.find((l) => l.startsWith("anchored:"))).toContain("4.66");
    expect(view.hidden[0]).toContain("which receipt holder");
  });

  test("formatAverage", () => {
    expect([466n, 400n, 105n, 0n].map(formatAverage)).toEqual(["4.66", "4.00", "1.05", "0.00"]);
  });
});
