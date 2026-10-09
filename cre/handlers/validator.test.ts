import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { inputCommitment, policyId, randomSalt } from "@veil8004/sdk/commitments";
import { generateKeyPair, sealFor } from "@veil8004/sdk/seal";
import { privateValidationRegistryAbi } from "@veil8004/sdk/abi/veil";
import {
  decodeValidationRequested,
  decodeValidatorReport,
  expiryFor,
  finishValidation,
  prepareValidation,
  runValidator,
  Tier,
  W1_POLICIES,
  type ValidationRequest,
  type ValidatorDeps,
} from "./validator";

const W1 = generateKeyPair();
const SANCTIONS = W1_POLICIES.SANCTIONS_SCREEN_V1;
const REQUEST_ID = `0x${"aa".repeat(32)}` as Hex;

function fixture(input = "Northwind Trading LLC", agentId = 3n) {
  const salt = randomSalt();
  const request: ValidationRequest = {
    requestId: REQUEST_ID,
    agentId,
    policyId: SANCTIONS,
    commitment: inputCommitment({ agentId, policyId: SANCTIONS, input, salt }),
  };
  return { request, salt, sealed: sealFor(W1.publicKey, { input, salt }) };
}

const deps = (sealed: string | null, hit = false): ValidatorDeps => ({
  fetchSealedPayload: async () => sealed,
  decryptKey: W1.secretKey,
  screen: async () => ({ hit }),
  validityWindow: async () => 3600n,
  now: async () => 1_000_000n,
  tier: Tier.Don,
});

describe("W1 validator handler", () => {
  test("decodes the trigger log", () => {
    const { request } = fixture();
    const topics = encodeEventTopics({
      abi: privateValidationRegistryAbi,
      eventName: "PrivateValidationRequested",
      args: { requestId: request.requestId, agentId: request.agentId, policyId: request.policyId },
    }) as Hex[];
    const data = encodeAbiParameters([{ type: "bytes32" }], [request.commitment]);
    expect(decodeValidationRequested({ topics, data })).toEqual(request);
  });

  test("valid opening -> pass report with the stored commitment and policy", async () => {
    const { request, sealed } = fixture();
    const out = await runValidator(request, deps(sealed, false));
    if (out.stop) throw new Error(out.reason);
    expect(decodeValidatorReport(out.report)).toEqual({
      requestId: REQUEST_ID,
      commitment: request.commitment,
      passed: true,
      policyId: SANCTIONS,
      tier: Tier.Don,
      expiry: 1_000_000n + 3600n - 60n,
    });
  });

  test("screening hit -> fail report", async () => {
    const { request, sealed } = fixture("Kestrel Shipping Co");
    const out = await runValidator(request, deps(sealed, true));
    if (out.stop) throw new Error(out.reason);
    expect(out.decoded.passed).toBe(false);
  });

  test("the screening API sees the opened input, nothing else", async () => {
    const { request, sealed } = fixture("Northwind Trading LLC");
    const seen: string[] = [];
    await runValidator(request, { ...deps(sealed), screen: async (s) => (seen.push(s), { hit: false }) });
    expect(seen).toEqual(["Northwind Trading LLC"]);
  });

  test("tampered input (sealed input differs from the committed one) -> stop, no report", async () => {
    const { request, salt } = fixture("Northwind Trading LLC");
    const tampered = sealFor(W1.publicKey, { input: "Kestrel Shipping Co", salt });
    let screened = false;
    const out = await runValidator(request, { ...deps(tampered), screen: async () => ((screened = true), { hit: false }) });
    expect(out).toEqual({ stop: true, reason: "commitment mismatch" });
    expect(screened).toBe(false); // never reaches the screening API
  });

  test("wrong salt -> stop", () => {
    const { request } = fixture();
    const out = prepareValidation(request, sealFor(W1.publicKey, { input: "Northwind Trading LLC", salt: randomSalt() }), W1.secretKey);
    expect(out).toEqual({ stop: true, reason: "commitment mismatch" });
  });

  test("commitment bound to agent: same opening for another agent -> stop", () => {
    const { request, sealed } = fixture();
    expect(prepareValidation({ ...request, agentId: 99n }, sealed, W1.secretKey)).toMatchObject({ stop: true });
  });

  test("missing payload -> stop", async () => {
    const { request } = fixture();
    expect(await runValidator(request, deps(null))).toEqual({ stop: true, reason: "no sealed payload" });
  });

  test("payload sealed to another key -> stop", () => {
    const { request, salt } = fixture();
    const other = sealFor(generateKeyPair().publicKey, { input: "Northwind Trading LLC", salt });
    expect(prepareValidation(request, other, W1.secretKey)).toMatchObject({ stop: true });
  });

  test("malformed opening -> stop", () => {
    const { request } = fixture();
    for (const bad of [{ input: 5, salt: randomSalt() }, { input: "x", salt: "0x1234" }, "just a string"]) {
      expect(prepareValidation(request, sealFor(W1.publicKey, bad), W1.secretKey)).toMatchObject({ stop: true });
    }
  });

  test("unsupported policy -> stop", () => {
    const { request, sealed } = fixture();
    expect(prepareValidation({ ...request, policyId: policyId("OTHER_POLICY_V1") }, sealed, W1.secretKey)).toEqual({
      stop: true,
      reason: "unsupported policy",
    });
  });

  test("expiry stays inside (now, now + window]", () => {
    for (const window of [1n, 5n, 30n, 600n, 3600n, 86400n]) {
      const e = expiryFor(1000n, window);
      expect(e > 1000n).toBe(true);
      expect(e <= 1000n + window).toBe(true);
    }
    expect(() => expiryFor(1000n, 0n)).toThrow();
  });

  test("rejects a malformed screening response", () => {
    const { request, sealed } = fixture();
    const prepared = prepareValidation(request, sealed, W1.secretKey);
    if (prepared.stop) throw new Error("unexpected stop");
    expect(() => finishValidation(prepared, { hit: "no" } as never, 1n, 10n, Tier.Don)).toThrow();
  });

  describe("QUALIFIED_SCREENER_V1 (Phase 3)", () => {
    const QUALIFIED = W1_POLICIES.QUALIFIED_SCREENER_V1;
    function qFixture(credential = "QS-2026-0417", agentId = 5n) {
      const salt = randomSalt();
      const request: ValidationRequest = {
        requestId: REQUEST_ID,
        agentId,
        policyId: QUALIFIED,
        commitment: inputCommitment({ agentId, policyId: QUALIFIED, input: credential, salt }),
      };
      return { request, salt, sealed: sealFor(W1.publicKey, { input: credential, salt }) };
    }

    test("listed credential -> pass; the provider sees only the credential, via /qualify", async () => {
      const { request, sealed } = qFixture();
      const asked: string[] = [];
      let screened = false;
      const out = await runValidator(request, {
        ...deps(sealed),
        screen: async () => ((screened = true), { hit: true }),
        qualify: async (c) => (asked.push(c), { qualified: true }),
      });
      if (out.stop) throw new Error(out.reason);
      expect(out.decoded).toMatchObject({ passed: true, policyId: QUALIFIED, commitment: request.commitment });
      expect(asked).toEqual(["QS-2026-0417"]);
      expect(screened).toBe(false);
    });

    test("unlisted credential -> fail report", async () => {
      const { request, sealed } = qFixture("QS-2025-0099");
      const out = await runValidator(request, { ...deps(sealed), qualify: async () => ({ qualified: false }) });
      if (out.stop) throw new Error(out.reason);
      expect(out.decoded.passed).toBe(false);
    });

    test("tampered credential -> stop before the provider is called", async () => {
      const { request, salt } = qFixture("QS-2025-0099");
      let asked = false;
      const out = await runValidator(request, {
        ...deps(sealFor(W1.publicKey, { input: "QS-2026-0417", salt })),
        qualify: async () => ((asked = true), { qualified: true }),
      });
      expect(out).toEqual({ stop: true, reason: "commitment mismatch" });
      expect(asked).toBe(false);
    });

    test("prepare marks the check; malformed answers are rejected", () => {
      const { request, sealed } = qFixture();
      const prepared = prepareValidation(request, sealed, W1.secretKey);
      if (prepared.stop) throw new Error(prepared.reason);
      expect(prepared.check).toBe("qualify");
      expect(() => finishValidation(prepared, { hit: false }, 1n, 10n, Tier.Don)).toThrow();
      expect(() => finishValidation(prepared, { qualified: "yes" } as never, 1n, 10n, Tier.Don)).toThrow();
    });

    test("missing qualify dependency -> error, not a silent pass", async () => {
      const { request, sealed } = qFixture();
      await expect(runValidator(request, deps(sealed))).rejects.toThrow();
    });
  });
});
