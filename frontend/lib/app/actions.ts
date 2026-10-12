"use client";
// What a user can do in the app. Every secret (salt, bid price, Semaphore identity) is made here, in the browser,
// saved to the vault before any transaction, and only ever leaves as a commitment or as a box sealed to a workflow.
import { keccak256, parseEventLogs, stringToBytes, type Abi, type Address, type Hex, type PublicClient } from "viem";
import {
  anonymousFeedbackAbi,
  buildBid,
  exportBundle,
  bundleToJson,
  inputCommitment,
  policyId,
  privateValidationRegistryAbi,
  randomSalt,
  sealedBidHiringAbi,
  sealFor,
  treasuryActionAbi,
  type Deployment,
} from "@veil8004/sdk";
import { feedbackScope, fetchGroup, Identity, toSolidityProof } from "@veil8004/sdk/semaphore-core";
import { proveMembership } from "./prove";
import { nextBlockTime, sendTx, uploadSealed, type AppConfig, type Signer } from "./runtime";
import { download, readVault, updateVault } from "./vault";

type Ctx = { config: AppConfig; d: Deployment; client: PublicClient; signer: Signer; scope: string };

const veil = (d: Deployment) => {
  if (!d.veil) throw new Error("Veil8004 is not deployed on this chain");
  return d.veil;
};

/** Flow A: commit to the input on-chain, seal {input, salt} to W1, keep the opening here. */
export async function requestPrivateValidation(c: Ctx, p: { agentId: bigint; policy: string; input: string }) {
  if (!c.config.w1PublicKey) throw new Error("the server has no W1 public key (W1_PUBLIC_KEY), so nothing can be sealed to W1");
  const registry = veil(c.d).privateValidationRegistry;
  const salt = randomSalt();
  const commitment = inputCommitment({ agentId: p.agentId, policyId: policyId(p.policy), input: p.input, salt });
  const receipt = await sendTx(c.client, c.signer, {
    address: registry,
    abi: privateValidationRegistryAbi as Abi,
    functionName: "requestPrivate",
    args: [p.agentId, policyId(p.policy), commitment],
  });
  const requestId = parseEventLogs({ abi: privateValidationRegistryAbi, eventName: "PrivateValidationRequested", logs: receipt.logs })[0]!.args.requestId;
  updateVault(c.scope, (v) =>
    v.openings.push({ requestId, registry, agentId: p.agentId.toString(), policy: p.policy, input: p.input, salt, requester: c.signer.address, at: Date.now() }),
  );
  await uploadSealed(requestId, sealFor(c.config.w1PublicKey, { input: p.input, salt }));
  return requestId;
}

/** Flow C: the disclosure bundle for one of my requests, checked against the chain, downloaded as a file. */
export async function downloadBundle(c: Omit<Ctx, "signer">, requestId: Hex) {
  const o = readVault(c.scope).openings.find((x) => x.requestId === requestId);
  if (!o) throw new Error("this browser does not hold that request's opening");
  const bundle = await exportBundle(c.client, { registry: o.registry, requestId, input: o.input, salt: o.salt });
  download(`veil8004-bundle-${requestId.slice(0, 10)}.json`, bundleToJson(bundle));
}

export async function executeTreasury(c: Ctx, requestId: Hex) {
  return sendTx(c.client, c.signer, { address: veil(c.d).treasuryAction, abi: treasuryActionAbi as Abi, functionName: "execute", args: [requestId] });
}

/** Flow B, client side: a fresh Semaphore identity for this task (its commitment is public; the secret stays here). */
export async function postTask(c: Ctx, p: { category: string; minutes: number }) {
  const hiring = veil(c.d).sealedBidHiring;
  if (!hiring) throw new Error("SealedBidHiring is not deployed");
  const identity = new Identity();
  const commitment = identity.commitment.toString();
  updateVault(c.scope, (v) => v.identities.push({ taskId: null, commitment, privateKey: identity.export(), owner: c.signer.address, at: Date.now() }));
  const now = await nextBlockTime(c.client);
  const receipt = await sendTx(c.client, c.signer, {
    address: hiring,
    abi: sealedBidHiringAbi as Abi,
    functionName: "postTask",
    args: [policyId("QUALIFIED_SCREENER_V1"), keccak256(stringToBytes(p.category)), now + BigInt(Math.round(p.minutes * 60)), identity.commitment],
  });
  const taskId = parseEventLogs({ abi: sealedBidHiringAbi, eventName: "TaskPosted", logs: receipt.logs })[0]!.args.taskId;
  updateVault(c.scope, (v) => {
    const id = v.identities.find((x) => x.commitment === commitment);
    if (id) id.taskId = taskId.toString();
  });
  return taskId;
}

const hiringCall = (d: Deployment, functionName: string, args: readonly unknown[]) => ({
  address: veil(d).sealedBidHiring!,
  abi: sealedBidHiringAbi as Abi,
  functionName,
  args,
});

export const closeBidding = (c: Ctx, taskId: bigint) => sendTx(c.client, c.signer, hiringCall(c.d, "closeBidding", [taskId]));
export const markCompleted = (c: Ctx, taskId: bigint) => sendTx(c.client, c.signer, hiringCall(c.d, "markCompleted", [taskId]));

/** Flow B, agent side: seal {price, salt} to W3, upload it under bid:<commitment> first, then bid. */
export async function placeBid(c: Ctx, p: { taskId: bigint; agentId: bigint; price: bigint }) {
  if (!c.config.w3PublicKey) throw new Error("the server has no W3 public key (W3_PUBLIC_KEY), so a bid cannot be sealed");
  const bid = buildBid({ taskId: p.taskId, agentId: p.agentId, price: p.price, w3PublicKey: c.config.w3PublicKey });
  updateVault(c.scope, (v) =>
    v.bids.push({ taskId: p.taskId.toString(), agentId: p.agentId.toString(), price: p.price.toString(), salt: bid.salt, commitment: bid.commitment, at: Date.now() }),
  );
  await uploadSealed(bid.storeKey, bid.sealed);
  return sendTx(c.client, c.signer, hiringCall(c.d, "bid", [p.taskId, p.agentId, bid.commitment]));
}

export type RateResult = { hash: Hex; anonymitySet: number; via: "relayer" | "own wallet"; sender: Address };

/**
 * Flow D: prove "I hold a receipt in this group" for (agent, epoch) in this browser, then hand the proof to the
 * relayer (or, if there is none and the user agrees, send it from their own wallet, which links them).
 */
export async function rateAnonymously(
  c: Ctx & { receipt: { taskId: bigint; category: Hex; epoch: bigint; groupId: bigint; agentId: bigint } },
  score: number,
  allowOwnWallet: () => boolean,
): Promise<RateResult> {
  const v = veil(c.d);
  if (!v.semaphore || !v.anonymousFeedback) throw new Error("anonymous feedback is not deployed");
  const secret = readVault(c.scope).identities.find((x) => x.taskId === c.receipt.taskId.toString());
  if (!secret) throw new Error("this browser does not hold the identity for that task, so it cannot rate");
  const identity = Identity.import(secret.privateKey);
  const group = await fetchGroup(c.client, v.semaphore, c.receipt.groupId, BigInt(c.d.startBlock));
  const proof = toSolidityProof(await proveMembership(identity, group, BigInt(score), feedbackScope(c.receipt.agentId, c.receipt.epoch)));
  const args = [c.receipt.agentId, c.receipt.category, c.receipt.epoch, proof] as const;

  if (c.config.relayer) {
    const res = await fetch("/api/relay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        { agentId: c.receipt.agentId, category: c.receipt.category, epoch: c.receipt.epoch, proof },
        (_, x) => (typeof x === "bigint" ? x.toString() : x),
      ),
    });
    const body = (await res.json()) as { hash?: Hex; relayer?: Address; error?: string };
    if (!res.ok || !body.hash) throw new Error(body.error ?? `relayer: ${res.status}`);
    return { hash: body.hash, anonymitySet: group.size, via: "relayer", sender: body.relayer! };
  }
  if (!allowOwnWallet()) throw new Error("cancelled: no relayer, and sending from your own wallet would link the rating to you");
  const receipt = await sendTx(c.client, c.signer, { address: v.anonymousFeedback, abi: anonymousFeedbackAbi as Abi, functionName: "submit", args });
  return { hash: receipt.transactionHash, anonymitySet: group.size, via: "own wallet", sender: c.signer.address };
}

export async function anchor(c: Ctx, agentId: bigint, epoch: bigint) {
  const v = veil(c.d);
  return sendTx(c.client, c.signer, { address: v.anonymousFeedback!, abi: anonymousFeedbackAbi as Abi, functionName: "anchor", args: [agentId, epoch] });
}
