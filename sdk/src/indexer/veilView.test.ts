import { describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import { policyId } from "../commitments";
import { buildVeilView, type RawVeilData } from "./veilView";

const id = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const SANCTIONS = policyId("SANCTIONS_SCREEN_V1");
const OPERATOR = "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955";

const raw: RawVeilData = {
  requested: [
    { requestId: id(1), agentId: 0n, policyId: SANCTIONS, commitment: id(101), requester: OPERATOR, txHash: id(201), blockNumber: 10n },
    { requestId: id(2), agentId: 1n, policyId: SANCTIONS, commitment: id(102), requester: OPERATOR, txHash: id(202), blockNumber: 11n },
    { requestId: id(3), agentId: 0n, policyId: policyId("UNLISTED"), commitment: id(103), requester: OPERATOR, txHash: id(203), blockNumber: 12n },
  ],
  recorded: [
    { requestId: id(1), passed: true, tier: 1, expiry: 5000n, txHash: id(301) },
    { requestId: id(2), passed: false, tier: 1, expiry: 900n, txHash: id(302) },
  ],
  latest: [{ agentId: 0n, policyId: SANCTIONS, requestId: id(1) }],
  mirrored: [{ requestId: id(1), response: 100 }],
  executed: [{ requestId: id(1), txHash: id(401) }],
  now: 1000n,
};

describe("buildVeilView", () => {
  const view = buildVeilView(raw, new Map([[0n, "Atlas"], [1n, "Borealis"]]));

  test("rows carry commitment, policy and result only", () => {
    expect(view.rows.map((r) => [r.agentName, r.policyName, r.result, r.tier, r.expired])).toEqual([
      ["Atlas", "SANCTIONS_SCREEN_V1", "pass", "Don", false],
      ["Borealis", "SANCTIONS_SCREEN_V1", "fail", "Don", true],
      ["Atlas", null, "pending", null, false],
    ]);
    expect(view.rows[0]).toMatchObject({ commitment: id(101), agentLevel: true, treasuryExecuted: true, mirroredToERC8004: true });
    expect(view.rows[1]!.agentLevel).toBe(false);
  });

  test("leak lines name what an observer learns", () => {
    expect(view.leaks).toHaveLength(4);
    expect(view.leaks[0]).toContain("SANCTIONS_SCREEN_V1 on Atlas");
    expect(view.leaks[0]).toContain("result pass");
    expect(view.leaks[2]).toContain("no result yet");
    expect(view.leaks[3]).toContain("treasury action executed");
    expect(view.hidden[0]).toContain("validation input");
  });

  test("empty chain -> empty view", () => {
    expect(buildVeilView({ requested: [], recorded: [], latest: [], mirrored: [], executed: [], now: 0n })).toEqual({
      rows: [],
      leaks: [],
      hidden: [],
    });
  });
});
