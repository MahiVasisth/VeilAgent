// Semaphore V4 for anonymous feedback (Phase 5, Flow D). The client keeps a Semaphore identity locally and passes only
// its commitment to postTask; after a completed job it proves membership of the receipt group with
// message = score and scope = keccak256(abi.encode(uint256 agentId, uint64 epoch)).
// Proofs use the locally cached, hash-pinned artifacts (snarkArtifacts.ts), so proving works offline.
//
// proveMembership reproduces @semaphore-protocol/proof's generateProof (4.14.3) instead of calling it, because that
// function cannot pass snarkjs's `singleThread` option, and under Bun ffjavascript's worker-thread curve setup never
// finishes (docs/phase0.md S-7). The circuit inputs and the packing (semaphoreCore.ts) are the same;
// contracts/test/Semaphore.t.sol checks proofs made here against the real SemaphoreVerifier.
import { readFileSync } from "node:fs";
import { groth16 } from "snarkjs";
import { membershipCircuitInput, toSemaphoreProof, type Group, type Identity, type SemaphoreProof } from "./semaphoreCore";
import { snarkArtifacts } from "./snarkArtifacts";

export * from "./semaphoreCore";

/** A membership proof for `group` with the given message and scope, using the pinned local artifacts. */
export async function proveMembership(identity: Identity, group: Group, message: bigint, scope: bigint): Promise<SemaphoreProof> {
  const { depth, root, input } = membershipCircuitInput(identity, group, message, scope);
  const { wasm, zkey } = snarkArtifacts(depth);
  const groth = await groth16.fullProve(input, readFileSync(wasm), readFileSync(zkey), undefined, undefined, { singleThread: true });
  return toSemaphoreProof({ depth, root, message, scope }, groth);
}
