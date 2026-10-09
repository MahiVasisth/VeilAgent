// Bidder (Phase 3, Flow B): place a sealed bid, and after the award check Merkle inclusion from public data.
//
//   bun scripts/src/bidder.ts bid --task <id> --agent <id> --price <uint> [--owner <anvil index>]
//   bun scripts/src/bidder.ts inclusion --task <id> --agent <id>
//
// `bid` seals {price, salt} to W3_PUBLIC_KEY, uploads it to the sealed store under bid:<commitment> FIRST, then sends
// bid(taskId, agentId, commitment) from the agent owner's key (Anvil demo accounts; default: the agent's registered
// owner). The salt is printed once and never written to disk. `inclusion` needs no secret: it rebuilds W3's tree from
// the on-chain bids and the award, then asks SealedBidHiring.verifyInclusion.
import { parseArgs } from "node:util";
import type { Account, Address, Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { bidInclusionProof, buildBid, placeBid, reconstructBidTree, sealedBidHiringAbi, verifyBidInclusion, type SealedBid } from "@veil8004/sdk";
import { local, publicClient, walletFor } from "./env";

// SealedBidHiring.TaskStatus
const TASK_AWARDED = 3;
const TASK_COMPLETED = 5;

export function hiringAddress(): Address {
  const hiring = local().deployment.veil?.sealedBidHiring;
  if (!hiring) throw new Error("no SealedBidHiring in the deployment file; re-run Deploy.s.sol");
  return hiring;
}

/** Builds, uploads and submits a sealed bid. Returns the bid, including its secret salt: keep it to yourself. */
export async function placeSealedBid(p: { owner: Account; taskId: bigint; agentId: bigint; price: bigint; w3PublicKey: string; storeUrl: string }) {
  const bid = buildBid({ taskId: p.taskId, agentId: p.agentId, price: p.price, w3PublicKey: p.w3PublicKey });
  const receipt = await placeBid(walletFor(p.owner), publicClient, hiringAddress(), p.storeUrl, bid);
  return { bid, receipt };
}

export type InclusionResult =
  | { status: "no award"; taskStatus: number }
  | { status: "not rebuilt"; validBidCount: number; bids: number }
  | { status: "not counted"; onChain: boolean }
  | { status: "counted"; proof: Hex[]; offChain: boolean; onChain: boolean; root: Hex };

/** What a losing (or winning) bidder can check after the award, from public data only. */
export async function checkInclusion(taskId: bigint, agentId: bigint): Promise<InclusionResult> {
  const hiring = hiringAddress();
  const contract = { address: hiring, abi: sealedBidHiringAbi } as const;
  const task = await publicClient.readContract({ ...contract, functionName: "getTask", args: [taskId] });
  if (task.status !== TASK_AWARDED && task.status !== TASK_COMPLETED) return { status: "no award", taskStatus: task.status };
  const bids = await publicClient.readContract({ ...contract, functionName: "getBids", args: [taskId] });
  const award = await publicClient.readContract({ ...contract, functionName: "getAward", args: [taskId] });
  const tree = reconstructBidTree(taskId, bids, award.validBidCount, award.merkleRoot);
  if (!tree) return { status: "not rebuilt", validBidCount: award.validBidCount, bids: bids.length };
  const mine = bids.find((b) => b.agentId === agentId);
  const verify = (proof: Hex[]) =>
    publicClient.readContract({ address: hiring, abi: sealedBidHiringAbi, functionName: "verifyInclusion", args: [taskId, agentId, proof] });
  let proof: Hex[];
  try {
    if (!mine) throw new Error("no bid");
    proof = bidInclusionProof(tree, taskId, mine);
  } catch {
    return { status: "not counted", onChain: await verify([]) };
  }
  return { status: "counted", proof, offChain: verifyBidInclusion(award.merkleRoot, taskId, mine!, proof), onChain: await verify(proof), root: award.merkleRoot };
}

// ---- CLI ----------------------------------------------------------------------------------------
if (import.meta.main) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { task: { type: "string" }, agent: { type: "string" }, price: { type: "string" }, owner: { type: "string" } },
  });
  const [cmd] = positionals;
  const need = (v: string | undefined, name: string) => {
    if (v === undefined) throw new Error(`--${name} is required`);
    return BigInt(v);
  };
  const taskId = need(values.task, "task");
  const agentId = need(values.agent, "agent");

  if (cmd === "bid") {
    const w3PublicKey = process.env.W3_PUBLIC_KEY;
    if (!w3PublicKey) throw new Error("W3_PUBLIC_KEY is required");
    const { agents } = local();
    const index = values.owner ?? String(agents.agentIds.indexOf(Number(agentId)) + 1);
    if (index === "0") throw new Error("agent not in the demo agents file; pass --owner <anvil index>");
    const owner = mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: Number(index) });
    const { bid, receipt } = await placeSealedBid({
      owner,
      taskId,
      agentId,
      price: need(values.price, "price"),
      w3PublicKey,
      storeUrl: process.env.SEALED_STORE_URL ?? "http://127.0.0.1:8787",
    });
    print(bid, receipt.transactionHash);
  } else if (cmd === "inclusion") {
    console.log(JSON.stringify(await checkInclusion(taskId, agentId), null, 2));
  } else {
    console.error("usage: bidder.ts bid --task <id> --agent <id> --price <uint> [--owner <i>] | inclusion --task <id> --agent <id>");
    process.exit(2);
  }
}

function print(bid: SealedBid, tx: Hex) {
  console.log(`bid placed on task ${bid.taskId} for agent ${bid.agentId}: commitment ${bid.commitment} (tx ${tx})`);
  console.log(`sealed opening uploaded under ${bid.storeKey}`);
  console.log(`your salt (not stored anywhere; only you and W3 can open this bid): ${bid.salt}`);
}
