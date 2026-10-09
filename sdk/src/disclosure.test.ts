// Selective disclosure (Phase 4): bundle parsing and the auditor's judgement, without a chain.
import { describe, expect, test } from "bun:test";
import type { Address, Hex } from "viem";
import { inputCommitment, policyId, randomSalt } from "./commitments";
import { auditBundle, bundleToJson, DISCLOSURE_VERSION, parseBundle, type AuditContext, type DisclosureBundle } from "./disclosure";

const REGISTRY = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707" as Address;
const SANCTIONS = policyId("SANCTIONS_SCREEN_V1");
const REQUEST_ID = `0x${"ab".repeat(32)}` as Hex;
const NOW = 1_800_000_000n;

function fixture(input = "Northwind Trading LLC") {
  const salt = randomSalt();
  const bundle: DisclosureBundle = {
    version: DISCLOSURE_VERSION,
    chainId: 31337,
    registry: REGISTRY,
    requestId: REQUEST_ID,
    agentId: "1",
    policyId: SANCTIONS,
    input,
    salt,
  };
  const ctx: AuditContext = {
    chainId: 31337,
    expectedRegistry: REGISTRY,
    request: {
      agentId: 1n,
      policyId: SANCTIONS,
      commitment: inputCommitment({ agentId: 1n, policyId: SANCTIONS, input, salt }),
      requester: "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
      requestedAt: NOW - 100n,
      expiry: NOW + 3600n,
      tier: 1, // Don
      status: 2, // Passed
    },
    policyTier: 1,
    currentlyValid: true,
    now: NOW,
  };
  return { bundle, ctx };
}

const failed = (r: ReturnType<typeof auditBundle>) => r.checks.filter((c) => !c.ok).map((c) => c.name);

describe("auditBundle", () => {
  test("a correct bundle opens the request and reports its result", () => {
    const { bundle, ctx } = fixture();
    const r = auditBundle(bundle, ctx);
    expect(r.valid).toBe(true);
    expect(r.checks.map((c) => c.name)).toEqual(["chain", "registry", "request exists", "agent", "policy", "commitment"]);
    expect(r.request).toMatchObject({ input: "Northwind Trading LLC", result: "pass", tier: "Don", policyName: "SANCTIONS_SCREEN_V1", expired: false, currentlyValid: true, tierBelowPolicy: false });
  });

  test("reports fail, pending and expired results as they are", () => {
    const f = fixture();
    expect(auditBundle(f.bundle, { ...f.ctx, request: { ...f.ctx.request, status: 3 } }).request?.result).toBe("fail");
    const p = auditBundle(f.bundle, { ...f.ctx, request: { ...f.ctx.request, status: 1, expiry: 0n }, currentlyValid: false });
    expect(p.valid).toBe(true);
    expect(p.request).toMatchObject({ result: "pending", tier: null, expiry: null, expired: false });
    const e = auditBundle(f.bundle, { ...f.ctx, now: f.ctx.request.expiry, currentlyValid: false });
    expect(e.request).toMatchObject({ result: "pass", expired: true, currentlyValid: false });
  });

  test("flags a tier below the policy's (recorded, not enforced)", () => {
    const { bundle, ctx } = fixture();
    const r = auditBundle(bundle, { ...ctx, policyTier: 2 });
    expect(r.valid).toBe(true);
    expect(r.request?.tierBelowPolicy).toBe(true);
    expect(r.learned.join(" ")).toContain("below the policy's TeeDon");
  });

  test("each tampered field fails its own check and reveals nothing", () => {
    const { bundle, ctx } = fixture();
    const cases: [Partial<DisclosureBundle>, string[]][] = [
      [{ input: "Kestrel Shipping Co" }, ["commitment"]],
      [{ salt: randomSalt() }, ["commitment"]],
      [{ agentId: "2" }, ["agent", "commitment"]],
      [{ policyId: policyId("OTHER_POLICY_V1") }, ["policy", "commitment"]],
      [{ chainId: 10143 }, ["chain"]],
      [{ registry: "0x0000000000000000000000000000000000000001" }, ["registry"]],
    ];
    for (const [change, expected] of cases) {
      const r = auditBundle({ ...bundle, ...change }, ctx);
      expect(r.valid).toBe(false);
      expect(failed(r)).toEqual(expected);
      expect(r.request).toBeNull();
    }
  });

  test("an opening pointed at another request does not open it", () => {
    const a = fixture("Northwind Trading LLC");
    const b = fixture("Harbor Light Ventures");
    const r = auditBundle({ ...a.bundle, requestId: `0x${"cd".repeat(32)}` }, b.ctx);
    expect(failed(r)).toEqual(["commitment"]);
  });

  test("an unknown request id fails", () => {
    const { bundle, ctx } = fixture();
    const r = auditBundle(bundle, { ...ctx, request: { ...ctx.request, status: 0 } });
    expect(failed(r)).toContain("request exists");
  });
});

describe("parseBundle", () => {
  test("round-trips and normalises case", () => {
    const { bundle } = fixture();
    const upper = { ...bundle, registry: REGISTRY.toLowerCase(), salt: bundle.salt.toUpperCase().replace("0X", "0x") };
    expect(parseBundle(JSON.stringify(upper))).toEqual(bundle);
    expect(parseBundle(bundleToJson(bundle))).toEqual(bundle);
  });

  test("keeps a uint256 agent id exact", () => {
    const { bundle } = fixture();
    const big = (2n ** 256n - 1n).toString();
    expect(parseBundle(JSON.stringify({ ...bundle, agentId: big })).agentId).toBe(big);
  });

  test("rejects malformed bundles", () => {
    const { bundle } = fixture();
    const bad: [unknown, string][] = [
      ["not json", "not JSON"],
      [[], "JSON object"],
      [{ ...bundle, version: "other" }, "version"],
      [{ ...bundle, extra: 1 }, "unexpected field"],
      [{ ...bundle, chainId: "31337" }, "chainId"],
      [{ ...bundle, registry: "0x1234" }, "registry"],
      [{ ...bundle, salt: "0x1234" }, "salt"],
      [{ ...bundle, agentId: 1 }, "agentId"],
      [{ ...bundle, agentId: "-1" }, "agentId"],
      [{ ...bundle, agentId: (2n ** 256n).toString() }, "agentId"],
      [{ ...bundle, input: 5 }, "input"],
    ];
    for (const [value, msg] of bad) {
      expect(() => parseBundle(typeof value === "string" ? value : JSON.stringify(value))).toThrow(msg);
    }
  });
});
