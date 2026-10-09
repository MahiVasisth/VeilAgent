// Cross-language check: these TypeScript encodings must reproduce contracts/test/vectors/commitments.json, which was
// generated with `cast` and is also checked by contracts/test/Commitments.t.sol. Matching the same file on both
// sides means TypeScript and Solidity agree byte for byte.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Hex } from "viem";
import { inputCommitment, inputHash, policyId, randomSalt } from "./commitments";

type Vector = { agentId: string; policyName: string; policyId: Hex; input: string; salt: Hex; inputHash: Hex; commitment: Hex };
const { vectors } = JSON.parse(
  readFileSync(join(import.meta.dir, "../../contracts/test/vectors/commitments.json"), "utf8"),
) as { vectors: Vector[] };

describe("commitments", () => {
  test("vector file is present", () => expect(vectors.length).toBe(4));

  for (const v of vectors) {
    test(`matches Solidity encoding: agent ${v.agentId}, ${v.policyName}, ${JSON.stringify(v.input)}`, () => {
      expect(policyId(v.policyName)).toBe(v.policyId);
      expect(inputHash(v.input)).toBe(v.inputHash);
      expect(inputCommitment({ agentId: BigInt(v.agentId), policyId: v.policyId, input: v.input, salt: v.salt })).toBe(
        v.commitment,
      );
    });
  }

  test("any change to agent, policy, input or salt changes the commitment", () => {
    const base = { agentId: 1n, policyId: policyId("SANCTIONS_SCREEN_V1"), input: "a", salt: randomSalt() };
    const c = inputCommitment(base);
    expect(inputCommitment({ ...base, agentId: 2n })).not.toBe(c);
    expect(inputCommitment({ ...base, policyId: policyId("OTHER_POLICY_V1") })).not.toBe(c);
    expect(inputCommitment({ ...base, input: "b" })).not.toBe(c);
    expect(inputCommitment({ ...base, salt: randomSalt() })).not.toBe(c);
  });

  test("randomSalt is 32 fresh bytes", () => {
    const a = randomSalt();
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(randomSalt()).not.toBe(a);
  });
});
