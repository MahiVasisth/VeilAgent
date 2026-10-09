// Commitment encodings shared with the contracts, byte for byte (cross-checked in commitments.test.ts and
// contracts/test/Commitments.t.sol against contracts/test/vectors/commitments.json).
import { encodeAbiParameters, keccak256, stringToBytes, toHex, type Hex } from "viem";

/** `keccak256` of the policy name, e.g. `policyId("SANCTIONS_SCREEN_V1")`. */
export function policyId(name: string): Hex {
  return keccak256(stringToBytes(name));
}

/** 32 random bytes from the platform CSPRNG. */
export function randomSalt(): Hex {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

/** `keccak256(bytes(input))`: the input is a UTF-8 string, hashed as its raw bytes. */
export function inputHash(input: string): Hex {
  return keccak256(stringToBytes(input));
}

/** `keccak256(abi.encode(uint256 agentId, bytes32 policyId, bytes32 keccak256(input), bytes32 salt))`. */
export function inputCommitment(p: { agentId: bigint; policyId: Hex; input: string; salt: Hex }): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
      [p.agentId, p.policyId, inputHash(p.input), p.salt],
    ),
  );
}
