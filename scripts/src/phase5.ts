// Phase 5 exit criterion, against a live Anvil with the sealed store, the mock screening API and the local runner
// (a SIMULATION of the CRE DON, running W1, W3 and W2) up. Started by scripts/phase5.sh.
//   A rating is accepted, a second one in the same epoch is rejected, no receipt is issued without a completed awarded
//   job, and the aggregate is readable through the ERC-8004 Reputation Registry.
// On the way: three clients with Semaphore identities hire through sealed bids, W2 issues their receipts into one group,
// ratings go out from fresh wallets with no client address or identity secret on-chain, and out-of-group agents,
// out-of-range scores, wrong scopes, non-members, late ratings and early or repeated anchors are all rejected.
// Env: W1_PUBLIC_KEY, W3_PUBLIC_KEY, SEALED_STORE_URL. Names, credentials and prices are fictional demo data.
import { encodeAbiParameters, keccak256, parseEventLogs, stringToBytes, stringToHex, toHex, type Abi, type Account, type Address, type Hex } from "viem";
import {
  anonymousFeedbackAbi,
  inputCommitment,
  mockForwarderAbi,
  nullifierRegistryAbi,
  policyId,
  privateValidationRegistryAbi,
  putPayload,
  randomSalt,
  receiptGroupManagerAbi,
  reputationRegistryAbi,
  sealedBidHiringAbi,
  sealFor,
  semaphoreAbi,
} from "@veil8004/sdk";
import { feedbackScope, Group, Identity, proveMembership, toSolidityProof } from "@veil8004/sdk/semaphore";
import { placeSealedBid } from "./bidder";
import { chainNow, check, collectChainBytes, expectRevert, finish, send, warpTo, type Call } from "./checks";
import { local, publicClient, roles } from "./env";
import { buildRating, freshWallet, rate, receiptOf, submitCall, type Receipt } from "./rater";

const QUALIFIED = policyId("QUALIFIED_SCREENER_V1");
const CATEGORY = keccak256(stringToBytes("sanctions-screening"));
const STATUS = ["None", "Pending", "Passed", "Failed"] as const;
const TASK_STATUS = ["None", "Open", "Closed", "Awarded", "NoAward", "Completed"] as const;
const STORE = process.env.SEALED_STORE_URL ?? "http://127.0.0.1:8787";
const W1_PUBLIC_KEY = need("W1_PUBLIC_KEY");
const W3_PUBLIC_KEY = need("W3_PUBLIC_KEY");
const W2_WORKFLOW_NAME = "veil8004-w2-receipt-issuer";
const CREDENTIALS = { atlas: "QS-2026-0417", borealis: "QS-2026-0582", cirrus: "QS-2026-0733" };
const units = (n: number) => BigInt(Math.round(n * 100)) * 10n ** 16n; // 18-decimal demo token

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

const { deployment: d, agents } = local();
const veil = d.veil;
if (!veil?.sealedBidHiring || !veil.receiptGroupManager || !veil.anonymousFeedback || !veil.semaphore || !veil.nullifierRegistry || !veil.w2WorkflowId)
  throw new Error("no Phase 5 contracts in the deployment file; re-run Deploy.s.sol");
const hiring = veil.sealedBidHiring;
const receipts = veil.receiptGroupManager;
const feedback = veil.anonymousFeedback;
const registry = veil.privateValidationRegistry;
const [atlas, borealis, cirrus] = agents.agentIds.map(BigInt) as [bigint, bigint, bigint];
const [atlasOwner, borealisOwner, cirrusOwner] = roles.agentOwners as [Account, Account, Account];
const owners = new Map([[atlas, atlasOwner], [borealis, borealisOwner], [cirrus, cirrusOwner]]);
const hiringCall = (functionName: string, args: readonly unknown[]): Call => ({ address: hiring, abi: sealedBidHiringAbi as Abi, functionName, args });
const feedbackCall = (functionName: string, args: readonly unknown[]): Call => ({ address: feedback, abi: feedbackErrors, functionName, args });
// Decode errors bubbled up from Semaphore, the NullifierRegistry and ReceiptGroupManager.
const feedbackErrors = [...anonymousFeedbackAbi, ...semaphoreAbi, ...nullifierRegistryAbi, ...receiptGroupManagerAbi] as Abi;
const forwarderErrors = [...mockForwarderAbi, ...receiptGroupManagerAbi] as Abi;

const readReceipts = <T>(functionName: string, args: readonly unknown[]) =>
  publicClient.readContract({ address: receipts, abi: receiptGroupManagerAbi as Abi, functionName, args }) as Promise<T>;
const taskStatus = async (taskId: bigint) =>
  TASK_STATUS[(await publicClient.readContract({ address: hiring, abi: sealedBidHiringAbi, functionName: "getTask", args: [taskId] })).status]!;
async function waitUntil(cond: () => Promise<boolean>, ms = 30_000) {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) return false;
    await Bun.sleep(200);
  }
  return true;
}

/** Flow A, as in Phase 3: each agent gets QUALIFIED_SCREENER_V1 through W1 so it may bid. */
async function attest(owner: Account, agentId: bigint, credential: string) {
  const salt = randomSalt();
  const commitment = inputCommitment({ agentId, policyId: QUALIFIED, input: credential, salt });
  const receipt = await send(owner, { address: registry, abi: privateValidationRegistryAbi as Abi, functionName: "requestPrivate", args: [agentId, QUALIFIED, commitment] });
  const requestId = parseEventLogs({ abi: privateValidationRegistryAbi, eventName: "PrivateValidationRequested", logs: receipt.logs })[0]!.args.requestId;
  await putPayload(STORE, requestId, sealFor(W1_PUBLIC_KEY, { input: credential, salt }));
  await waitUntil(async () => {
    const { status } = await publicClient.readContract({ address: registry, abi: privateValidationRegistryAbi, functionName: "getRequest", args: [requestId] });
    return STATUS[status] !== "Pending";
  });
  return publicClient.readContract({ address: registry, abi: privateValidationRegistryAbi, functionName: "isAttested", args: [agentId, QUALIFIED] });
}

async function postTask(client: Account, deadline: bigint, identityCommitment: bigint) {
  const r = await send(client, hiringCall("postTask", [QUALIFIED, CATEGORY, deadline, identityCommitment]));
  return parseEventLogs({ abi: sealedBidHiringAbi, eventName: "TaskPosted", logs: r.logs })[0]!.args.taskId;
}

/** A W2 report delivered by hand through the MockForwarder, as a misbehaving or replaying DON would. */
async function forgedReceiptReport(taskId: bigint): Promise<Call> {
  const name = await publicClient.readContract({ address: veil!.forwarder, abi: mockForwarderAbi, functionName: "workflowNameOf", args: [W2_WORKFLOW_NAME] });
  const report = encodeAbiParameters([{ type: "uint256" }], [taskId]);
  return { address: veil!.forwarder, abi: forwarderErrors, functionName: "deliver", args: [receipts, veil!.w2WorkflowId, name, roles.localDon.address, "0x0002", report] };
}

// -----------------------------------------------------------------------------------------------------------------
const phase5Start = await publicClient.getBlockNumber();
console.log(`Phase 5 on Anvil. ReceiptGroupManager ${receipts}, AnonymousFeedback ${feedback}, Semaphore ${veil.semaphore};`);
console.log("W1, W3 and W2 reports via the MockForwarder (SIMULATED DON).");

const epochLength = await readReceipts<bigint>("epochLength", []);
console.log(`\n[1] move to the start of an epoch so every receipt below lands in the same one (epoch length ${epochLength}s)`);
await warpTo(((await chainNow()) / epochLength + 1n) * epochLength + 5n);
const epoch = await readReceipts<bigint>("currentEpoch", []);
check(true, `now in epoch ${epoch}`);

console.log("\n[2] three clients make Semaphore identities locally; only the commitments will go on-chain");
const clientC = await freshWallet();
const clients = [
  { name: "client A", account: roles.clients[0]!, identity: new Identity() },
  { name: "client B", account: roles.clients[1]!, identity: new Identity() },
  { name: "client C", account: clientC, identity: new Identity() },
] as const;
const [A, B, C] = clients;
for (const c of clients) check(c.identity.commitment > 0n, `${c.name} (${c.account.address.slice(0, 10)}…): commitment ${c.identity.commitment.toString().slice(0, 12)}…`);

console.log("\n[3] Atlas, Borealis and Cirrus get QUALIFIED_SCREENER_V1 through W1 so they can bid");
for (const [name, agentId, credential] of [["Atlas", atlas, CREDENTIALS.atlas], ["Borealis", borealis, CREDENTIALS.borealis], ["Cirrus", cirrus, CREDENTIALS.cirrus]] as const)
  check(await attest(owners.get(agentId)!, agentId, credential), `${name} attested`);

console.log("\n[4] five tasks, sealed bids, W3 awards");
const deadline = (await chainNow()) + 600n;
const tasks = {
  t1: { client: A.account, commitment: A.identity.commitment, bids: [[atlas, 4200.1], [borealis, 3100.2]], winner: borealis, label: "A, Borealis wins" },
  t2: { client: B.account, commitment: B.identity.commitment, bids: [[borealis, 2950.3], [cirrus, 3300.4]], winner: borealis, label: "B, Borealis wins" },
  t3: { client: C.account, commitment: C.identity.commitment, bids: [[atlas, 2800.5], [cirrus, 3050.6]], winner: atlas, label: "C, Atlas wins" },
  t4: { client: A.account, commitment: 0n, bids: [[cirrus, 2700.7]], winner: cirrus, label: "A, no identity commitment" },
  t5: { client: B.account, commitment: B.identity.commitment, bids: [[cirrus, 2600.8]], winner: cirrus, label: "B, never completed" },
} as const;
const ids = {} as Record<keyof typeof tasks, bigint>;
for (const [key, t] of Object.entries(tasks) as [keyof typeof tasks, (typeof tasks)[keyof typeof tasks]][]) {
  ids[key] = await postTask(t.client, deadline, t.commitment);
  for (const [agentId, price] of t.bids)
    await placeSealedBid({ owner: owners.get(agentId)!, taskId: ids[key], agentId, price: units(price), w3PublicKey: W3_PUBLIC_KEY, storeUrl: STORE });
}
await warpTo(deadline);
for (const key of Object.keys(tasks) as (keyof typeof tasks)[]) await send(roles.stranger, hiringCall("closeBidding", [ids[key]]));
for (const [key, t] of Object.entries(tasks) as [keyof typeof tasks, (typeof tasks)[keyof typeof tasks]][]) {
  await waitUntil(async () => (await taskStatus(ids[key])) === "Awarded");
  const award = await publicClient.readContract({ address: hiring, abi: sealedBidHiringAbi, functionName: "getAward", args: [ids[key]] });
  check(award.winnerAgentId === t.winner, `task ${ids[key]} (${t.label}): awarded to #${award.winnerAgentId}`);
}

console.log("\n[5] clients mark jobs completed; W2 (local runner) issues receipts");
// t4 first: the runner handles JobCompleted in order, so once t3's receipt lands t4 has been decided too.
for (const key of ["t4", "t1", "t2", "t3"] as const) await send(tasks[key].client, hiringCall("markCompleted", [ids[key]]));
check(await waitUntil(() => readReceipts<boolean>("receiptIssued", [ids.t3])), "W2 delivered the receipts");
const issued: Receipt[] = [];
for (const key of ["t1", "t2", "t3"] as const) {
  const r = await receiptOf(ids[key]);
  check(r !== null && r.epoch === epoch && r.agentId === tasks[key].winner, `task ${ids[key]}: receipt in epoch ${r?.epoch}, group ${r?.groupId}, agent #${r?.agentId}`);
  if (r) issued.push(r);
}
const receipt = issued[0]!;
check(issued.every((r) => r.groupId === receipt.groupId), "all three clients share one group (category, epoch)");

console.log("\n[6] no receipt without a completed, awarded job with an identity commitment");
check(!(await readReceipts<boolean>("receiptIssued", [ids.t4])), `task ${ids.t4} (completed, commitment 0): W2 sent no report, no receipt`);
check((await taskStatus(ids.t5)) === "Awarded" && !(await readReceipts<boolean>("receiptIssued", [ids.t5])), `task ${ids.t5} (awarded, not completed): no receipt`);
await expectRevert(`forged W2 report for task ${ids.t5} (not completed)`, roles.localDon.address, await forgedReceiptReport(ids.t5), "TaskNotCompleted");
await expectRevert(`forged W2 report for task ${ids.t4} (no commitment)`, roles.localDon.address, await forgedReceiptReport(ids.t4), "NoIdentityCommitment");
await expectRevert(`replayed W2 report for task ${ids.t1}`, roles.localDon.address, await forgedReceiptReport(ids.t1), "ReceiptAlreadyIssued");
check(!(await readReceipts<boolean>("agentInGroup", [CATEGORY, epoch, cirrus])), "Cirrus (no receipt-bearing job) is not rateable this epoch");

console.log("\n[7] anonymous ratings: proved offline, sent from fresh wallets");
const senders: Address[] = [];
const ratings: { who: (typeof clients)[number]; agentId: bigint; score: bigint }[] = [
  { who: A, agentId: borealis, score: 5n },
  { who: B, agentId: borealis, score: 5n },
  { who: C, agentId: borealis, score: 4n },
  { who: C, agentId: atlas, score: 4n },
];
const ratingTxs: Hex[] = [];
const nullifiers: bigint[] = [];
for (const { who, agentId, score } of ratings) {
  const sender = await freshWallet();
  senders.push(sender.address);
  const started = Date.now();
  const own = issued[clients.indexOf(who)]!; // t1, t2, t3 are A's, B's and C's jobs
  const r = await rate({ identity: who.identity, receipt: own, agentId, score, sender });
  ratingTxs.push(r.tx.transactionHash);
  nullifiers.push(r.proof.nullifier);
  const ev = parseEventLogs({ abi: anonymousFeedbackAbi, eventName: "FeedbackSubmitted", logs: r.tx.logs })[0];
  check(ev?.args.score === Number(score), `${who.name} rated #${agentId} ${score}/5 (one of ${r.anonymitySet} receipt holders, proof ${Date.now() - started} ms)`);
}
const borealisCtx = await publicClient.readContract({ address: feedback, abi: anonymousFeedbackAbi, functionName: "nullifierContext", args: [borealis, epoch] });
check(
  await publicClient.readContract({ address: veil.nullifierRegistry, abi: nullifierRegistryAbi, functionName: "isUsed", args: [borealisCtx, nullifiers[0]!] }),
  "client A's nullifier for (Borealis, epoch) is recorded in the NullifierRegistry",
);

console.log("\n[8] rejected ratings");
const tryRating = async (label: string, identity: Identity, agentId: bigint, score: bigint, errorName: string, group?: Group) => {
  const proof = group
    ? toSolidityProof(await proveMembership(identity, group, score, feedbackScope(agentId, epoch)))
    : (await buildRating(identity, receipt, agentId, score)).proof;
  await expectRevert(label, roles.stranger.address, { ...submitCall(agentId, receipt, proof), abi: feedbackErrors } as Call, errorName);
};
await tryRating("client A rates Borealis again this epoch (score 1)", A.identity, borealis, 1n, "Semaphore__YouAreUsingTheSameNullifierTwice");
const outsider = new Identity();
await tryRating(
  "an outsider proves against a group it made up",
  outsider,
  borealis,
  5n,
  "Semaphore__MerkleTreeRootIsNotPartOfTheGroup",
  new Group([...clients.map((c) => c.identity.commitment), outsider.commitment]),
);
await tryRating("client B rates Cirrus (no receipt this epoch)", B.identity, cirrus, 5n, "AgentNotInGroup");
await tryRating("client B gives Atlas a 6", B.identity, atlas, 6n, "ScoreOutOfRange");
await tryRating("client B gives Atlas a 0", B.identity, atlas, 0n, "ScoreOutOfRange");
{
  const { proof } = await buildRating(B.identity, receipt, borealis, 3n); // scoped to Borealis
  await expectRevert("client B's Borealis proof submitted for Atlas", roles.stranger.address, { ...submitCall(atlas, receipt, proof), abi: feedbackErrors } as Call, "ScopeMismatch");
}
await expectRevert("anchor Borealis while ratings are open", roles.stranger.address, feedbackCall("anchor", [borealis, epoch]), "RatingStillOpen");

console.log("\n[9] what the rating transactions reveal");
const clientAddrs = clients.map((c) => c.account.address.toLowerCase());
const agentOwnerAddrs = [...owners.values()].map((o) => o.address.toLowerCase());
check(senders.every((s) => !clientAddrs.includes(s.toLowerCase()) && !agentOwnerAddrs.includes(s.toLowerCase())), "no rating was sent from a client's or agent owner's address");
const ratingBytes: string[] = [];
for (const hash of ratingTxs) {
  const [tx, rc] = await Promise.all([publicClient.getTransaction({ hash }), publicClient.getTransactionReceipt({ hash })]);
  ratingBytes.push(tx.input.slice(2), ...rc.logs.flatMap((l) => [...l.topics.map((t) => t!.slice(2)), l.data.slice(2)]));
}
const ratingDump = ratingBytes.join("|").toLowerCase();
check(clientAddrs.every((a) => !ratingDump.includes(a.slice(2))), "no client address in any rating's calldata or logs");
check(
  clients.every((c) => !ratingDump.includes(toHex(c.identity.commitment, { size: 32 }).slice(2))),
  "no member's identity commitment in any rating's calldata or logs (the rater is one of the group)",
);
const chain = await collectChainBytes(phase5Start);
const secrets = clients.flatMap((c) => [
  { label: `${c.name} secret scalar`, hex: toHex(c.identity.secretScalar, { size: 32 }).slice(2) },
  { label: `${c.name} private key`, hex: stringToHex(c.identity.export()).slice(2) },
]);
const leaked = secrets.filter((s) => chain.includes(s.hex.toLowerCase()));
check(leaked.length === 0, `no identity secret anywhere on-chain (calldata, logs, storage)${leaked.length ? `: ${leaked.map((l) => l.label).join(", ")}` : ""}`);

console.log("\n[10] ratings close; the average is anchored into the ERC-8004 Reputation Registry");
const closesAt = await readReceipts<bigint>("ratingClosesAt", [epoch]);
await warpTo(closesAt);
await tryRating("client B rates Atlas after the window", B.identity, atlas, 5n, "RatingClosed");
const anchored = await send(roles.stranger, feedbackCall("anchor", [borealis, epoch]));
const ev = parseEventLogs({ abi: anonymousFeedbackAbi, eventName: "FeedbackAnchored", logs: anchored.logs })[0];
check(ev?.args.value === 466n && ev.args.count === 3n, `Borealis anchored by a stranger: value ${ev?.args.value} (4.66 from 5, 5, 4; rounds down), count ${ev?.args.count}`);
await send(roles.stranger, feedbackCall("anchor", [atlas, epoch]));
await expectRevert("anchor Borealis again", roles.stranger.address, feedbackCall("anchor", [borealis, epoch]), "AlreadyAnchored");
await expectRevert("anchor Cirrus (no ratings)", roles.stranger.address, feedbackCall("anchor", [cirrus, epoch]), "NoRatings");

const rep = { address: d.reputationRegistry, abi: reputationRegistryAbi } as const;
for (const [name, agentId, want] of [["Borealis", borealis, 466n], ["Atlas", atlas, 400n]] as const) {
  const [count, value, decimals] = await publicClient.readContract({ ...rep, functionName: "getSummary", args: [agentId, [feedback], "veil8004", "anon-aggregate"] });
  check(count === 1n && value === want && decimals === 2, `Reputation Registry getSummary(${name}, [AnonymousFeedback], veil8004, anon-aggregate) = ${value} / 10^${decimals}, count ${count}`);
  const last = await publicClient.readContract({ ...rep, functionName: "getLastIndex", args: [agentId, feedback] });
  const [v, , tag1, tag2, revoked] = await publicClient.readContract({ ...rep, functionName: "readFeedback", args: [agentId, feedback, last] });
  check(v === want && tag1 === "veil8004" && tag2 === "anon-aggregate" && !revoked, `readFeedback(${name}, AnonymousFeedback, ${last}): one entry from the contract, no rater named`);
}
const repClients = await publicClient.readContract({ ...rep, functionName: "getClients", args: [borealis] });
check(!repClients.some((a) => clientAddrs.includes(a.toLowerCase())), "the registry lists AnonymousFeedback as Borealis's client, never a rater's address");

console.log(`\nAnonymity set this epoch: ${issued.length} receipt holders. That is small; the claims table says so.`);
finish("PHASE 5", "a rating is accepted, a second in the same epoch is rejected, no receipt without a completed awarded job, and the aggregate is readable through the Reputation Registry.");
process.exit(0); // snarkjs may leave handles open
