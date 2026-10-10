import { describe, expect, test } from "bun:test";
import type { Hash } from "viem";
import { buildCostView, formatGas, type RawCostData } from "./costView";

const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hash;

describe("buildCostView", () => {
  const raw: RawCostData = {
    forwarderIsMock: true,
    samples: [
      { op: "bid", txHash: tx(1), gasUsed: 100n },
      { op: "bid", txHash: tx(2), gasUsed: 300n },
      { op: "bid", txHash: tx(3), gasUsed: 200n },
      { op: "requestPrivate", txHash: tx(4), gasUsed: 90n },
      { op: "requestPrivate", txHash: tx(5), gasUsed: 110n },
      { op: "w1Report", txHash: tx(6), gasUsed: 50n },
      { op: "w1Report", txHash: tx(6), gasUsed: 50n }, // same transaction twice: one sample
      { op: "plainFeedback", txHash: tx(7), gasUsed: 70n },
    ],
  };
  const view = buildCostView(raw);

  test("one row per measured operation, plain first, in the panel's order", () => {
    expect(view.rows.map((r) => r.op)).toEqual(["plainFeedback", "requestPrivate", "w1Report", "bid"]);
  });

  test("min, median and max per transaction", () => {
    const bid = view.rows.find((r) => r.op === "bid")!;
    expect([bid.count, bid.min, bid.median, bid.max]).toEqual([3, 100n, 200n, 300n]);
    const req = view.rows.find((r) => r.op === "requestPrivate")!;
    expect(req.median).toBe(100n); // even count: mean of the middle two
    expect(view.rows.find((r) => r.op === "w1Report")!.count).toBe(1);
  });

  test("attestation total is request + W1 result, only once both exist", () => {
    expect(view.attestationTotal).toBe(150n);
    expect(buildCostView({ ...raw, samples: raw.samples.filter((s) => s.op !== "w1Report") }).attestationTotal).toBeNull();
    expect(view.forwarderIsMock).toBe(true);
  });

  test("formatGas", () => {
    expect(formatGas(1234567n)).toBe("1,234,567");
    expect(formatGas(12n)).toBe("12");
  });
});
