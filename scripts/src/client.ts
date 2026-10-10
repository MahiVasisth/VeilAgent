// Client (docs/SPEC.md "Scripts"): request a private validation, post a task, mark it completed, and export a
// disclosure bundle. Ratings are in rater.ts (`client.ts rate` forwards there). Local Anvil demo accounts only.
//
//   bun scripts/src/client.ts request  --agent <id> --policy <NAME> --input <text> --opening <file> [--from <anvil index>]
//   bun scripts/src/client.ts disclose --opening <file> > bundle.json
//   bun scripts/src/client.ts post     --policy <NAME> --category <name> [--minutes 10] [--identity <file>] [--from <i>]
//   bun scripts/src/client.ts complete --task <id> [--from <i>]
//   bun scripts/src/client.ts rate     ...   (same flags as rater.ts rate)
//
// `request` commits to the input, calls requestPrivate, seals {input, salt} to W1_PUBLIC_KEY and uploads it under the
// requestId. The opening (requestId, input, salt) goes to --opening (mode 600). Keep that file: it is the only way to
// disclose this request later, and it is a secret. `post` takes the Semaphore identity commitment from --identity
// (made by `rater.ts identity`); without it, the job gets no receipt (docs/phase0.md P5-5).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { keccak256, parseEventLogs, stringToBytes, type Abi, type Address, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import {
  bundleToJson,
  exportBundle,
  inputCommitment,
  policyId,
  privateValidationRegistryAbi,
  putPayload,
  randomSalt,
  sealedBidHiringAbi,
  sealFor,
} from "@veil8004/sdk";
import { Identity } from "@veil8004/sdk/semaphore";
import { chainNow, send } from "./checks";
import { local, publicClient, roles } from "./env";

type Opening = { registry: Address; requestId: Hex; input: string; salt: Hex };

const accountAt = (i: string | undefined, fallback = roles.clients[0]!) =>
  i === undefined ? fallback : mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: Number(i) });

function veil() {
  const v = local().deployment.veil;
  if (!v) throw new Error("no Veil8004 contracts in the deployment file; run Deploy.s.sol");
  return v;
}

export async function requestValidation(p: { agentId: bigint; policy: string; input: string; from?: string }): Promise<Opening> {
  const w1 = process.env.W1_PUBLIC_KEY;
  if (!w1) throw new Error("W1_PUBLIC_KEY is required");
  const registry = veil().privateValidationRegistry;
  const salt = randomSalt();
  const policy = policyId(p.policy);
  const commitment = inputCommitment({ agentId: p.agentId, policyId: policy, input: p.input, salt });
  const receipt = await send(accountAt(p.from), { address: registry, abi: privateValidationRegistryAbi as Abi, functionName: "requestPrivate", args: [p.agentId, policy, commitment] });
  const requestId = parseEventLogs({ abi: privateValidationRegistryAbi, eventName: "PrivateValidationRequested", logs: receipt.logs })[0]!.args.requestId;
  await putPayload(process.env.SEALED_STORE_URL ?? "http://127.0.0.1:8787", requestId, sealFor(w1, { input: p.input, salt }));
  return { registry, requestId, input: p.input, salt };
}

if (import.meta.main) {
  const [cmd] = process.argv.slice(2);
  if (cmd === "rate") {
    const r = Bun.spawnSync(["bun", join(import.meta.dir, "rater.ts"), ...process.argv.slice(2)], { stdio: ["inherit", "inherit", "inherit"] });
    process.exit(r.exitCode);
  }
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      agent: { type: "string" },
      policy: { type: "string" },
      input: { type: "string" },
      opening: { type: "string" },
      category: { type: "string" },
      minutes: { type: "string", default: "10" },
      identity: { type: "string" },
      task: { type: "string" },
      from: { type: "string" },
    },
  });
  const need = (v: string | undefined, name: string) => {
    if (v === undefined) throw new Error(`--${name} is required`);
    return v;
  };

  if (cmd === "request") {
    const out = need(values.opening, "opening");
    const o = await requestValidation({ agentId: BigInt(need(values.agent, "agent")), policy: need(values.policy, "policy"), input: need(values.input, "input"), from: values.from });
    writeFileSync(out, JSON.stringify(o, null, 2) + "\n", { mode: 0o600 });
    console.log(`requested ${o.requestId}; sealed opening uploaded for W1. Your opening (secret) is in ${out}.`);
  } else if (cmd === "disclose") {
    const o = JSON.parse(readFileSync(need(values.opening, "opening"), "utf8")) as Opening;
    console.log(bundleToJson(await exportBundle(publicClient, o)));
  } else if (cmd === "post") {
    const hiring = veil().sealedBidHiring;
    if (!hiring) throw new Error("no SealedBidHiring in the deployment file");
    const commitment = values.identity ? Identity.import(readFileSync(values.identity, "utf8").trim()).commitment : 0n;
    const deadline = (await chainNow()) + BigInt(Number(values.minutes) * 60);
    const category = keccak256(stringToBytes(need(values.category, "category")));
    const r = await send(accountAt(values.from), { address: hiring, abi: sealedBidHiringAbi as Abi, functionName: "postTask", args: [policyId(need(values.policy, "policy")), category, deadline, commitment] });
    const taskId = parseEventLogs({ abi: sealedBidHiringAbi, eventName: "TaskPosted", logs: r.logs })[0]!.args.taskId;
    console.log(`posted task ${taskId}, bidding open until ${new Date(Number(deadline) * 1000).toISOString()}${commitment ? "" : " (no identity: this job will get no receipt)"}`);
  } else if (cmd === "complete") {
    const hiring = veil().sealedBidHiring!;
    const taskId = BigInt(need(values.task, "task"));
    await send(accountAt(values.from), { address: hiring, abi: sealedBidHiringAbi as Abi, functionName: "markCompleted", args: [taskId] });
    console.log(`task ${taskId} marked completed; W2 issues the receipt if the task carries an identity commitment`);
  } else {
    console.error(
      "usage: client.ts request --agent <id> --policy <NAME> --input <text> --opening <file> [--from <i>]\n" +
        "       client.ts disclose --opening <file>\n" +
        "       client.ts post --policy <NAME> --category <name> [--minutes 10] [--identity <file>] [--from <i>]\n" +
        "       client.ts complete --task <id> [--from <i>]\n" +
        "       client.ts rate --task <id> --score <1-5> --identity <file>",
    );
    process.exit(2);
  }
}
