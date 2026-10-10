// Population simulator (Phase 6): N SIMULATED clients across M agents, to fill the receipt groups' anonymity set.
//
//   bun scripts/src/simulator.ts [--clients 6] [--agents 3] [--rate]
//
// Each simulated client makes a Semaphore identity, posts a task from a fresh wallet with that commitment, and hires one
// of the first M demo agents through a sealed bid. Bidding closes, W3 (the local runner) awards, the client marks the job
// completed, and W2 issues its receipt into the (category, epoch) group, where it joins the real clients' receipts.
// With --rate, each simulated client also rates its agent (1-5, proved offline, sent from another fresh wallet).
//
// Everything it creates is listed in contracts/deployments/<chainId>-simulated.json; the frontend shows a SIMULATED
// banner and labels those rows while that file exists, and Deploy.s.sol deletes it. Anvil only: it funds wallets from
// the deployer and moves the chain clock past each batch's bidding deadline.
// Env: W3_PUBLIC_KEY, SEALED_STORE_URL, and W1_PUBLIC_KEY to renew lapsed agent attestations; the local runner must
// be running W1, W3 and W2.
import { parseArgs } from "node:util";
import { keccak256, parseEventLogs, stringToBytes, type Abi, type Account, type Address } from "viem";
import { policyId, privateValidationRegistryAbi, receiptGroupManagerAbi, sealedBidHiringAbi, semaphoreAbi } from "@veil8004/sdk";
import { loadSimulated, saveSimulated } from "@veil8004/sdk/deployments";
import { DEFAULT_DEPTHS } from "@veil8004/sdk/snark-artifacts";
import { Identity } from "@veil8004/sdk/semaphore";
import { placeSealedBid } from "./bidder";
import { chainNow, send, warpTo } from "./checks";
import { requestValidation } from "./client";
import { CHAIN, DEPLOYMENTS_DIR, local, publicClient, roles } from "./env";
import { freshWallet, rate, receiptOf } from "./rater";

const QUALIFIED = policyId("QUALIFIED_SCREENER_V1");
export const SIM_CATEGORY = keccak256(stringToBytes("sanctions-screening"));
const NOTE = "Created by scripts/src/simulator.ts. SIMULATED clients, tasks and ratings, to fill the anonymity set; not real users.";
// Simulated scores, in order. Fixed so runs are reproducible.
const SCORES = [4n, 5n, 3n, 5n, 4n, 4n, 5n, 3n];
// The demo agents' fictional screener credentials (services/mock-screening lists them), by agent index.
const DEMO_CREDENTIALS = ["QS-2026-0417", "QS-2026-0582", "QS-2026-0733"];
const TASK_COMPLETED = 5;
const units = (n: number) => BigInt(Math.round(n * 100)) * 10n ** 16n; // 18-decimal demo token

export type SimulationResult = { taskIds: bigint[]; clients: Address[]; raters: Address[]; groupSize: number; epoch: bigint };

async function waitUntil(cond: () => Promise<boolean>, ms = 60_000) {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) return false;
    await Bun.sleep(200);
  }
  return true;
}

/** Runs the simulated population against the local deployment. `log` gets one line per step. */
export async function simulatePopulation(p: {
  clients: number;
  agents: number;
  rate?: boolean;
  w3PublicKey: string;
  storeUrl: string;
  log?: (line: string) => void;
}): Promise<SimulationResult> {
  const log = p.log ?? ((l: string) => console.log(`[SIMULATED] ${l}`));
  const { deployment: d, agents } = local();
  const v = d.veil;
  if (!v?.sealedBidHiring || !v.receiptGroupManager) throw new Error("no Phase 5 contracts in the deployment file; re-run Deploy.s.sol");
  const hiring = v.sealedBidHiring;
  const call = (functionName: string, args: readonly unknown[]) => ({ address: hiring, abi: sealedBidHiringAbi as Abi, functionName, args });

  const agentIds = agents.agentIds.slice(0, p.agents).map(BigInt);
  const owners = agentIds.map((_, i) => roles.agentOwners[i]!);
  if (agentIds.length === 0) throw new Error("no demo agents registered");
  // An attestation lapses after the policy's validity window (the demo moves the clock an hour). The agent's owner
  // renews it through W1, as any agent would, with the demo's fictional credential.
  const attested = (id: bigint) =>
    publicClient.readContract({ address: v.privateValidationRegistry, abi: privateValidationRegistryAbi, functionName: "isAttested", args: [id, QUALIFIED] });
  for (const [i, id] of agentIds.entries()) {
    if (await attested(id)) continue;
    const credential = DEMO_CREDENTIALS[i];
    if (!credential || !process.env.W1_PUBLIC_KEY) throw new Error(`agent #${id} does not hold QUALIFIED_SCREENER_V1, so it cannot bid; set W1_PUBLIC_KEY to renew it`);
    await requestValidation({ agentId: id, policy: "QUALIFIED_SCREENER_V1", input: credential, from: String(i + 1) });
    if (!(await waitUntil(() => attested(id)))) throw new Error(`agent #${id}: W1 did not renew QUALIFIED_SCREENER_V1 (is the local runner running?)`);
    log(`agent #${id}'s QUALIFIED_SCREENER_V1 had lapsed; its owner renewed it through W1`);
  }

  // Groups are capped by the proving artifacts this repo pins (depths 1..4 = 16 members).
  const epoch = await publicClient.readContract({ address: v.receiptGroupManager, abi: receiptGroupManagerAbi, functionName: "currentEpoch" });
  const maxMembers = 2 ** Math.max(...DEFAULT_DEPTHS);
  const before = await currentGroupSize(v.receiptGroupManager, v.semaphore!, BigInt(epoch));
  if (before + p.clients > maxMembers) throw new Error(`group would exceed ${maxMembers} members (the pinned proving artifacts' limit)`);

  const sims: { account: Account; identity: Identity; agentIndex: number; taskId: bigint }[] = [];
  const deadline = (await chainNow()) + 120n;
  for (let i = 0; i < p.clients; i++) {
    const account = await freshWallet();
    const identity = new Identity();
    const agentIndex = i % agentIds.length;
    const posted = await send(account, call("postTask", [QUALIFIED, SIM_CATEGORY, deadline, identity.commitment]));
    const taskId = parseEventLogs({ abi: sealedBidHiringAbi, eventName: "TaskPosted", logs: posted.logs })[0]!.args.taskId;
    await placeSealedBid({ owner: owners[agentIndex]!, taskId, agentId: agentIds[agentIndex]!, price: units(2000 + 37.5 * i), w3PublicKey: p.w3PublicKey, storeUrl: p.storeUrl });
    sims.push({ account, identity, agentIndex, taskId });
    log(`client ${i + 1}/${p.clients} (${account.address.slice(0, 10)}…) posted task ${taskId}; agent #${agentIds[agentIndex]} bid`);
  }
  record(sims.map((s) => s.taskId), sims.map((s) => s.account.address), []);

  await warpTo(deadline);
  for (const s of sims) await send(roles.stranger, call("closeBidding", [s.taskId]));
  const status = async (taskId: bigint) => (await publicClient.readContract({ address: hiring, abi: sealedBidHiringAbi, functionName: "getTask", args: [taskId] })).status;
  for (const s of sims) if (!(await waitUntil(async () => (await status(s.taskId)) === 3))) throw new Error(`task ${s.taskId}: no award from W3 (is the local runner running W3?)`);
  log(`W3 awarded all ${sims.length} simulated tasks`);
  for (const s of sims) await send(s.account, call("markCompleted", [s.taskId]));
  for (const s of sims) {
    if ((await status(s.taskId)) !== TASK_COMPLETED) throw new Error(`task ${s.taskId} not completed`);
    if (!(await waitUntil(async () => (await receiptOf(s.taskId)) !== null))) throw new Error(`task ${s.taskId}: no receipt from W2`);
  }
  // A receipt's epoch is when W2's report lands (P5-6), which may be after the one read above.
  const receiptEpoch = (await receiptOf(sims[0]!.taskId))!.epoch;
  const groupSize = await currentGroupSize(v.receiptGroupManager, v.semaphore!, receiptEpoch);
  log(`W2 issued ${sims.length} receipts; the epoch ${receiptEpoch} group now has ${groupSize} members`);

  const raters: Address[] = [];
  if (p.rate) {
    for (const [i, s] of sims.entries()) {
      const sender = await freshWallet();
      raters.push(sender.address);
      record([], [], [sender.address]); // before sending, so a crash never leaves an unlabeled simulated rating
      const receipt = (await receiptOf(s.taskId))!;
      await rate({ identity: s.identity, receipt, score: SCORES[i % SCORES.length]!, sender });
      log(`client ${i + 1} rated agent #${receipt.agentId} ${SCORES[i % SCORES.length]}/5 from ${sender.address.slice(0, 10)}…`);
    }
  }
  return { taskIds: sims.map((s) => s.taskId), clients: sims.map((s) => s.account.address), raters, groupSize, epoch: receiptEpoch };
}

async function currentGroupSize(manager: Address, semaphore: Address, epoch: bigint): Promise<number> {
  const has = await publicClient.readContract({ address: manager, abi: receiptGroupManagerAbi, functionName: "hasGroup", args: [SIM_CATEGORY, epoch] });
  if (!has) return 0;
  const groupId = await publicClient.readContract({ address: manager, abi: receiptGroupManagerAbi, functionName: "groupId", args: [SIM_CATEGORY, epoch] });
  return Number(await publicClient.readContract({ address: semaphore, abi: semaphoreAbi, functionName: "getMerkleTreeSize", args: [groupId] }));
}

/** Appends to the manifest, so every simulated thing is labeled as soon as it exists. */
function record(taskIds: bigint[], clients: Address[], raters: Address[]) {
  const file = loadSimulated(DEPLOYMENTS_DIR, CHAIN.id) ?? { note: NOTE, taskIds: [], clients: [], raters: [] };
  file.taskIds.push(...taskIds.map(String));
  file.clients.push(...clients);
  file.raters.push(...raters);
  saveSimulated(DEPLOYMENTS_DIR, CHAIN.id, file);
}

// ---- CLI ----------------------------------------------------------------------------------------
if (import.meta.main) {
  const { values } = parseArgs({
    options: { clients: { type: "string", default: "6" }, agents: { type: "string", default: "3" }, rate: { type: "boolean", default: false } },
  });
  const w3PublicKey = process.env.W3_PUBLIC_KEY;
  if (!w3PublicKey) throw new Error("W3_PUBLIC_KEY is required");
  const r = await simulatePopulation({
    clients: Number(values.clients),
    agents: Number(values.agents),
    rate: values.rate,
    w3PublicKey,
    storeUrl: process.env.SEALED_STORE_URL ?? "http://127.0.0.1:8787",
  });
  console.log(`[SIMULATED] done: ${r.taskIds.length} tasks, receipt group for epoch ${r.epoch} has ${r.groupSize} members. Listed in ${DEPLOYMENTS_DIR}/${CHAIN.id}-simulated.json`);
  process.exit(0); // snarkjs may leave handles open
}
