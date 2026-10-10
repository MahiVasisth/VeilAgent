// Rater (Phase 5, Flow D): the client's side of anonymous feedback.
//
//   bun scripts/src/rater.ts identity --out <file>
//   bun scripts/src/rater.ts rate --task <id> --score <1-5> --identity <file> [--agent <id>] [--from <anvil index>]
//
// `identity` makes a Semaphore identity and writes its private key to <file> (mode 600). Only its commitment ever goes
// on-chain, as postTask's identityCommitment. `rate` finds the task's receipt (ReceiptIssued), rebuilds the receipt group
// from public Semaphore events, proves membership offline with message = score and scope = (agentId, epoch), and submits
// to AnonymousFeedback. By default the rating is sent from a fresh wallet funded by the Anvil deployer, so the
// transaction is not signed by the client's own address (claims table: linking through the rating transaction is
// mitigated by a relayer or fresh wallet). `--agent` rates another agent in the same group (default: the task's winner).
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseEther, type Account, type Address, type Hex } from "viem";
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { anonymousFeedbackAbi, receiptGroupManagerAbi } from "@veil8004/sdk";
import { feedbackScope, fetchGroup, Identity, proveMembership, toSolidityProof } from "@veil8004/sdk/semaphore";
import { local, publicClient, roles, walletFor } from "./env";

export type Receipt = { taskId: bigint; category: Hex; epoch: bigint; groupId: bigint; agentId: bigint };

function veil() {
  const { deployment } = local();
  const v = deployment.veil;
  if (!v?.receiptGroupManager || !v.anonymousFeedback || !v.semaphore) throw new Error("no Phase 5 contracts in the deployment file; re-run Deploy.s.sol");
  return { receipts: v.receiptGroupManager, feedback: v.anonymousFeedback, semaphore: v.semaphore, startBlock: BigInt(deployment.startBlock) };
}

/** The receipt W2 issued for `taskId`, from the public ReceiptIssued event. Null if none yet. */
export async function receiptOf(taskId: bigint): Promise<Receipt | null> {
  const { receipts, startBlock } = veil();
  const [e] = await publicClient.getContractEvents({ address: receipts, abi: receiptGroupManagerAbi, eventName: "ReceiptIssued", args: { taskId }, fromBlock: startBlock });
  if (!e) return null;
  const { category, epoch, groupId, agentId } = e.args;
  return { taskId, category: category!, epoch: BigInt(epoch!), groupId: groupId!, agentId: agentId! };
}

/** Builds the proof for one rating. Proving is local and offline; nothing here touches the client's wallet. */
export async function buildRating(identity: Identity, receipt: Receipt, agentId: bigint, score: bigint) {
  const { semaphore, startBlock } = veil();
  const group = await fetchGroup(publicClient, semaphore, receipt.groupId, startBlock);
  const proof = toSolidityProof(await proveMembership(identity, group, score, feedbackScope(agentId, receipt.epoch)));
  return { proof, anonymitySet: group.size };
}

export const submitCall = (agentId: bigint, receipt: Receipt, proof: ReturnType<typeof toSolidityProof>) => ({
  address: veil().feedback,
  abi: anonymousFeedbackAbi,
  functionName: "submit" as const,
  args: [agentId, receipt.category, receipt.epoch, proof] as const,
});

/** A new key with a little ETH from the Anvil deployer: a stand-in for a relayer. Local demo only. */
export async function freshWallet(): Promise<Account> {
  const account = privateKeyToAccount(generatePrivateKey());
  const hash = await walletFor(roles.deployer).sendTransaction({ to: account.address, value: parseEther("1"), account: roles.deployer, chain: undefined });
  await publicClient.waitForTransactionReceipt({ hash });
  return account;
}

/** Proves and submits one rating from `sender`. */
export async function rate(p: { identity: Identity; receipt: Receipt; agentId?: bigint; score: bigint; sender: Account }) {
  const agentId = p.agentId ?? p.receipt.agentId;
  const { proof, anonymitySet } = await buildRating(p.identity, p.receipt, agentId, p.score);
  const hash = await walletFor(p.sender).writeContract({ ...submitCall(agentId, p.receipt, proof), account: p.sender, chain: undefined });
  const tx = await publicClient.waitForTransactionReceipt({ hash });
  if (tx.status !== "success") throw new Error(`submit reverted: ${hash}`);
  return { tx, proof, anonymitySet, agentId };
}

// ---- CLI ----------------------------------------------------------------------------------------
if (import.meta.main) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string" },
      identity: { type: "string" },
      task: { type: "string" },
      score: { type: "string" },
      agent: { type: "string" },
      from: { type: "string" },
    },
  });
  const [cmd] = positionals;
  const need = (v: string | undefined, name: string) => {
    if (v === undefined) throw new Error(`--${name} is required`);
    return v;
  };

  if (cmd === "identity") {
    const identity = new Identity();
    writeFileSync(need(values.out, "out"), identity.export() + "\n", { mode: 0o600 });
    console.log(`identity written to ${values.out} (keep it private). Pass this commitment to postTask:\n${identity.commitment}`);
  } else if (cmd === "rate") {
    const identity = Identity.import(readFileSync(need(values.identity, "identity"), "utf8").trim());
    const taskId = BigInt(need(values.task, "task"));
    const receipt = await receiptOf(taskId);
    if (!receipt) throw new Error(`no receipt for task ${taskId} yet (W2 issues it after JobCompleted)`);
    const sender = values.from
      ? mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: Number(values.from) })
      : await freshWallet();
    const r = await rate({ identity, receipt, agentId: values.agent ? BigInt(values.agent) : undefined, score: BigInt(need(values.score, "score")), sender });
    console.log(
      `rated agent #${r.agentId} ${values.score}/5 for epoch ${receipt.epoch} as one of ${r.anonymitySet} receipt holders ` +
        `(sender ${sender.address as Address}, nullifier ${r.proof.nullifier}, tx ${r.tx.transactionHash})`,
    );
  } else {
    console.error("usage: rater.ts identity --out <file> | rate --task <id> --score <1-5> --identity <file> [--agent <id>] [--from <i>]");
    process.exit(2);
  }
  process.exit(0); // snarkjs may leave handles open
}
