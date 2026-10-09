// Phase 3 exit criterion, against a live Anvil with the sealed store, the mock screening API and the local runner
// (a SIMULATION of the CRE DON, running W1 and W3) up. Started by scripts/phase3.sh.
//   Three attested agents bid, W3 awards the lowest, a loser verifies Merkle inclusion, and no losing price appears
//   on-chain. On the way: an unattested agent and a non-controller are rejected, the deadline is enforced, a duplicate
//   bid is rejected, and the award is final.
// Env: W1_PUBLIC_KEY, W3_PUBLIC_KEY, SEALED_STORE_URL. Entity names, credentials and prices are fictional demo data.
import { decodeFunctionData, keccak256, parseEventLogs, stringToBytes, stringToHex, toHex, type Abi, type Account, type Hex } from "viem";
import {
  buildAuctionView,
  buildPublicGraph,
  fetchAuctionData,
  fetchPublicData,
  identityRegistryAbi,
  inputCommitment,
  jsonDataUri,
  mockForwarderAbi,
  policyId,
  privateValidationRegistryAbi,
  putPayload,
  randomSalt,
  sealedBidHiringAbi,
  sealFor,
} from "@veil8004/sdk";
import { checkInclusion, placeSealedBid } from "./bidder";
import { chainNow, check, collectChainBytes, expectRevert, finish, send, warpTo, type Call } from "./checks";
import { local, publicClient, roles } from "./env";

const QUALIFIED = policyId("QUALIFIED_SCREENER_V1");
const CATEGORY = keccak256(stringToBytes("sanctions-screening"));
const STATUS = ["None", "Pending", "Passed", "Failed"] as const;
const TASK_STATUS = ["None", "Open", "Closed", "Awarded", "NoAward", "Completed"] as const;
const STORE = process.env.SEALED_STORE_URL ?? "http://127.0.0.1:8787";
const W1_PUBLIC_KEY = need("W1_PUBLIC_KEY");
const W3_PUBLIC_KEY = need("W3_PUBLIC_KEY");

// Prices in base units of a fictional 18-decimal demo token. Distinctive, so a leak scan cannot match by coincidence.
// scripts/phase3.sh greps the page and the runner log for the two losing prices; keep them in sync.
const PRICES = {
  atlas: 4_217_350_000_000_000_000_000n, // loses
  borealis: 3_100_000_000_000_000_000_000n, // wins (lowest)
  cirrus: 3_904_120_000_000_000_000_000n, // loses
};
// Fictional screener credentials (services/mock-screening lists the QS-2026-* ones as qualified).
const CREDENTIALS = { atlas: "QS-2026-0417", borealis: "QS-2026-0582", cirrus: "QS-2026-0733", drift: "QS-2025-0099" };

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

const { deployment: d, agents } = local();
const veil = d.veil;
if (!veil?.sealedBidHiring) throw new Error("no SealedBidHiring in the deployment file; re-run Deploy.s.sol");
const hiring = veil.sealedBidHiring;
const registry = veil.privateValidationRegistry;
const [atlas, borealis, cirrus] = agents.agentIds.map(BigInt) as [bigint, bigint, bigint];
const [atlasOwner, borealisOwner, cirrusOwner] = roles.agentOwners as [Account, Account, Account];
const client = roles.clients[0]!;
const hiringCall = (functionName: string, args: readonly unknown[]): Call => ({ address: hiring, abi: sealedBidHiringAbi as Abi, functionName, args });
const forwarderAbi = [...mockForwarderAbi, ...sealedBidHiringAbi] as Abi; // decode bubbled SealedBidHiring errors

// Every secret this run creates; the leak scan looks for each of them.
const secrets: { label: string; hex: string }[] = [];

/** Flow A for an agent-level policy: the agent's owner commits to its credential, uploads the sealed opening to W1,
 *  and waits for the local runner's result. */
async function attest(owner: Account, agentId: bigint, credential: string) {
  const salt = randomSalt();
  secrets.push({ label: `credential ${credential}`, hex: stringToHex(credential) }, { label: "attestation salt", hex: salt });
  const commitment = inputCommitment({ agentId, policyId: QUALIFIED, input: credential, salt });
  const receipt = await send(owner, { address: registry, abi: privateValidationRegistryAbi as Abi, functionName: "requestPrivate", args: [agentId, QUALIFIED, commitment] });
  const [event] = parseEventLogs({ abi: privateValidationRegistryAbi, eventName: "PrivateValidationRequested", logs: receipt.logs });
  const requestId = event!.args.requestId;
  await putPayload(STORE, requestId, sealFor(W1_PUBLIC_KEY, { input: credential, salt }));
  const end = Date.now() + 30_000;
  for (;;) {
    const { status } = await publicClient.readContract({ address: registry, abi: privateValidationRegistryAbi, functionName: "getRequest", args: [requestId] });
    if (STATUS[status] !== "Pending" || Date.now() > end) return STATUS[status]!;
    await Bun.sleep(200);
  }
}

const isAttested = (agentId: bigint) =>
  publicClient.readContract({ address: registry, abi: privateValidationRegistryAbi, functionName: "isAttested", args: [agentId, QUALIFIED] });
const taskStatus = async (taskId: bigint) =>
  TASK_STATUS[(await publicClient.readContract({ address: hiring, abi: sealedBidHiringAbi, functionName: "getTask", args: [taskId] })).status]!;

// -----------------------------------------------------------------------------------------------------------------
const phase3Start = await publicClient.getBlockNumber();
console.log(`Phase 3 on Anvil. SealedBidHiring ${hiring}; W1 and W3 reports via MockForwarder ${veil.forwarder} (SIMULATED DON).`);

console.log("\n[1] a fourth agent, Drift, registers (it will not hold QUALIFIED_SCREENER_V1)");
const driftOwner = roles.stranger;
const reg = await send(driftOwner, {
  address: d.identityRegistry,
  abi: identityRegistryAbi as Abi,
  functionName: "register",
  args: [jsonDataUri({ type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1", name: "Drift", description: "Fictional demo agent." }).uri],
});
const [registered] = parseEventLogs({ abi: identityRegistryAbi, eventName: "Registered", logs: reg.logs });
const drift = registered!.args.agentId;
check(true, `Drift registered as agent #${drift}`);

console.log("\n[2] a client posts a task: bidders must hold QUALIFIED_SCREENER_V1");
const deadline = (await chainNow()) + 600n;
// The Semaphore identity commitment arrives with Phase 5 (receipts); 0 until then.
const posted = await send(client, hiringCall("postTask", [QUALIFIED, CATEGORY, deadline, 0n]));
const taskId = parseEventLogs({ abi: sealedBidHiringAbi, eventName: "TaskPosted", logs: posted.logs })[0]!.args.taskId;
check((await taskStatus(taskId)) === "Open", `task ${taskId} is Open until ${deadline}`);

console.log("\n[3] agents get their qualification screened privately (Flow A through W1, /qualify on the MOCK provider)");
check((await attest(driftOwner, drift, CREDENTIALS.drift)) === "Failed", "Drift's credential is not on the qualified list: W1 recorded a fail");
for (const [name, owner, agentId, credential] of [
  ["Atlas", atlasOwner, atlas, CREDENTIALS.atlas],
  ["Borealis", borealisOwner, borealis, CREDENTIALS.borealis],
  ["Cirrus", cirrusOwner, cirrus, CREDENTIALS.cirrus],
] as const) {
  check((await attest(owner, agentId, credential)) === "Passed", `${name}: W1 recorded a pass`);
  check(await isAttested(agentId), `${name} holds QUALIFIED_SCREENER_V1 (isAttested)`);
}

console.log("\n[4] the gate on bid()");
const someCommitment = keccak256(toHex("any commitment"));
await expectRevert("unattested agent (Drift) bids", driftOwner.address, hiringCall("bid", [taskId, drift, someCommitment]), "NotAttested");
await expectRevert("a stranger bids for Atlas", roles.clients[1]!.address, hiringCall("bid", [taskId, atlas, someCommitment]), "NotAgentController");

console.log("\n[5] three attested agents place sealed bids (opening uploaded to the sealed store first, then bid())");
const placed = {
  atlas: await placeSealedBid({ owner: atlasOwner, taskId, agentId: atlas, price: PRICES.atlas, w3PublicKey: W3_PUBLIC_KEY, storeUrl: STORE }),
  borealis: await placeSealedBid({ owner: borealisOwner, taskId, agentId: borealis, price: PRICES.borealis, w3PublicKey: W3_PUBLIC_KEY, storeUrl: STORE }),
  cirrus: await placeSealedBid({ owner: cirrusOwner, taskId, agentId: cirrus, price: PRICES.cirrus, w3PublicKey: W3_PUBLIC_KEY, storeUrl: STORE }),
};
for (const [name, p] of Object.entries(placed)) check(p.receipt.status === "success", `${name} bid: commitment ${p.bid.commitment.slice(0, 18)}…`);
const bids = await publicClient.readContract({ address: hiring, abi: sealedBidHiringAbi, functionName: "getBids", args: [taskId] });
check(bids.length === 3, "three bids on-chain, as commitments only");
await expectRevert("Atlas bids a second time", atlasOwner.address, hiringCall("bid", [taskId, atlas, someCommitment]), "AlreadyBid");
await expectRevert("closeBidding before the deadline", roles.stranger.address, hiringCall("closeBidding", [taskId]), "BiddingNotOver");

console.log("\n[6] the deadline passes; anyone closes bidding; W3 (local runner) opens the bids and awards");
await warpTo(deadline);
await expectRevert("Atlas bids at the deadline", atlasOwner.address, hiringCall("bid", [taskId, atlas, someCommitment]), "BiddingOver");
const closed = await send(roles.stranger, hiringCall("closeBidding", [taskId]));
check(parseEventLogs({ abi: sealedBidHiringAbi, eventName: "BiddingClosed", logs: closed.logs })[0]?.args.bidCount === 3n, "BiddingClosed(task, 3) emitted by a stranger's call");
const end = Date.now() + 30_000;
while ((await taskStatus(taskId)) === "Closed" && Date.now() < end) await Bun.sleep(200);
const award = await publicClient.readContract({ address: hiring, abi: sealedBidHiringAbi, functionName: "getAward", args: [taskId] });
check((await taskStatus(taskId)) === "Awarded", `task ${taskId} Awarded`);
check(award.winnerAgentId === borealis, `winner is Borealis (#${award.winnerAgentId}), the lowest bid`);
check(award.winningPrice === PRICES.borealis, `winning price ${award.winningPrice} is public by design`);
check(award.validBidCount === 3, "all 3 bids counted");

console.log("\n[7] the award is final");
const awardedLog = (await publicClient.getContractEvents({ address: hiring, abi: sealedBidHiringAbi, eventName: "JobAwarded", args: { taskId }, fromBlock: phase3Start })).at(0)!;
const deliveryTx = await publicClient.getTransaction({ hash: awardedLog.transactionHash });
const { args: deliverArgs } = decodeFunctionData({ abi: mockForwarderAbi, data: deliveryTx.input });
await expectRevert("replay the award report", roles.localDon.address, { address: veil.forwarder, abi: forwarderAbi, functionName: "deliver", args: deliverArgs! }, "TaskNotClosed");
await expectRevert("closeBidding again", roles.stranger.address, hiringCall("closeBidding", [taskId]), "TaskNotOpen");

console.log("\n[8] losers verify Merkle inclusion from public data (tree rebuilt from on-chain bids + award root)");
for (const [name, agentId] of [["Atlas", atlas], ["Cirrus", cirrus]] as const) {
  const r = await checkInclusion(taskId, agentId);
  check(r.status === "counted" && r.offChain && r.onChain, `${name}: bid counted; proof verifies off-chain and via SealedBidHiring.verifyInclusion`);
}
check(!(await publicClient.readContract({ address: hiring, abi: sealedBidHiringAbi, functionName: "verifyInclusion", args: [taskId, drift, []] })), "Drift (never bid) is not included");

console.log("\n[9] the client marks the job completed");
await expectRevert("the winner marks it completed", borealisOwner.address, hiringCall("markCompleted", [taskId]), "NotClient");
const done = await send(client, hiringCall("markCompleted", [taskId]));
const completed = parseEventLogs({ abi: sealedBidHiringAbi, eventName: "JobCompleted", logs: done.logs })[0];
check(completed?.args.agentId === borealis, "JobCompleted(task, Borealis, category, identityCommitment)");

// -----------------------------------------------------------------------------------------------------------------
console.log("\n[10] what the chain shows: the public auction view (events and transactions only)");
const graph = buildPublicGraph(await fetchPublicData(publicClient, d));
const view = buildAuctionView((await fetchAuctionData(publicClient, d))!, new Map(graph.agents.map((a) => [a.agentId, a.name])));
for (const line of view.leaks) console.log(`  - ${line}`);
const t = view.tasks.find((x) => x.taskId === taskId)!;
check(t.bids.every((b) => b.inclusion === "counted"), "the view's inclusion check (on-chain verifyInclusion) passes for every bid");

console.log("\n[11] leak scan: losing prices and salts, credentials and attestation salts");
for (const [name, p] of Object.entries(placed)) {
  if (name === "borealis") continue; // the winner's price and salt are opened on-chain by design
  secrets.push(
    { label: `${name}'s price (uint256 word)`, hex: p.bid.price.toString(16).padStart(64, "0") },
    { label: `${name}'s price (decimal string)`, hex: stringToHex(p.bid.price.toString()).slice(2) },
    { label: `${name}'s bid salt`, hex: p.bid.salt.slice(2) },
  );
}
const haystack = await collectChainBytes(phase3Start);
const unique = [...new Map(secrets.map((s) => [s.hex.replace(/^0x/, "").toLowerCase(), s])).entries()];
const found = unique.filter(([hex]) => haystack.includes(hex));
check(
  found.length === 0,
  `${unique.length} secrets, none found in ${haystack.length / 2} bytes of Phase 3 calldata and logs plus the full Anvil state` +
    (found.length ? `; LEAKED: ${found.map(([, s]) => s.label).join(", ")}` : ""),
);
check(haystack.includes(PRICES.borealis.toString(16).padStart(64, "0")), "the scan does see the (public) winning price (the scanner works)");
check(haystack.includes(placed.atlas.bid.commitment.slice(2).toLowerCase()), "the scan does see the losing commitments");

finish("PHASE 3", "three attested agents bid, W3 awarded the lowest, a loser verified inclusion, and no losing price is on-chain.");
