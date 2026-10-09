// W3 Bid opener: CRE wiring. Thin on purpose: every decision lives in cre/handlers/bidOpener.ts (unit-tested and shared
// with the local runner). Trigger: BiddingClosed on SealedBidHiring. Output: one report to it.
//
// NOT YET RUN on a DON: the CRE CLI is not installed on the build machine (docs/phase0.md Q1/Q9). Typechecked against
// @chainlink/cre-sdk 1.23.0 and compiled with cre-compile only. Before relying on it: `cre workflow simulate`.
import {
  bytesToHex,
  consensusIdenticalAggregation,
  cre,
  encodeCallMsg,
  getNetwork,
  LATEST_BLOCK_NUMBER,
  logTriggerConfig,
  ok,
  prepareReportRequest,
  Runner,
  text,
  type EVMLog,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";
import { decodeFunctionResult, encodeFunctionData, toEventSelector, type Address, type Hex } from "viem";
import { sealedBidHiringAbi } from "@veil8004/sdk/abi/veil";
import { decideAward, decodeBiddingClosed, openBids, sealedKeyOf, type OnChainBid } from "../../handlers/bidOpener";

type Config = {
  chainSelectorName: string; // "monad-testnet"
  isTestnet: boolean;
  sealedBidHiring: Address;
  sealedStoreUrl: string;
  gasLimit: string;
};

const CLOSED = toEventSelector("BiddingClosed(uint256,uint256)");

function evmClient(config: Config) {
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: config.chainSelectorName, isTestnet: config.isTestnet });
  if (!network) throw new Error(`unknown chain ${config.chainSelectorName}`);
  return new cre.capabilities.EVMClient(network.chainSelector.selector);
}

/** Node mode: each node GETs every sealed bid; the DON agrees on identical bytes. "" means not uploaded. */
const fetchSealedBids = (send: HTTPSendRequester, baseUrl: string, keys: string[], token: string): string =>
  JSON.stringify(
    keys.map((key) => {
      const res = send
        .sendRequest({ url: `${baseUrl}/v1/payload/${encodeURIComponent(key)}`, method: "GET", multiHeaders: { authorization: { values: [`Bearer ${token}`] } } })
        .result();
      if (res.statusCode === 404) return "";
      if (!ok(res)) throw new Error(`sealed store ${res.statusCode}`);
      return text(res);
    }),
  );

const onClosed = (runtime: Runtime<Config>, log: EVMLog): string => {
  const config = runtime.config;
  const event = decodeBiddingClosed({ topics: log.topics.map((t) => bytesToHex(t) as Hex), data: bytesToHex(log.data) as Hex });
  const evm = evmClient(config);

  const call = evm
    .callContract(runtime, {
      call: encodeCallMsg({
        from: "0x0000000000000000000000000000000000000000",
        to: config.sealedBidHiring,
        data: encodeFunctionData({ abi: sealedBidHiringAbi, functionName: "getBids", args: [event.taskId] }),
      }),
      blockNumber: LATEST_BLOCK_NUMBER,
    })
    .result();
  const bids: OnChainBid[] = decodeFunctionResult({ abi: sealedBidHiringAbi, functionName: "getBids", data: bytesToHex(call.data) as Hex }).map(
    (b) => ({ agentId: b.agentId, commitment: b.commitment }),
  );
  if (BigInt(bids.length) !== event.bidCount) throw new Error(`task ${event.taskId}: bid count differs from the event`);

  // CRE secrets. In a standard workflow the nodes can read these and every opened bid (claims table).
  const decryptKey = runtime.getSecret({ id: "W3_DECRYPT_KEY" }).result().value;
  const storeToken = runtime.getSecret({ id: "SEALED_STORE_W3_TOKEN" }).result().value;
  const fetched = new cre.capabilities.HTTPClient()
    .sendRequest(runtime, fetchSealedBids, consensusIdenticalAggregation<string>())(
      config.sealedStoreUrl,
      bids.map(sealedKeyOf),
      storeToken,
    )
    .result();
  const sealed = (JSON.parse(fetched) as string[]).map((s) => (s === "" ? null : s));

  const { counted, dropped } = openBids(event.taskId, bids, sealed, decryptKey);
  const { report, decoded } = decideAward(event.taskId, counted);

  const signed = runtime.report(prepareReportRequest(report)).result();
  const reply = evm
    .writeReport(runtime, { receiver: config.sealedBidHiring, report: signed, gasConfig: { gasLimit: config.gasLimit } })
    .result();
  // Log only what the report makes public, plus the dropped count. Never a losing price.
  runtime.log(
    `task ${event.taskId}: ${decoded.validBidCount} counted, ${dropped.length} dropped, winner #${decoded.winnerAgentId}, tx status ${reply.txStatus}`,
  );
  return decoded.validBidCount === 0 ? "no award" : `awarded #${decoded.winnerAgentId}`;
};

const initWorkflow = (config: Config) => [
  cre.handler(
    evmClient(config).logTrigger(logTriggerConfig({ addresses: [config.sealedBidHiring], topics: [[CLOSED]], confidence: "SAFE" })),
    onClosed,
  ),
];

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}

main();
