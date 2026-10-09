// W2 Receipt issuer: CRE wiring. Thin on purpose: every decision lives in cre/handlers/receiptIssuer.ts (unit-tested and
// shared with the local runner). Trigger: JobCompleted on SealedBidHiring. Output: one report to ReceiptGroupManager.
//
// NOT YET RUN on a DON: the CRE CLI is not installed on the build machine (docs/phase0.md Q1/Q9). Typechecked against
// @chainlink/cre-sdk 1.23.0 and compiled with cre-compile only. Before relying on it: `cre workflow simulate`.
import {
  bytesToHex,
  cre,
  encodeCallMsg,
  getNetwork,
  LATEST_BLOCK_NUMBER,
  logTriggerConfig,
  prepareReportRequest,
  Runner,
  type EVMLog,
  type Runtime,
} from "@chainlink/cre-sdk";
import { decodeFunctionResult, encodeFunctionData, toEventSelector, type Address, type Hex } from "viem";
import { receiptGroupManagerAbi, sealedBidHiringAbi } from "@veil8004/sdk/abi/veil";
import { checkTask, decodeJobCompleted, encodeReceiptReport } from "../../handlers/receiptIssuer";

type Config = {
  chainSelectorName: string; // "monad-testnet"
  isTestnet: boolean;
  sealedBidHiring: Address;
  receiptGroupManager: Address;
  gasLimit: string;
};

const COMPLETED = toEventSelector("JobCompleted(uint256,uint256,bytes32,uint256)");
const ZERO = "0x0000000000000000000000000000000000000000";

function evmClient(config: Config) {
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: config.chainSelectorName, isTestnet: config.isTestnet });
  if (!network) throw new Error(`unknown chain ${config.chainSelectorName}`);
  return new cre.capabilities.EVMClient(network.chainSelector.selector);
}

const onCompleted = (runtime: Runtime<Config>, log: EVMLog): string => {
  const config = runtime.config;
  const event = decodeJobCompleted({ topics: log.topics.map((t) => bytesToHex(t) as Hex), data: bytesToHex(log.data) as Hex });
  const evm = evmClient(config);
  const read = (to: Address, data: Hex) =>
    bytesToHex(evm.callContract(runtime, { call: encodeCallMsg({ from: ZERO, to, data }), blockNumber: LATEST_BLOCK_NUMBER }).result().data) as Hex;

  // Read the task back rather than trusting the log, as ReceiptGroupManager does.
  const task = decodeFunctionResult({
    abi: sealedBidHiringAbi,
    functionName: "getTask",
    data: read(config.sealedBidHiring, encodeFunctionData({ abi: sealedBidHiringAbi, functionName: "getTask", args: [event.taskId] })),
  });
  const issued = decodeFunctionResult({
    abi: receiptGroupManagerAbi,
    functionName: "receiptIssued",
    data: read(config.receiptGroupManager, encodeFunctionData({ abi: receiptGroupManagerAbi, functionName: "receiptIssued", args: [event.taskId] })),
  });
  const reason = checkTask(event.taskId, task, issued);
  if (reason !== null) {
    runtime.log(reason);
    return "no receipt";
  }

  const signed = runtime.report(prepareReportRequest(encodeReceiptReport(event.taskId))).result();
  const reply = evm
    .writeReport(runtime, { receiver: config.receiptGroupManager, report: signed, gasConfig: { gasLimit: config.gasLimit } })
    .result();
  runtime.log(`task ${event.taskId}: receipt report sent, tx status ${reply.txStatus}`);
  return `receipt for task ${event.taskId}`;
};

const initWorkflow = (config: Config) => [
  cre.handler(
    evmClient(config).logTrigger(logTriggerConfig({ addresses: [config.sealedBidHiring], topics: [[COMPLETED]], confidence: "SAFE" })),
    onCompleted,
  ),
];

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}

main();
