// Checks that every contract in deployments/<chainId>.json has code on the chain behind RPC_URL (docs/phase0.md T-4:
// forge writes the file even when a broadcast fails), and that the deployment is wired the way Deploy.s.sol intends.
//
//   RPC_URL=https://testnet-rpc.monad.xyz bun scripts/src/check-deployment.ts 10143 [--dir <deployments dir>]
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createPublicClient, http, type Address } from "viem";
import { anonymousFeedbackAbi, nullifierRegistryAbi, privateValidationRegistryAbi, receiptGroupManagerAbi, sealedBidHiringAbi } from "@veil8004/sdk";
import { loadDeployment } from "@veil8004/sdk/deployments";

const { positionals, values } = parseArgs({ allowPositionals: true, options: { dir: { type: "string" } } });
const chainId = Number(positionals[0]);
if (!chainId) {
  console.error("usage: check-deployment.ts <chainId> [--dir <deployments dir>]  (RPC_URL in env)");
  process.exit(2);
}
const rpc = process.env.RPC_URL;
if (!rpc) throw new Error("RPC_URL is required");
const client = createPublicClient({ transport: http(rpc) });
const d = loadDeployment(values.dir ?? join(import.meta.dir, "../../contracts/deployments"), chainId);
let failed = 0;
const check = (ok: boolean, line: string) => {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${line}`);
};

check((await client.getChainId()) === chainId, `RPC is chain ${chainId}`);
const v = d.veil;
const addresses: [string, Address | undefined][] = [
  ["IdentityRegistry", d.identityRegistry],
  ["ReputationRegistry", d.reputationRegistry],
  ["ValidationRegistry", d.validationRegistry],
  [v?.forwarderIsMock ? "MockForwarder" : "CRE forwarder", v?.forwarder],
  ["PolicyRegistry", v?.policyRegistry],
  ["PrivateValidationRegistry", v?.privateValidationRegistry],
  ["TreasuryAction", v?.treasuryAction],
  ["SealedBidHiring", v?.sealedBidHiring],
  ["SemaphoreVerifier", v?.semaphoreVerifier],
  ["Semaphore", v?.semaphore],
  ["NullifierRegistry", v?.nullifierRegistry],
  ["ReceiptGroupManager", v?.receiptGroupManager],
  ["AnonymousFeedback", v?.anonymousFeedback],
];
for (const [name, address] of addresses) {
  const code = address ? await client.getCode({ address }) : undefined;
  check(!!code && code.length > 2, `${name.padEnd(26)} ${address ?? "(missing from the file)"}${code && code.length > 2 ? ` ${(code.length - 2) / 2} bytes` : " NO CODE"}`);
}
if (v?.sealedBidHiring && v.receiptGroupManager && v.anonymousFeedback && v.nullifierRegistry) {
  const read = <T>(address: Address, abi: readonly unknown[], functionName: string, args: unknown[] = []) =>
    client.readContract({ address, abi: abi as never, functionName, args } as never) as Promise<T>;
  check((await read<Address>(v.privateValidationRegistry, privateValidationRegistryAbi, "getForwarderAddress")).toLowerCase() === v.forwarder.toLowerCase(), "PrivateValidationRegistry accepts reports from the forwarder above");
  check((await read<Address>(v.sealedBidHiring, sealedBidHiringAbi, "getForwarderAddress")).toLowerCase() === v.forwarder.toLowerCase(), "SealedBidHiring accepts reports from the forwarder above");
  check((await read<Address>(v.receiptGroupManager, receiptGroupManagerAbi, "getForwarderAddress")).toLowerCase() === v.forwarder.toLowerCase(), "ReceiptGroupManager accepts reports from the forwarder above");
  check(await read<boolean>(v.nullifierRegistry, nullifierRegistryAbi, "isConsumer", [v.anonymousFeedback]), "NullifierRegistry allow-lists AnonymousFeedback");
  check((await read<Address>(v.anonymousFeedback, anonymousFeedbackAbi, "receipts")).toLowerCase() === v.receiptGroupManager.toLowerCase(), "AnonymousFeedback reads ReceiptGroupManager");
  for (const [name, id] of [["W1", v.w1WorkflowId], ["W3", v.w3WorkflowId], ["W2", v.w2WorkflowId]] as const)
    if (!id || /^0x0+$/.test(id)) console.log(`  NOTE  ${name} workflow id not pinned yet: after \`cre workflow deploy\`, call setExpectedWorkflowId on its consumer`);
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\ndeployment checked: every contract has code and is wired as Deploy.s.sol intends");
process.exit(failed ? 1 : 0);
