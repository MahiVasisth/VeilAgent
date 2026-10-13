// The Veil8004 demo, against a fresh Anvil with the sealed store, the mock screening API
// and the local runner (a SIMULATION of the CRE DON, running W1, W3 and W2) up. Started by scripts/demo.sh.
//   1. Public baseline: plain ERC-8004 interactions, and what an indexer reads from them.
//   2. Sealed auction: a task is posted, an unattested agent is rejected, three attested agents bid, W3 awards the
//      lowest; a loser checks inclusion; the job is completed and W2 issues a receipt. The SIMULATED population hires too.
//   3. Private validation: the winner's counterparty screen passes and the treasury action executes, then the gate fails
//      on a tampered input and on an expired result.
//   4. Audit: the auditor opens one validation; the others stay sealed.
//   5. Feedback: the client rates the winner anonymously, a second attempt is rejected, the average is anchored.
//   6. Side by side: the plain and Veil8004 indexer views, measured gas, and the claims table.
// Every statement the demo prints is also a check: the run fails if any of them is false.
// Env: W1_PUBLIC_KEY, W3_PUBLIC_KEY, SEALED_STORE_URL, PAUSE=1 (wait for Enter between steps), SIM_CLIENTS (default 6).
// Names, counterparties, credentials and prices are fictional demo data.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatUnits, keccak256, parseEventLogs, stringToBytes, stringToHex, toHex, type Abi, type Account, type Hex } from "viem";
import {
  anonymousFeedbackAbi,
  buildCostView,
  buildFeedbackView,
  buildPublicGraph,
  buildVeilView,
  bundleToJson,
  claimKind,
  exportBundle,
  fetchCostData,
  fetchFeedbackData,
  fetchPublicData,
  fetchVeilData,
  formatAverage,
  formatGas,
  identityRegistryAbi,
  inputCommitment,
  jsonDataUri,
  nullifierRegistryAbi,
  parseClaimsTable,
  policyId,
  privateValidationRegistryAbi,
  putPayload,
  randomSalt,
  receiptGroupManagerAbi,
  reputationRegistryAbi,
  sealedBidHiringAbi,
  sealFor,
  semaphoreAbi,
  treasuryActionAbi,
} from "@veil8004/sdk";
import { Identity } from "@veil8004/sdk/semaphore";
import { audit } from "./auditor";
import { checkInclusion, placeSealedBid } from "./bidder";
import { chainNow, check, collectChainBytes, expectRevert, finish, send, warpTo, type Call } from "./checks";
import { local, publicClient, roles } from "./env";
import { buildRating, freshWallet, rate, receiptOf, submitCall } from "./rater";
import { simulatePopulation } from "./simulator";

const SANCTIONS = policyId("SANCTIONS_SCREEN_V1");
const QUALIFIED = policyId("QUALIFIED_SCREENER_V1");
const CATEGORY = keccak256(stringToBytes("sanctions-screening"));
const STATUS = ["None", "Pending", "Passed", "Failed"] as const;
const TASK_STATUS = ["None", "Open", "Closed", "Awarded", "NoAward", "Completed"] as const;
const STORE = process.env.SEALED_STORE_URL ?? "http://127.0.0.1:8787";
const W1_PUBLIC_KEY = need("W1_PUBLIC_KEY");
const W3_PUBLIC_KEY = need("W3_PUBLIC_KEY");
const SIM_CLIENTS = Number(process.env.SIM_CLIENTS ?? 6);
const ROOT = join(import.meta.dir, "../..");
const OUT = process.env.DEMO_OUT_DIR;
// Prices in base units of a fictional 18-decimal demo token, distinctive so the leak scan cannot match by chance.
const PRICES = { atlas: 4_217_350_000_000_000_000_000n, borealis: 3_100_000_000_000_000_000_000n, cirrus: 3_904_120_000_000_000_000_000n };
const CREDENTIALS = { atlas: "QS-2026-0417", borealis: "QS-2026-0582", cirrus: "QS-2026-0733", drift: "QS-2025-0099" };

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

const { deployment: d, agents } = local();
const veil = d.veil;
if (!veil?.sealedBidHiring || !veil.receiptGroupManager || !veil.anonymousFeedback || !veil.semaphore || !veil.nullifierRegistry)
  throw new Error("the deployment file lacks Veil8004 contracts; run scripts/demo.sh, which deploys from scratch");
const registry = veil.privateValidationRegistry;
const hiring = veil.sealedBidHiring;
const [atlas, borealis, cirrus] = agents.agentIds.map(BigInt) as [bigint, bigint, bigint];
const [atlasOwner, borealisOwner, cirrusOwner] = roles.agentOwners as [Account, Account, Account];
const client = roles.clients[0]!;
const operator = roles.treasuryOperator;
const hiringCall = (functionName: string, args: readonly unknown[]): Call => ({ address: hiring, abi: sealedBidHiringAbi as Abi, functionName, args });
const execute = (requestId: Hex): Call => ({ address: veil.treasuryAction, abi: treasuryActionAbi as Abi, functionName: "execute", args: [requestId] });
const feedbackErrors = [...anonymousFeedbackAbi, ...semaphoreAbi, ...nullifierRegistryAbi, ...receiptGroupManagerAbi] as Abi;
const secrets: { label: string; hex: string }[] = [];

let stepNo = 0;
async function step(title: string, ...say: string[]) {
  if (stepNo > 0 && process.env.PAUSE === "1" && process.stdin.isTTY) prompt("\n(press Enter for the next step)");
  stepNo++;
  console.log(`\n${"=".repeat(100)}\n STEP ${stepNo}. ${title}\n${"=".repeat(100)}`);
  for (const s of say) console.log(`  ${s}`);
  console.log();
}
const say = (s: string) => console.log(`  ${s}`);

async function waitUntil(cond: () => Promise<boolean>, ms = 30_000) {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) return false;
    await Bun.sleep(200);
  }
  return true;
}
const getRequest = (requestId: Hex) => publicClient.readContract({ address: registry, abi: privateValidationRegistryAbi, functionName: "getRequest", args: [requestId] });
const taskStatus = async (taskId: bigint) =>
  TASK_STATUS[(await publicClient.readContract({ address: hiring, abi: sealedBidHiringAbi, functionName: "getTask", args: [taskId] })).status]!;

/** Flow A: commit, request, seal {input, salt} to W1 and upload it; then wait for the local runner. `sealed` lets the
 *  demo seal a different input than it committed to (the tampering case). */
async function requestPrivate(who: Account, agentId: bigint, policy: Hex, input: string, sealed = input) {
  const salt = randomSalt();
  secrets.push({ label: `input "${input}"`, hex: stringToHex(input) }, { label: "validation salt", hex: salt });
  const commitment = inputCommitment({ agentId, policyId: policy, input, salt });
  const receipt = await send(who, { address: registry, abi: privateValidationRegistryAbi as Abi, functionName: "requestPrivate", args: [agentId, policy, commitment] });
  const requestId = parseEventLogs({ abi: privateValidationRegistryAbi, eventName: "PrivateValidationRequested", logs: receipt.logs })[0]!.args.requestId;
  await putPayload(STORE, requestId, sealFor(W1_PUBLIC_KEY, { input: sealed, salt }));
  return { requestId, commitment, salt, input, agentId };
}
async function waitForResult(requestId: Hex, ms = 30_000) {
  await waitUntil(async () => STATUS[(await getRequest(requestId)).status] !== "Pending", ms);
  return STATUS[(await getRequest(requestId)).status]!;
}

// =================================================================================================================
const demoStart = await publicClient.getBlockNumber();
console.log("Veil8004 demo on a fresh local Anvil. Reports arrive through a MockForwarder from the local runner: a SIMULATED");
console.log("CRE DON (same handler code as the CRE workflows; no consensus, no signatures, no enclave). The screening provider");
console.log("is a MOCK with a fictional list. Every name, counterparty and price below is fictional.");

// -----------------------------------------------------------------------------------------------------------------
await step(
  "Public baseline: plain ERC-8004",
  "Two clients hire agents, pay them, have a counterparty screened by a public validator, and leave feedback.",
  "This is ERC-8004 as deployed today. Everything is on-chain in the clear.",
);
const base = Bun.spawnSync(["bun", join(import.meta.dir, "baseline.ts")], { env: process.env });
if (base.exitCode !== 0) throw new Error(`baseline failed:\n${base.stderr.toString()}`);
const before = buildPublicGraph(await fetchPublicData(publicClient, d));
say(`What any indexer reconstructs from public events alone (${before.leaks.length} facts):`);
for (const l of before.leaks) say(`  - ${l}`);
check(before.feedback.length === 2 && before.validations.length === 2, "the indexer links each client to its agent, payment, score and screened counterparty");

// -----------------------------------------------------------------------------------------------------------------
await step(
  "Sealed auction",
  "A client posts a task: only agents holding QUALIFIED_SCREENER_V1 may bid. Agents get that attestation privately",
  "(their credential is committed on-chain, sealed to W1, checked by the mock provider). Bids are salted commitments,",
  "their openings sealed to W3. After the deadline W3 opens them off-chain and awards the lowest.",
);
const veilStart = (await publicClient.getBlockNumber()) + 1n; // everything after the plain baseline
const epochLength = await publicClient.readContract({ address: veil.receiptGroupManager, abi: receiptGroupManagerAbi, functionName: "epochLength" });
await warpTo(((await chainNow()) / epochLength + 1n) * epochLength + 5n); // start of an epoch, so all receipts share one group
const epoch = await publicClient.readContract({ address: veil.receiptGroupManager, abi: receiptGroupManagerAbi, functionName: "currentEpoch" });

const identity = new Identity(); // the client's Semaphore identity, kept locally; only its commitment goes on-chain
const deadline = (await chainNow()) + 600n;
const posted = await send(client, hiringCall("postTask", [QUALIFIED, CATEGORY, deadline, identity.commitment]));
const taskId = parseEventLogs({ abi: sealedBidHiringAbi, eventName: "TaskPosted", logs: posted.logs })[0]!.args.taskId;
check((await taskStatus(taskId)) === "Open", `client ${client.address.slice(0, 10)}… posted task ${taskId} (category sanctions-screening), bidding open for 10 minutes`);

const reg = await send(roles.stranger, {
  address: d.identityRegistry,
  abi: identityRegistryAbi as Abi,
  functionName: "register",
  args: [jsonDataUri({ type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1", name: "Drift", description: "Fictional demo agent." }).uri],
});
const drift = parseEventLogs({ abi: identityRegistryAbi, eventName: "Registered", logs: reg.logs })[0]!.args.agentId;
const driftReq = await requestPrivate(roles.stranger, drift, QUALIFIED, CREDENTIALS.drift);
check((await waitForResult(driftReq.requestId)) === "Failed", `a fourth agent, Drift (#${drift}), asks for the attestation: W1 records a fail (credential not on the list)`);
await expectRevert("Drift tries to bid anyway", roles.stranger.address, hiringCall("bid", [taskId, drift, keccak256(toHex("x"))]), "NotAttested");

for (const [name, owner, agentId, credential] of [
  ["Atlas", atlasOwner, atlas, CREDENTIALS.atlas],
  ["Borealis", borealisOwner, borealis, CREDENTIALS.borealis],
  ["Cirrus", cirrusOwner, cirrus, CREDENTIALS.cirrus],
] as const) {
  const r = await requestPrivate(owner, agentId, QUALIFIED, credential);
  check((await waitForResult(r.requestId)) === "Passed", `${name} attested privately (W1 pass; the chain holds only the commitment)`);
}
const placed = {
  atlas: await placeSealedBid({ owner: atlasOwner, taskId, agentId: atlas, price: PRICES.atlas, w3PublicKey: W3_PUBLIC_KEY, storeUrl: STORE }),
  borealis: await placeSealedBid({ owner: borealisOwner, taskId, agentId: borealis, price: PRICES.borealis, w3PublicKey: W3_PUBLIC_KEY, storeUrl: STORE }),
  cirrus: await placeSealedBid({ owner: cirrusOwner, taskId, agentId: cirrus, price: PRICES.cirrus, w3PublicKey: W3_PUBLIC_KEY, storeUrl: STORE }),
};
for (const [name, p] of Object.entries(placed)) say(`${name} bids: on-chain commitment ${p.bid.commitment.slice(0, 18)}… (price sealed)`);
await warpTo(deadline);
await send(roles.stranger, hiringCall("closeBidding", [taskId]));
await waitUntil(async () => (await taskStatus(taskId)) !== "Closed");
const award = await publicClient.readContract({ address: hiring, abi: sealedBidHiringAbi, functionName: "getAward", args: [taskId] });
check(award.winnerAgentId === borealis && award.winningPrice === PRICES.borealis, `deadline passed, anyone closed bidding, W3 awarded Borealis at ${formatUnits(award.winningPrice, 18)} (the lowest; public by design)`);
const inc = await checkInclusion(taskId, atlas);
check(inc.status === "counted" && inc.onChain, "Atlas (a loser) proves from public data that its bid was counted (Merkle inclusion)");
for (const name of ["atlas", "cirrus"] as const) {
  const b = placed[name].bid;
  secrets.push(
    { label: `${name}'s losing price`, hex: b.price.toString(16).padStart(64, "0") },
    { label: `${name}'s losing price (decimal)`, hex: stringToHex(b.price.toString()) },
    { label: `${name}'s bid salt`, hex: b.salt },
  );
}
const auctionBytes = await collectChainBytes(veilStart);
check(
  ["atlas", "cirrus"].every((n) => secrets.filter((s) => s.label.startsWith(n)).every((s) => !auctionBytes.includes(s.hex.replace(/^0x/, "").toLowerCase()))),
  "no losing price or salt anywhere on-chain (calldata, logs, full state)",
);
await send(client, hiringCall("markCompleted", [taskId]));
check(await waitUntil(async () => (await receiptOf(taskId)) !== null), "Borealis delivers; the client marks the job completed; W2 issues the client a receipt");

say("");
say(`The SIMULATED population: ${SIM_CLIENTS} simulated clients hire the same way, so the receipt group is not just one person.`);
const sim = await simulatePopulation({ clients: SIM_CLIENTS, agents: 3, w3PublicKey: W3_PUBLIC_KEY, storeUrl: STORE, log: (l) => say(`  [SIMULATED] ${l}`) });
check(sim.epoch === BigInt(epoch), `simulated receipts joined the client's group (epoch ${epoch}): ${sim.groupSize} members, ${sim.groupSize - 1} of them SIMULATED`);

// -----------------------------------------------------------------------------------------------------------------
await step(
  "Private validation and the gate",
  "Before paying Borealis, the treasury screens the counterparty privately (SANCTIONS_SCREEN_V1). Only a salted",
  "commitment goes on-chain. TreasuryAction.execute is gated on that exact result.",
);
const pass = await requestPrivate(operator, borealis, SANCTIONS, "Northwind Trading LLC");
check((await waitForResult(pass.requestId)) === "Passed", "W1 decrypted the opening, matched it to the commitment, screened it: pass");
const exec = await send(roles.stranger, execute(pass.requestId));
check(parseEventLogs({ abi: treasuryActionAbi, eventName: "ActionExecuted", logs: exec.logs }).length === 1, "TreasuryAction.execute(request) succeeds: ActionExecuted (the action itself is public)");

const tampered = await requestPrivate(operator, borealis, SANCTIONS, "Northwind Trading LLC", "Kestrel Shipping Co");
await Bun.sleep(3000);
check((await waitForResult(tampered.requestId, 0)) === "Pending", "tampered: commit to one counterparty, seal another. W1 sees the mismatch and writes nothing");
await expectRevert("execute on the tampered request", operator.address, execute(tampered.requestId), "NotAttested");

const fresh = await requestPrivate(operator, borealis, SANCTIONS, "Harbor Light Ventures");
check((await waitForResult(fresh.requestId)) === "Passed", "a second screen passes, and would unlock the action now");
await warpTo((await getRequest(fresh.requestId)).expiry);
await expectRevert("an hour later, execute on the expired result", operator.address, execute(fresh.requestId), "NotAttested");

// -----------------------------------------------------------------------------------------------------------------
await step(
  "Selective disclosure to an auditor",
  "The treasury's auditor asks about the first screen. The treasury hands over one bundle: that request's input and",
  "salt. The auditor checks it against the chain with reads only. Nothing goes on-chain; every other request stays sealed.",
);
const bundle = await exportBundle(publicClient, { registry, requestId: pass.requestId, input: pass.input, salt: pass.salt });
const auditBlock = await publicClient.getBlockNumber();
const bundlePath = join(OUT ?? mkdtempSync(join(tmpdir(), "veil-demo-")), "bundle.json");
writeFileSync(bundlePath, bundleToJson(bundle), { mode: 0o600 }); // holds the salt: for the auditor only
const cli = Bun.spawnSync(["bun", join(import.meta.dir, "auditor.ts"), bundlePath], { env: process.env });
for (const l of cli.stdout.toString().trimEnd().split("\n")) say(`| ${l}`);
check(cli.exitCode === 0, "the auditor CLI verifies it: input, agent, policy, result, tier and expiry match the chain");
let opened = 0;
for (const other of [tampered, fresh, driftReq]) if ((await audit({ ...bundle, requestId: other.requestId, agentId: other.agentId.toString() })).valid) opened++;
check(opened === 0, "the same opening pointed at any other request opens nothing");
check((await publicClient.getBlockNumber()) === auditBlock, "the audit sent no transaction");

// -----------------------------------------------------------------------------------------------------------------
await step(
  "Anonymous feedback",
  "The client rates Borealis with a Semaphore proof: \"I hold a receipt in this group\", scoped to (agent, epoch).",
  "It is sent from a fresh wallet (a stand-in for a relayer). The chain learns the score, not which member gave it.",
);
const receipt = (await receiptOf(taskId))!;
const sender = await freshWallet();
const r = await rate({ identity, receipt, score: 5n, sender });
check(r.tx.status === "success", `rating accepted: Borealis 5/5, the rater is one of ${r.anonymitySet} receipt holders (${r.anonymitySet - 1} SIMULATED)`);
const again = await buildRating(identity, receipt, borealis, 1n);
await expectRevert("the client tries to rate Borealis again (score 1)", roles.stranger.address, { ...submitCall(borealis, receipt, again.proof), abi: feedbackErrors } as Call, "Semaphore__YouAreUsingTheSameNullifierTwice");
const ratingTx = await publicClient.getTransaction({ hash: r.tx.transactionHash });
check(
  !ratingTx.input.toLowerCase().includes(client.address.slice(2).toLowerCase()) && !ratingTx.input.includes(toHex(identity.commitment, { size: 32 }).slice(2)),
  "the rating's calldata carries neither the client's address nor its identity commitment",
);
await warpTo(await publicClient.readContract({ address: veil.receiptGroupManager, abi: receiptGroupManagerAbi, functionName: "ratingClosesAt", args: [receipt.epoch] }));
await send(roles.stranger, { address: veil.anonymousFeedback, abi: anonymousFeedbackAbi as Abi, functionName: "anchor", args: [borealis, receipt.epoch] });
const [count, value, decimals] = await publicClient.readContract({
  address: d.reputationRegistry,
  abi: reputationRegistryAbi,
  functionName: "getSummary",
  args: [borealis, [veil.anonymousFeedback], "veil8004", "anon-aggregate"],
});
check(count === 1n && value === 500n && decimals === 2, `ratings closed; anyone anchored the epoch average: ERC-8004 getSummary(Borealis, [AnonymousFeedback]) = ${formatAverage(value)}`);

// -----------------------------------------------------------------------------------------------------------------
await step("Side by side", "The same kinds of interaction, as a public indexer sees them.");
const anon = veil.anonymousFeedback.toLowerCase();
const rawPublic = await fetchPublicData(publicClient, d);
const plain = buildPublicGraph({ ...rawPublic, feedback: rawPublic.feedback.filter((f) => f.client.toLowerCase() !== anon) });
const names = new Map(plain.agents.map((a) => [a.agentId, a.name]));
const veilView = buildVeilView((await fetchVeilData(publicClient, d))!, names);
const fb = buildFeedbackView((await fetchFeedbackData(publicClient, d))!, names);
say("PLAIN ERC-8004 (validations and feedback):");
for (const l of plain.leaks.filter((l) => /screen|rated|paid|valid/i.test(l)).slice(0, 6)) say(`  - ${l}`);
say("VEIL8004 validations: what the chain shows");
for (const row of veilView.rows.filter((x) => [pass.requestId, tampered.requestId, fresh.requestId].includes(x.requestId)))
  say(`  - ${row.agentName}: ${row.policyName ?? row.policyId.slice(0, 10)} → ${row.result}${row.expired ? " (expired)" : ""}, commitment ${row.commitment.slice(0, 18)}…, input: sealed`);
say("VEIL8004 ratings: what the chain shows");
for (const x of fb.ratings.filter((x) => x.agentId === borealis)) say(`  - ${x.agentName} ${x.score}/5 in epoch ${x.epoch}, from one of ${x.anonymitySet} receipt holders`);
const veilBytes = await collectChainBytes(veilStart);
const leaked = [...new Map(secrets.map((x) => [x.hex.replace(/^0x/, "").toLowerCase(), x])).entries()].filter(([hex]) => veilBytes.includes(hex));
check(
  leaked.length === 0,
  `leak scan since the baseline: none of ${secrets.length} secrets (inputs, credentials, salts, losing prices) in calldata, logs or state` +
    (leaked.length ? `; LEAKED: ${leaked.map(([, x]) => x.label).join(", ")}` : ""),
);

const costs = buildCostView(await fetchCostData(publicClient, d));
say("");
say("Measured gas (median per transaction, from receipts; reports via the MockForwarder):");
for (const c of costs.rows) say(`  ${c.label.padEnd(26)} ${formatGas(c.median).padStart(10)}   (${c.count} tx)`);
check(costs.attestationTotal !== null && costs.rows.some((c) => c.op === "rating"), `one private attestation end to end: ${formatGas(costs.attestationTotal ?? 0n)} gas`);

const claims = parseClaimsTable(readFileSync(join(ROOT, "README.md"), "utf8"));
say("");
say("CLAIMS AND LIMITS (README.md). The demo claims nothing beyond this table:");
for (const c of claims) say(`  ${({ yes: "✔", no: "✘", partial: "~" } as const)[claimKind(c.claimed)]} ${c.property}: ${c.claimed}${c.notes ? ` (${c.notes})` : ""}`);
check(claims.length > 0, `${claims.length} claims, read from the README`);

finish("DEMO", "every step of the demo script ran and every statement it printed was checked.");
process.exit(0); // snarkjs may leave handles open
