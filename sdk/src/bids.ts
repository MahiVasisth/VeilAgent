// Sealed bids (Phase 3, Flow B). A bid is a commitment on-chain plus its opening {price, salt} sealed to W3's public
// key in the sealed store. The sealed bid is stored under `bid:<commitment>` and uploaded BEFORE the bid transaction:
// nobody else knows the commitment until it is on-chain, so nobody can claim the key first (docs/phase0.md P3-2).
import type { Account, Address, Chain, Hex, PublicClient, Transport, WalletClient } from "viem";
import { sealedBidHiringAbi } from "./abi/veil";
import { bidCommitment, randomSalt } from "./commitments";
import { sealFor } from "./seal";
import { putPayload } from "./sealedStore";

/** The plaintext W3 opens. `price` is a decimal string so uint256 values survive JSON. */
export type BidOpening = { price: string; salt: Hex };

export type SealedBid = {
  taskId: bigint;
  agentId: bigint;
  price: bigint;
  salt: Hex;
  commitment: Hex;
  /** base64 sealed box of the BidOpening, to W3's key. */
  sealed: string;
  /** Sealed-store key. */
  storeKey: string;
};

/** Sealed-store key of a bid: `bid:` + its commitment. */
export function bidStoreKey(commitment: Hex): string {
  return `bid:${commitment.toLowerCase()}`;
}

/** Builds a bid: a fresh salt, the commitment, and the opening sealed to `w3PublicKey`. Nothing is sent. */
export function buildBid(p: { taskId: bigint; agentId: bigint; price: bigint; w3PublicKey: string; salt?: Hex }): SealedBid {
  if (p.price < 0n) throw new Error("price must be non-negative");
  const salt = p.salt ?? randomSalt();
  const commitment = bidCommitment({ taskId: p.taskId, agentId: p.agentId, price: p.price, salt });
  const opening: BidOpening = { price: p.price.toString(), salt };
  return { ...p, salt, commitment, sealed: sealFor(p.w3PublicKey, opening), storeKey: bidStoreKey(commitment) };
}

/** Uploads the sealed bid. Do this before `submitBid`. */
export async function uploadBid(storeUrl: string, bid: SealedBid): Promise<void> {
  await putPayload(storeUrl, bid.storeKey, bid.sealed);
}

/** Sends `bid(taskId, agentId, commitment)` from the agent's owner or verified wallet and waits for the receipt. */
export async function submitBid(
  wallet: WalletClient<Transport, Chain, Account>,
  client: PublicClient,
  hiring: Address,
  bid: SealedBid,
) {
  const hash = await wallet.writeContract({
    address: hiring,
    abi: sealedBidHiringAbi,
    functionName: "bid",
    args: [bid.taskId, bid.agentId, bid.commitment],
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`bid reverted: ${hash}`);
  return receipt;
}

/** Upload, then submit. */
export async function placeBid(
  wallet: WalletClient<Transport, Chain, Account>,
  client: PublicClient,
  hiring: Address,
  storeUrl: string,
  bid: SealedBid,
) {
  await uploadBid(storeUrl, bid);
  return submitBid(wallet, client, hiring, bid);
}
