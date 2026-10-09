// Phase 2 exit criterion, against a live Anvil with the sealed store, the mock screening API and the local runner
// (a SIMULATION of the CRE DON) running. Started by scripts/phase2.sh.
//   1. The gate passes on a valid result, and fails on missing, failed, expired, wrong-policy, tampered-input and
//      someone else's results. Replayed reports and non-forwarder callers are rejected.
//   2. The chain shows only commitment, policy and result: the public indexer view is printed, and calldata, logs and
//      the full Anvil state are scanned for every plaintext input, salt and unsalted input hash used here.
// Env: W1_PUBLIC_KEY, SEALED_STORE_URL. Entity names are fictional demo data.
import { gunzipSync } from "node:zlib";
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeAbiParameters,
  encodeAbiParameters,
  keccak256,
  parseEventLogs,
  stringToHex,
  toHex,
  type Abi,
  type Account,
  type Address,
  type Hex,
} from "viem";
import {
  buildPublicGraph,
  buildVeilView,
  fetchPublicData,
  fetchVeilData,
  inputCommitment,
  inputHash,
  mockForwarderAbi,
  policyId,
  policyRegistryAbi,
  privateValidationRegistryAbi,
  putPayload,
  randomSalt,
  sealFor,
  treasuryActionAbi,
  validationRegistryAbi,
} from "@veil8004/sdk";
import { local, publicClient, roles, walletFor } from "./env";

const SANCTIONS = policyId("SANCTIONS_SCREEN_V1");
const OTHER_POLICY = policyId("OTHER_POLICY_V1");
const STATUS = ["None", "Pending", "Passed", "Failed"] as const;
const W1_PUBLIC_KEY = need("W1_PUBLIC_KEY");
const STORE = process.env.SEALED_STORE_URL ?? "http://127.0.0.1:8787";

const { deployment: d, agents } = local();
if (!d.veil) throw new Error("no Phase 2 contracts in the deployment file; run Deploy.s.sol");
const veil = d.veil;
const registry = veil.privateValidationRegistry;
const [atlas, borealis] = agents.agentIds.map(BigInt) as [bigint, bigint];
const forwarderAbi = [...mockForwarderAbi, ...privateValidationRegistryAbi] as Abi; // decode bubbled registry errors

// Every secret this run creates; the leak scan looks for each of them.
const secrets: { label: string; hex: Hex }[] = [];
const results: { ok: boolean; line: string }[] = [];
const check = (ok: boolean, line: string) => {
  results.push({ ok, line });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${line}`);
};

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

async function send(from: Account, params: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] }) {
  const hash = await walletFor(from).writeContract({ ...params, account: from, chain: undefined } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${params.functionName} reverted: ${hash}`);
  return receipt;
}

/** Simulates the call from `from` and requires it to revert with `errorName`. */
async function expectRevert(
  label: string,
  from: Address,
  params: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] },
  errorName: string,
) {
  try {
    await publicClient.simulateContract({ ...params, account: from } as never);
  } catch (e) {
    const revert = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    const got = revert instanceof ContractFunctionRevertedError ? (revert.data?.errorName ?? revert.reason ?? "?") : String(e);
    check(got === errorName, `${label}: reverts ${got}${got === errorName ? "" : ` (expected ${errorName})`}`);
    return;
  }
  check(false, `${label}: expected revert ${errorName}, but the call succeeded`);
}

type Upload = "match" | "tampered" | "none";
/** Client side of Flow A: commit, request, then seal {input, salt} to W1 and upload it under the requestId. */
async function requestPrivate(who: Account, agentId: bigint, policy: Hex, input: string, upload: Upload = "match") {
  const salt = randomSalt();
  secrets.push({ label: `input "${input}"`, hex: stringToHex(input) }, { label: "salt", hex: salt });
  secrets.push({ label: `unsalted hash of "${input}"`, hex: inputHash(input) });
  const commitment = inputCommitment({ agentId, policyId: policy, input, salt });
  const receipt = await send(who, { address: registry, abi: privateValidationRegistryAbi, functionName: "requestPrivate", args: [agentId, policy, commitment] });
  const [event] = parseEventLogs({ abi: privateValidationRegistryAbi, eventName: "PrivateValidationRequested", logs: receipt.logs });
  const requestId = event!.args.requestId;
  if (upload !== "none") {
    const sealedInput = upload === "tampered" ? "Kestrel Shipping Co" : input;
    await putPayload(STORE, requestId, sealFor(W1_PUBLIC_KEY, { input: sealedInput, salt }));
  }
  return { requestId, commitment, salt };
}

async function getRequest(requestId: Hex) {
  return publicClient.readContract({ address: registry, abi: privateValidationRegistryAbi, functionName: "getRequest", args: [requestId] });
}

/** Waits for the local runner to record a result. Returns the final status name. */
async function waitForResult(requestId: Hex, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const status = STATUS[(await getRequest(requestId)).status]!;
    if (status !== "Pending" || Date.now() > end) return status;
    await Bun.sleep(200);
  }
}

const execute = (requestId: Hex) => ({ address: veil.treasuryAction, abi: treasuryActionAbi as Abi, functionName: "execute", args: [requestId] });
const w1Report = (requestId: Hex, commitment: Hex, passed: boolean, policy: Hex, expiry: bigint) =>
  encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "bool" }, { type: "bytes32" }, { type: "uint8" }, { type: "uint64" }],
    [requestId, commitment, passed, policy, 1, expiry],
  );
async function deliverParams(report: Hex) {
  const name = await publicClient.readContract({ address: veil.forwarder, abi: mockForwarderAbi, functionName: "workflowNameOf", args: ["veil8004-w1-validator"] });
  return { address: veil.forwarder, abi: forwarderAbi, functionName: "deliver", args: [registry, veil.w1WorkflowId, name, roles.localDon.address, "0x0001", report] };
}
const chainNow = async () => (await publicClient.getBlock({ blockTag: "latest" })).timestamp;

// -----------------------------------------------------------------------------------------------------------------
const phase2Start = await publicClient.getBlockNumber();
const operator = roles.treasuryOperator;
console.log(`Phase 2 on Anvil. Treasury operator ${operator.address}; reports via MockForwarder ${veil.forwarder} (SIMULATED DON).`);

console.log("\n[1] valid result: the operator screens a counterparty privately for Atlas, then executes");
const pass = await requestPrivate(operator, atlas, SANCTIONS, "Northwind Trading LLC");
check((await waitForResult(pass.requestId)) === "Passed", "W1 (local runner) recorded a pass");
check(await publicClient.readContract({ address: registry, abi: privateValidationRegistryAbi, functionName: "verifyResult", args: [pass.requestId, SANCTIONS] }), "verifyResult(request, SANCTIONS_SCREEN_V1) is true");
const exec = await send(roles.stranger, execute(pass.requestId));
check(parseEventLogs({ abi: treasuryActionAbi, eventName: "ActionExecuted", logs: exec.logs }).length === 1, "TreasuryAction.execute succeeded (ActionExecuted)");
await expectRevert("execute the same request again", roles.stranger.address, execute(pass.requestId), "AlreadyExecuted");

console.log("\n[2] ERC-8004 mirror: Atlas's owner opens a standard request naming the registry; anyone mirrors");
await send(roles.agentOwners[0]!, { address: d.validationRegistry, abi: validationRegistryAbi as Abi, functionName: "validationRequest", args: [registry, atlas, "", pass.requestId] });
await send(roles.stranger, { address: registry, abi: privateValidationRegistryAbi as Abi, functionName: "mirrorToERC8004", args: [pass.requestId] });
const [, , mirrored] = await publicClient.readContract({ address: d.validationRegistry, abi: validationRegistryAbi, functionName: "getValidationStatus", args: [pass.requestId] });
check(mirrored === 100, "ERC-8004 Validation Registry shows response 100, tag veil8004-private, no input");

console.log("\n[3] failed result: a counterparty on the (mock) list");
const failed = await requestPrivate(operator, borealis, SANCTIONS, "Kestrel Shipping Co");
check((await waitForResult(failed.requestId)) === "Failed", "W1 recorded a fail");
await expectRevert("execute on a failed result", operator.address, execute(failed.requestId), "NotAttested");

console.log("\n[4] missing result: the request exists, no sealed payload, no report");
const missing = await requestPrivate(operator, atlas, SANCTIONS, "Harbor Light Ventures", "none");
await expectRevert("execute on a pending request", operator.address, execute(missing.requestId), "NotAttested");
await expectRevert("execute on an unknown request id", operator.address, execute(keccak256(toHex("no such request"))), "NotAttested");

console.log("\n[5] tampered input: commit to one counterparty, seal another");
const tampered = await requestPrivate(operator, atlas, SANCTIONS, "Northwind Trading LLC", "tampered");
await Bun.sleep(4000); // the runner fetches, decrypts, recomputes the commitment and stops
check((await waitForResult(tampered.requestId, 0)) === "Pending", "W1 found the commitment mismatch and wrote no report");
await expectRevert("execute on the tampered request", operator.address, execute(tampered.requestId), "NotAttested");
const forgedCommitment = inputCommitment({ agentId: atlas, policyId: SANCTIONS, input: "Kestrel Shipping Co", salt: tampered.salt });
await expectRevert(
  "a report carrying the tampered input's commitment",
  roles.localDon.address,
  await deliverParams(w1Report(tampered.requestId, forgedCommitment, true, SANCTIONS, (await chainNow()) + 600n)),
  "CommitmentMismatch",
);

console.log("\n[6] wrong policy");
await expectRevert(
  "a report naming another policy for a SANCTIONS request",
  roles.localDon.address,
  await deliverParams(w1Report(missing.requestId, missing.commitment, true, OTHER_POLICY, (await chainNow()) + 600n)),
  "PolicyMismatch",
);
await send(roles.deployer, { address: veil.policyRegistry, abi: policyRegistryAbi as Abi, functionName: "createPolicy", args: [OTHER_POLICY, keccak256(toHex("other demo policy")), 1, 3600n, 0n] });
const other = await requestPrivate(operator, atlas, OTHER_POLICY, "Northwind Trading LLC", "none");
// W1 only evaluates SANCTIONS_SCREEN_V1, so the simulated DON reports this pass by hand.
await send(roles.localDon, await deliverParams(w1Report(other.requestId, other.commitment, true, OTHER_POLICY, (await chainNow()) + 600n)));
check(STATUS[(await getRequest(other.requestId)).status] === "Passed", "a pass recorded under OTHER_POLICY_V1 (simulated DON)");
await expectRevert("execute with a pass under the wrong policy", operator.address, execute(other.requestId), "NotAttested");

console.log("\n[7] replayed report and non-forwarder caller");
const deliveryTx = (await publicClient.getContractEvents({ address: registry, abi: privateValidationRegistryAbi, eventName: "PrivateValidationRecorded", args: { requestId: pass.requestId }, fromBlock: phase2Start })).at(0)!.transactionHash;
const tx = await publicClient.getTransaction({ hash: deliveryTx });
await expectRevert("replay the delivered pass report", roles.localDon.address, { address: veil.forwarder, abi: forwarderAbi, functionName: "deliver", args: decodeDeliver(tx.input) }, "RequestNotPending");
const metadata = (`0x${veil.w1WorkflowId.slice(2)}${"00".repeat(10)}${roles.localDon.address.slice(2)}0001`) as Hex;
await expectRevert(
  "onReport called directly by a stranger",
  roles.stranger.address,
  { address: registry, abi: privateValidationRegistryAbi as Abi, functionName: "onReport", args: [metadata, w1Report(missing.requestId, missing.commitment, true, SANCTIONS, (await chainNow()) + 600n)] },
  "InvalidSender",
);
await expectRevert(
  "MockForwarder.deliver from a non-transmitter",
  roles.stranger.address,
  await deliverParams(w1Report(missing.requestId, missing.commitment, true, SANCTIONS, (await chainNow()) + 600n)),
  "NotTransmitter",
);

console.log("\n[8] someone else's passing result");
const clientPass = await requestPrivate(roles.clients[0]!, atlas, SANCTIONS, "Northwind Trading LLC");
check((await waitForResult(clientPass.requestId)) === "Passed", "a client's own request passed");
await expectRevert("execute with the client's pass", operator.address, execute(clientPass.requestId), "NotOperatorRequest");

console.log("\n[9] expired result");
const fresh = await requestPrivate(operator, atlas, SANCTIONS, "Northwind Trading LLC");
check((await waitForResult(fresh.requestId)) === "Passed", "a fresh pass recorded");
const before = await publicClient.simulateContract({ ...execute(fresh.requestId), account: operator.address } as never).then(() => true, () => false);
check(before, "execute would succeed before expiry");
const { expiry } = await getRequest(fresh.requestId);
await publicClient.request({ method: "evm_setNextBlockTimestamp" as never, params: [toHex(expiry)] as never });
await publicClient.request({ method: "evm_mine" as never, params: [] as never });
await expectRevert("execute at expiry", operator.address, execute(fresh.requestId), "NotAttested");

// -----------------------------------------------------------------------------------------------------------------
console.log("\n[10] what the chain shows: the public Veil8004 view (events and transactions only)");
const graph = buildPublicGraph(await fetchPublicData(publicClient, d));
const view = buildVeilView((await fetchVeilData(publicClient, d))!, new Map(graph.agents.map((a) => [a.agentId, a.name])));
for (const line of view.leaks) console.log(`  - ${line}`);
const veilRows = view.rows.filter((r) => [pass, failed, missing, tampered, other, clientPass, fresh].some((x) => x.requestId === r.requestId));
check(veilRows.length === 7, "every request is visible as agent, policy, requester, commitment and result");

console.log("\n[11] leak scan: plaintext inputs, salts and unsalted input hashes");
const haystack = await collectChainBytes(phase2Start);
const unique = [...new Map(secrets.map((s) => [s.hex.toLowerCase(), s])).values()];
const found = unique.filter((s) => haystack.includes(s.hex.slice(2).toLowerCase()));
check(
  found.length === 0,
  `${unique.length} secrets, none found in ${haystack.length / 2} bytes of Phase 2 calldata and logs plus the full Anvil state` +
    (found.length ? `; LEAKED: ${found.map((s) => s.label).join(", ")}` : ""),
);
const commitmentSeen = haystack.includes(pass.commitment.slice(2).toLowerCase());
check(commitmentSeen, "the scan does see the commitments (the scanner works)");

// -----------------------------------------------------------------------------------------------------------------
const failures = results.filter((r) => !r.ok);
console.log(`\n${results.length - failures.length}/${results.length} checks passed.`);
if (failures.length) {
  console.error(`PHASE 2 EXIT CHECK FAILED:\n  ${failures.map((f) => f.line).join("\n  ")}`);
  process.exit(1);
}
console.log("PHASE 2 EXIT CHECK PASSED: the gate passes and fails as specified, and the chain shows only commitment, policy and result.");

// -----------------------------------------------------------------------------------------------------------------
function decodeDeliver(input: Hex) {
  // deliver(address,bytes32,bytes10,address,bytes2,bytes): reuse the exact arguments of the original delivery.
  const args = parseDeliver(input);
  return [args.receiver, args.workflowId, args.workflowName, args.workflowOwner, args.reportId, args.report] as const;
}

function parseDeliver(input: Hex) {
  const params = [
    { type: "address" }, { type: "bytes32" }, { type: "bytes10" }, { type: "address" }, { type: "bytes2" }, { type: "bytes" },
  ] as const;
  const [receiver, workflowId, workflowName, workflowOwner, reportId, report] = decodeAbiParameters(params, `0x${input.slice(10)}` as Hex);
  return { receiver, workflowId, workflowName, workflowOwner, reportId, report };
}

/** Lower-case hex of: every transaction input and log since `fromBlock`, and every storage value in the Anvil state. */
async function collectChainBytes(fromBlock: bigint): Promise<string> {
  const parts: string[] = [];
  const head = await publicClient.getBlockNumber();
  for (let n = fromBlock; n <= head; n++) {
    const block = await publicClient.getBlock({ blockNumber: n, includeTransactions: true });
    for (const t of block.transactions) parts.push(t.input.slice(2));
  }
  for (const log of await publicClient.getLogs({ fromBlock, toBlock: head })) {
    parts.push(...log.topics.map((t) => t!.slice(2)), log.data.slice(2));
  }
  const dump = (await publicClient.request({ method: "anvil_dumpState" as never })) as Hex;
  const state = JSON.parse(gunzipSync(Buffer.from(dump.slice(2), "hex")).toString("utf8")) as {
    accounts: Record<string, { storage?: Record<string, string> }>;
  };
  for (const account of Object.values(state.accounts)) {
    for (const [slot, value] of Object.entries(account.storage ?? {})) parts.push(slot.replace(/^0x/, ""), value.replace(/^0x/, "").padStart(64, "0"));
  }
  return parts.join("|").toLowerCase();
}
