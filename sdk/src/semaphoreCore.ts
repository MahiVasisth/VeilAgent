// Semaphore V4 helpers with no Node imports, shared by the CLI prover (semaphore.ts) and the browser app's prover
// (a Web Worker running snarkjs's browser build). The circuit inputs and the proof packing match
// @semaphore-protocol/proof 4.14.3's generateProof; contracts/test/Semaphore.t.sol checks proofs built from them.
import { Group, Identity, type SemaphoreProof } from "@semaphore-protocol/core";
import { packGroth16Proof } from "@zk-kit/utils/proof-packing";
import { encodeAbiParameters, hexToBigInt, keccak256, parseEventLogs, toHex, type Address, type PublicClient } from "viem";
import { semaphoreAbi } from "./abi/semaphore";

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

/** The circuit's private and public inputs for a membership proof, the tree depth (which picks the artifacts) and the
 *  root the proof will be against. */
export function membershipCircuitInput(identity: Identity, group: Group, message: bigint, scope: bigint) {
  const index = group.indexOf(identity.commitment);
  if (index < 0) throw new Error("identity is not a member of the group");
  const merkleProof = group.generateMerkleProof(index);
  const depth = treeDepth(group.size);
  return {
    depth,
    root: merkleProof.root,
    input: {
      secret: identity.secretScalar,
      merkleProofLength: merkleProof.siblings.length,
      merkleProofIndex: merkleProof.index,
      merkleProofSiblings: Array.from({ length: depth }, (_, i) => merkleProof.siblings[i] ?? 0n),
      scope: semaphoreHash(scope),
      message: semaphoreHash(message),
    },
  };
}

/** Packs snarkjs's groth16 output into a Semaphore proof. */
export function toSemaphoreProof(
  p: { depth: number; root: bigint; message: bigint; scope: bigint },
  groth: { proof: Parameters<typeof packGroth16Proof>[0]; publicSignals: string[] },
): SemaphoreProof {
  return {
    merkleTreeDepth: p.depth,
    merkleTreeRoot: p.root.toString(),
    nullifier: groth.publicSignals[1]!,
    message: p.message.toString(),
    scope: p.scope.toString(),
    points: packGroth16Proof(groth.proof),
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

/** Rebuilds group `groupId` from the Semaphore contract's member events since `fromBlock`, in log order, and checks the
 *  result against the on-chain root. Removed members stay as zero leaves, as in Semaphore's LeanIMT. */
export async function fetchGroup(client: PublicClient, semaphore: Address, groupId: bigint, fromBlock = 0n): Promise<Group> {
  const logs = await client.getLogs({ address: semaphore, fromBlock, toBlock: "latest" });
  const group = new Group();
  for (const e of parseEventLogs({ abi: semaphoreAbi, logs })) {
    if (!("groupId" in e.args) || e.args.groupId !== groupId) continue;
    if (e.eventName === "MemberAdded") group.addMember(e.args.identityCommitment);
    else if (e.eventName === "MembersAdded") group.addMembers([...e.args.identityCommitments]);
    else if (e.eventName === "MemberUpdated") group.updateMember(Number(e.args.index), e.args.newIdentityCommitment);
    else if (e.eventName === "MemberRemoved") group.removeMember(Number(e.args.index));
  }
  const root = await client.readContract({ address: semaphore, abi: semaphoreAbi, functionName: "getMerkleTreeRoot", args: [groupId] });
  if (group.size > 0 && group.root !== root) throw new Error(`group ${groupId}: rebuilt root ${group.root} differs from on-chain ${root}`);
  return group;
}
