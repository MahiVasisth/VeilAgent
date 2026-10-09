// Small helpers for the phase exit scripts: PASS/FAIL checks, expected reverts, and a byte dump of everything public
// on the chain for leak scans. (scripts/src/phase2.ts predates this module and keeps its own copies.)
import { gunzipSync } from "node:zlib";
import { BaseError, ContractFunctionRevertedError, type Abi, type Account, type Address, type Hex } from "viem";
import { publicClient, walletFor } from "./env";

export type Call = { address: Address; abi: Abi; functionName: string; args: readonly unknown[] };

const results: { ok: boolean; line: string }[] = [];

export function check(ok: boolean, line: string) {
  results.push({ ok, line });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${line}`);
}

/** Prints the tally; exits 1 if any check failed. */
export function finish(phase: string, passedLine: string) {
  const failures = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failures.length}/${results.length} checks passed.`);
  if (failures.length) {
    console.error(`${phase} EXIT CHECK FAILED:\n  ${failures.map((f) => f.line).join("\n  ")}`);
    process.exit(1);
  }
  console.log(`${phase} EXIT CHECK PASSED: ${passedLine}`);
}

export async function send(from: Account, call: Call) {
  const hash = await walletFor(from).writeContract({ ...call, account: from, chain: undefined } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${call.functionName} reverted: ${hash}`);
  return receipt;
}

/** Simulates `call` from `from` and records whether it reverts with `errorName`. */
export async function expectRevert(label: string, from: Address, call: Call, errorName: string) {
  try {
    await publicClient.simulateContract({ ...call, account: from } as never);
  } catch (e) {
    const revert = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    const got = revert instanceof ContractFunctionRevertedError ? (revert.data?.errorName ?? revert.reason ?? "?") : String(e);
    check(got === errorName, `${label}: reverts ${got}${got === errorName ? "" : ` (expected ${errorName})`}`);
    return;
  }
  check(false, `${label}: expected revert ${errorName}, but the call succeeded`);
}

/** Sets the next block's timestamp and mines it (Anvil). */
export async function warpTo(timestamp: bigint) {
  await publicClient.request({ method: "evm_setNextBlockTimestamp" as never, params: [`0x${timestamp.toString(16)}`] as never });
  await publicClient.request({ method: "evm_mine" as never, params: [] as never });
}

export const chainNow = async () => (await publicClient.getBlock({ blockTag: "latest" })).timestamp;

/** Lower-case hex of: every transaction input and log since `fromBlock`, and every storage slot and value in the
 *  Anvil state. */
export async function collectChainBytes(fromBlock: bigint): Promise<string> {
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
