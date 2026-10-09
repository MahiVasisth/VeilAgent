// Semaphore tooling (Phase 5): scope encoding, the pinned artifacts, the canonical PoseidonT3 payload, and the SDK
// prover against the vectors in contracts/test/vectors/semaphore.json (whose proofs Semaphore.t.sol verifies on-chain).
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getContractAddress, type Hex } from "viem";
import { feedbackScope, Group, Identity, proveMembership, semaphoreHash, toSolidityProof, treeDepth } from "./semaphore";
import { artifactFileNames, artifactsDir, PINNED_SHA256, snarkArtifacts } from "./snarkArtifacts";

const vectors = JSON.parse(readFileSync(join(import.meta.dir, "../../contracts/test/vectors/semaphore.json"), "utf8"));
const poseidon = JSON.parse(readFileSync(join(import.meta.dir, "../../contracts/script/lib/PoseidonT3.create2.json"), "utf8"));
const haveArtifacts = existsSync(join(artifactsDir(), artifactFileNames(1).zkey));

describe("encodings", () => {
  test("feedbackScope matches the vector (and Semaphore.t.sol's abi.encode)", () => {
    expect(feedbackScope(BigInt(vectors.agentId), BigInt(vectors.epoch))).toBe(BigInt(vectors.scope));
  });
  test("semaphoreHash fits the BN254 field", () => {
    expect(semaphoreHash(2n ** 256n - 1n) < 2n ** 248n).toBe(true);
  });
  test("treeDepth", () => {
    expect([1, 2, 3, 4, 5, 8, 9, 16, 17].map(treeDepth)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5]);
  });
  test("vector identities are the fixed demo ones", () => {
    expect(new Identity("veil8004-test-vector-identity-0").commitment.toString()).toBe(vectors.identityCommitments[0]);
  });
});

describe("canonical PoseidonT3 payload (docs/phase0.md S-8)", () => {
  const pkg = createRequire(import.meta.url)("poseidon-solidity/deploy/PoseidonT3.js");
  test("matches the npm package", () => {
    expect(poseidon.data).toBe(pkg.data);
    expect(poseidon.salt).toBe(pkg.salt);
    expect(poseidon.address).toBe(pkg.address);
  });
  test("CREATE2 through the proxy lands on the canonical address", () => {
    const initCode = `0x${(poseidon.data as string).slice(66)}` as Hex;
    expect(getContractAddress({ opcode: "CREATE2", from: poseidon.proxy, salt: poseidon.salt, bytecode: initCode })).toBe(poseidon.address);
  });
});

describe("pinned artifacts", () => {
  test("every default depth has both files pinned", () => {
    for (const d of [1, 2, 3, 4]) for (const f of Object.values(artifactFileNames(d))) expect(PINNED_SHA256[f]).toMatch(/^[0-9a-f]{64}$/);
  });
  test("a missing or swapped file is refused", () => {
    const dir = mkdtempSync(join(tmpdir(), "veil-artifacts-"));
    expect(() => snarkArtifacts(1, dir)).toThrow("missing Semaphore artifact");
    writeFileSync(join(dir, "semaphore-1.wasm"), "not the circuit");
    writeFileSync(join(dir, "semaphore-1.zkey"), "not the key");
    expect(() => snarkArtifacts(1, dir)).toThrow("does not match its pinned SHA-256");
    expect(() => snarkArtifacts(5, dir)).toThrow("missing");
  });
});

describe.skipIf(!haveArtifacts)("prover (needs `make artifacts`)", () => {
  test("a fresh proof has the vector's root and nullifier, and changes only the randomised points", async () => {
    const c = vectors.cases[1]; // depth 2, prover is member 2
    const ids = c.members.map((i: number) => new Identity(`veil8004-test-vector-identity-${i}`));
    const group = new Group(ids.map((i: Identity) => i.commitment));
    const p = toSolidityProof(await proveMembership(ids[c.prover], group, BigInt(vectors.score), BigInt(vectors.scope)));
    expect(p.merkleTreeDepth).toBe(2n);
    expect(p.merkleTreeRoot.toString()).toBe(c.root);
    expect(p.nullifier.toString()).toBe(c.proof.nullifier); // nullifier = Poseidon(scope, secret): deterministic
    expect(p.points.map(String)).not.toEqual(c.proof.points);
  });
  test("a non-member cannot prove", async () => {
    const group = new Group([new Identity().commitment]);
    await expect(proveMembership(new Identity(), group, 1n, 1n)).rejects.toThrow("not a member");
  });
});
