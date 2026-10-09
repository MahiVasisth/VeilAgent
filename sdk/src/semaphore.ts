// Semaphore V4 for anonymous feedback (Phase 5, Flow D). The client keeps a Semaphore identity locally and passes only
// its commitment to postTask; after a completed job it proves membership of the receipt group with
// message = score and scope = keccak256(abi.encode(uint256 agentId, uint64 epoch)).
// Proofs use the locally cached, hash-pinned artifacts (snarkArtifacts.ts), so proving works offline.
//
// proveMembership reproduces @semaphore-protocol/proof's generateProof (4.14.3) instead of calling it, because that
// function cannot pass snarkjs's `singleThread` option, and under Bun ffjavascript's worker-thread curve setup never
// finishes (docs/phase0.md S-7). The circuit inputs and the packing are the same; contracts/test/Semaphore.t.sol checks
// proofs made here against the real SemaphoreVerifier.
import { readFileSync } from "node:fs";
import { Group, Identity, type SemaphoreProof } from "@semaphore-protocol/core";
import { packGroth16Proof } from "@zk-kit/utils/proof-packing";
import { groth16 } from "snarkjs";
import { encodeAbiParameters, hexToBigInt, keccak256, toHex } from "viem";
import { snarkArtifacts } from "./snarkArtifacts";

export { Group, Identity, type SemaphoreProof };

/** `uint256(keccak256(abi.encode(uint256 agentId, uint64 epoch)))`: one rating per identity, agent and epoch. */
export function feedbackScope(agentId: bigint, epoch: bigint): bigint {
  return hexToBigInt(keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint64" }], [agentId, epoch])));
}

/** LeanIMT depth for a group of `size` members, as Semaphore uses it (minimum 1). */
export function treeDepth(size: number): number {
  return Math.max(1, Math.ceil(Math.log2(Math.max(size, 1))));
}

/** Semaphore's field hash for message and scope: `keccak256(bytes32(x)) >> 8`, as the circuit and contract use it. */
export function semaphoreHash(x: bigint): bigint {
  return hexToBigInt(keccak256(toHex(x, { size: 32 }))) >> 8n;
}

/** A membership proof for `group` with the given message and scope, using the pinned local artifacts. */
export async function proveMembership(identity: Identity, group: Group, message: bigint, scope: bigint): Promise<SemaphoreProof> {
  const index = group.indexOf(identity.commitment);
  if (index < 0) throw new Error("identity is not a member of the group");
  const merkleProof = group.generateMerkleProof(index);
  const depth = treeDepth(group.size);
  const siblings = Array.from({ length: depth }, (_, i) => merkleProof.siblings[i] ?? 0n);
  const { wasm, zkey } = snarkArtifacts(depth);
  const { proof, publicSignals } = await groth16.fullProve(
    {
      secret: identity.secretScalar,
      merkleProofLength: merkleProof.siblings.length,
      merkleProofIndex: merkleProof.index,
      merkleProofSiblings: siblings,
      scope: semaphoreHash(scope),
      message: semaphoreHash(message),
    },
    readFileSync(wasm),
    readFileSync(zkey),
    undefined,
    undefined,
    { singleThread: true },
  );
  return {
    merkleTreeDepth: depth,
    merkleTreeRoot: merkleProof.root.toString(),
    nullifier: publicSignals[1]!,
    message: message.toString(),
    scope: scope.toString(),
    points: packGroth16Proof(proof),
  };
}

/** The proof as the Solidity `ISemaphore.SemaphoreProof` tuple expects it. */
export function toSolidityProof(p: SemaphoreProof) {
  return {
    merkleTreeDepth: BigInt(p.merkleTreeDepth),
    merkleTreeRoot: BigInt(p.merkleTreeRoot),
    nullifier: BigInt(p.nullifier),
    message: BigInt(p.message),
    scope: BigInt(p.scope),
    points: p.points.map(BigInt) as unknown as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint],
  };
}
