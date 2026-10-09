// Phase 4 exit criterion, against a live Anvil with the sealed store, the mock screening API and the local runner
// (a SIMULATION of the CRE DON) running. Started by scripts/phase4.sh.
//   An auditor verifies one validation from a disclosure bundle and learns nothing about any other:
//   1. four private validations are recorded (pass, fail, a client's pass, and one left pending);
//   2. the requester of one exports a bundle; the auditor CLI verifies it, reading only;
//   3. tampered bundles (input, salt, agent, policy, chain, registry) and the opening pointed at another request fail;
//   4. a dictionary attack with the disclosed salt opens no other commitment, the bundle holds no other secret, and no
//      input or salt (not even the disclosed one) is on-chain; the audit sent no transaction.
// Env: W1_PUBLIC_KEY, SEALED_STORE_URL, DISCLOSURE_DIR (where the bundle is written for phase4.sh's page check).
// Entity names are fictional demo data.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEventLogs, stringToHex, type Abi, type Account, type Hex } from "viem";
import {
  bundleToJson,
  exportBundle,
  inputCommitment,
  inputHash,
  policyId,
  privateValidationRegistryAbi,
  putPayload,
  randomSalt,
  sealFor,
  type DisclosureBundle,
} from "@veil8004/sdk";
import { audit, formatReport } from "./auditor";
import { check, collectChainBytes, finish, send } from "./checks";
import { local, publicClient, roles } from "./env";

const SANCTIONS = policyId("SANCTIONS_SCREEN_V1");
const QUALIFIED = policyId("QUALIFIED_SCREENER_V1");
const STATUS = ["None", "Pending", "Passed", "Failed"] as const;
const STORE = process.env.SEALED_STORE_URL ?? "http://127.0.0.1:8787";
const W1_PUBLIC_KEY = need("W1_PUBLIC_KEY");
const OUT = process.env.DISCLOSURE_DIR ?? mkdtempSync(join(tmpdir(), "veil-disclosure-"));
// Every counterparty name the demo uses, plus a few plausible guesses: the auditor's dictionary.
const DICTIONARY = [
  "Northwind Trading LLC", "Kestrel Shipping Co", "Harbor Light Ventures", "Orrin Maritime SA",
  "Blackfin Holdings Ltd", "Northwind Trading", "Harbor Light", "Acme Corp",
];

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

const { deployment: d, agents } = local();
if (!d.veil) throw new Error("no Phase 2 contracts in the deployment file; run Deploy.s.sol");
const registry = d.veil.privateValidationRegistry;
const agentIds = agents.agentIds.map(BigInt);
const [atlas, borealis, cirrus] = agentIds as [bigint, bigint, bigint];

type Made = { requestId: Hex; commitment: Hex; agentId: bigint; input: string; salt: Hex };
/** Client side of Flow A: commit, request, then (unless told not to) seal {input, salt} to W1 under the requestId. */
async function requestPrivate(who: Account, agentId: bigint, input: string, upload = true): Promise<Made> {
  const salt = randomSalt();
  const commitment = inputCommitment({ agentId, policyId: SANCTIONS, input, salt });
  const receipt = await send(who, { address: registry, abi: privateValidationRegistryAbi as Abi, functionName: "requestPrivate", args: [agentId, SANCTIONS, commitment] });
  const [event] = parseEventLogs({ abi: privateValidationRegistryAbi, eventName: "PrivateValidationRequested", logs: receipt.logs });
  const requestId = event!.args.requestId;
  if (upload) await putPayload(STORE, requestId, sealFor(W1_PUBLIC_KEY, { input, salt }));
  return { requestId, commitment, agentId, input, salt };
}

async function waitForResult(requestId: Hex, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const r = await publicClient.readContract({ address: registry, abi: privateValidationRegistryAbi, functionName: "getRequest", args: [requestId] });
    const status = STATUS[r.status]!;
    if (status !== "Pending" || Date.now() > end) return status;
    await Bun.sleep(200);
  }
}

// -----------------------------------------------------------------------------------------------------------------
const phase4Start = await publicClient.getBlockNumber();
const operator = roles.treasuryOperator;
console.log(`Phase 4 on Anvil. Registry ${registry}; W1 results via the local runner (SIMULATED DON).`);

console.log("\n[1] four private validations");
const disclosed = await requestPrivate(operator, atlas, "Northwind Trading LLC");
const failed = await requestPrivate(operator, borealis, "Kestrel Shipping Co");
const clients = await requestPrivate(roles.clients[0]!, cirrus, "Harbor Light Ventures");
const pending = await requestPrivate(operator, borealis, "Orrin Maritime SA", false);
check((await waitForResult(disclosed.requestId)) === "Passed", "operator's request for Atlas passed (to be disclosed)");
check((await waitForResult(failed.requestId)) === "Failed", "operator's request for Borealis failed (stays sealed)");
check((await waitForResult(clients.requestId)) === "Passed", "a client's request for Cirrus passed (stays sealed)");
check((await waitForResult(pending.requestId, 0)) === "Pending", "operator's request with no payload is pending (stays sealed)");
const others = [failed, clients, pending];

console.log("\n[2] the requester exports a bundle for one request");
await exportBundle(publicClient, { registry, requestId: disclosed.requestId, input: disclosed.input, salt: randomSalt() }).then(
  () => check(false, "export with the wrong salt should be refused"),
  (e: Error) => check(/do not open/.test(e.message), `export with the wrong salt is refused before anything is handed over (${e.message})`),
);
const bundle = await exportBundle(publicClient, { registry, requestId: disclosed.requestId, input: disclosed.input, salt: disclosed.salt });
const bundlePath = join(OUT, "bundle.json");
writeFileSync(bundlePath, bundleToJson(bundle), { mode: 0o600 });
const tamperedPath = join(OUT, "bundle-tampered.json");
writeFileSync(tamperedPath, bundleToJson({ ...bundle, input: "Kestrel Shipping Co" }), { mode: 0o600 });
check(bundle.agentId === atlas.toString() && bundle.policyId === SANCTIONS && bundle.chainId === 31337, "bundle carries chain, registry, request, agent, policy, input and salt");
console.log(`  bundle written to ${bundlePath} (holds a secret salt; handed to the auditor only)`);

console.log("\n[3] the auditor verifies it (auditor CLI, eth_call only)");
const auditStart = await publicClient.getBlockNumber();
const cli = Bun.spawnSync(["bun", join(import.meta.dir, "auditor.ts"), bundlePath], { env: process.env });
const out = cli.stdout.toString();
console.log(out.trimEnd().split("\n").map((l) => `  | ${l}`).join("\n"));
check(cli.exitCode === 0 && out.includes("VERIFIED: the bundle opens"), "auditor CLI exits 0: VERIFIED");
check(out.includes('"Northwind Trading LLC"') && /result\s+pass \(tier Don/.test(out), "the auditor learns the input and the recorded pass, tier and expiry");
const tamperedCli = Bun.spawnSync(["bun", join(import.meta.dir, "auditor.ts"), tamperedPath], { env: process.env });
check(tamperedCli.exitCode === 1 && tamperedCli.stdout.toString().includes("NOT VERIFIED"), "auditor CLI exits 1 on a bundle with a swapped input");
const report = await audit(bundle);
check(report.valid && report.request?.currentlyValid === true, "verifyBundle (in process) agrees, and verifyResult is true now");

console.log("\n[4] tampered bundles fail the right check");
const tampers: [string, Partial<DisclosureBundle>, string][] = [
  ["another input", { input: "Kestrel Shipping Co" }, "commitment"],
  ["another salt", { salt: randomSalt() }, "commitment"],
  ["another agent", { agentId: borealis.toString() }, "agent"],
  ["another policy", { policyId: QUALIFIED }, "policy"],
  ["another chain", { chainId: 10143 }, "chain"],
  ["a look-alike registry", { registry: d.veil.treasuryAction }, "registry"],
];
for (const [label, change, name] of tampers) {
  const r = await audit({ ...bundle, ...change });
  const bad = r.checks.filter((c) => !c.ok).map((c) => c.name);
  check(!r.valid && bad.includes(name) && r.request === null, `${label}: not verified (${bad.join(", ")}), nothing revealed`);
}

console.log("\n[5] the bundle opens nothing else");
for (const o of others) {
  const r = await audit({ ...bundle, requestId: o.requestId, agentId: o.agentId.toString() });
  check(!r.valid && r.checks.find((c) => c.name === "commitment")?.ok === false, `the disclosed opening pointed at request ${o.requestId.slice(0, 10)}…: commitment does not match`);
}
const bundleText = bundleToJson(bundle).toLowerCase();
const inBundle = others.filter((o) => bundleText.includes(o.salt.slice(2)) || bundleText.includes(o.input.toLowerCase()));
check(inBundle.length === 0, "the bundle contains no other request's input or salt");
// The auditor's best attack on the others: every on-chain commitment, every agent, the dictionary, the disclosed salt.
const onChain = (await publicClient.getContractEvents({ address: registry, abi: privateValidationRegistryAbi, eventName: "PrivateValidationRequested", fromBlock: BigInt(d.startBlock) }))
  .filter((l) => l.args.requestId !== disclosed.requestId)
  .map((l) => l.args.commitment!.toLowerCase());
let tries = 0;
const opened: string[] = [];
for (const agentId of agentIds) for (const p of [SANCTIONS, QUALIFIED]) for (const input of DICTIONARY) {
  tries++;
  if (onChain.includes(inputCommitment({ agentId, policyId: p, input, salt: bundle.salt }).toLowerCase())) opened.push(input);
}
check(DICTIONARY.includes(failed.input) && DICTIONARY.includes(clients.input) && DICTIONARY.includes(pending.input), "the dictionary contains every other request's real input");
check(opened.length === 0, `dictionary attack with the disclosed salt: ${tries} guesses against ${onChain.length} other commitments, none opened`);
const withRealSalt = others.filter((o) => onChain.includes(inputCommitment({ agentId: o.agentId, policyId: SANCTIONS, input: o.input, salt: o.salt }).toLowerCase()));
check(withRealSalt.length === others.length, "control: with each request's own salt (which the auditor does not have) the same guesses would open them");

console.log("\n[6] nothing went on-chain");
check((await publicClient.getBlockNumber()) === auditStart, "the audit sent no transaction (block number unchanged)");
const haystack = await collectChainBytes(phase4Start);
const secrets = [disclosed, ...others].flatMap((m) => [
  { label: `input "${m.input}"`, hex: stringToHex(m.input) },
  { label: `salt of "${m.input}"`, hex: m.salt },
  { label: `unsalted hash of "${m.input}"`, hex: inputHash(m.input) },
]);
const found = secrets.filter((s) => haystack.includes(s.hex.slice(2).toLowerCase()));
check(found.length === 0, `${secrets.length} secrets (including the disclosed request's) absent from Phase 4 calldata, logs and the full Anvil state` + (found.length ? `; LEAKED: ${found.map((s) => s.label).join(", ")}` : ""));
check(haystack.includes(disclosed.commitment.slice(2).toLowerCase()), "the scan does see the commitments (the scanner works)");

console.log(`\nauditor's report, for the record:\n${formatReport(report).split("\n").map((l) => `  ${l}`).join("\n")}`);
finish("PHASE 4", "an auditor verified one validation and learned nothing about any other.");
