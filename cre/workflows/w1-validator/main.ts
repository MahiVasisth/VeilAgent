// W1 Validator: CRE wiring. Thin on purpose: every decision lives in cre/handlers/validator.ts (unit-tested and shared
// with the local runner). Trigger: PrivateValidationRequested on PrivateValidationRegistry. Output: one report to it.
//
// NOT YET RUN on a DON: the CRE CLI is not installed on the build machine (docs/phase0.md Q1/Q9). Typechecked against
// @chainlink/cre-sdk 1.23.0 only. Before relying on it: `cre workflow simulate` (see README.md here).
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
import { policyRegistryAbi } from "@veil8004/sdk/abi/veil";
import { decodeValidationRequested, finishValidation, prepareValidation, Tier } from "../../handlers/validator";

type Config = {
  chainSelectorName: string; // "monad-testnet"
  isTestnet: boolean;
  privateValidationRegistry: Address;
  policyRegistry: Address;
  sealedStoreUrl: string;
  screeningUrl: string;
  /** True only when deployed as a Confidential Workflow; then W1 reports Tier.TeeDon. */
  confidentialWorkflow: boolean;
  gasLimit: string;
};

const REQUESTED = toEventSelector("PrivateValidationRequested(bytes32,uint256,bytes32,bytes32)");

function evmClient(config: Config) {
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: config.chainSelectorName, isTestnet: config.isTestnet });
  if (!network) throw new Error(`unknown chain ${config.chainSelectorName}`);
  return new cre.capabilities.EVMClient(network.chainSelector.selector);
}

/** Node mode: each node GETs the sealed payload; the DON agrees on identical bytes. "" means not uploaded. */
const fetchSealed = (send: HTTPSendRequester, url: string, token: string): string => {
  const res = send.sendRequest({ url, method: "GET", multiHeaders: { authorization: { values: [`Bearer ${token}`] } } }).result();
  if (res.statusCode === 404) return "";
  if (!ok(res)) throw new Error(`sealed store ${res.statusCode}`);
  return text(res);
};

const onRequested = (runtime: Runtime<Config>, log: EVMLog): string => {
  const config = runtime.config;
  const request = decodeValidationRequested({ topics: log.topics.map((t) => bytesToHex(t) as Hex), data: bytesToHex(log.data) as Hex });

  // CRE secrets. In a standard workflow the nodes can read these and the decrypted payload (claims table).
  const decryptKey = runtime.getSecret({ id: "W1_DECRYPT_KEY" }).result().value;
  const storeToken = runtime.getSecret({ id: "SEALED_STORE_W1_TOKEN" }).result().value;

  const sealed = new cre.capabilities.HTTPClient()
    .sendRequest(runtime, fetchSealed, consensusIdenticalAggregation<string>())(
      `${config.sealedStoreUrl}/v1/payload/${request.requestId}`,
      storeToken,
    )
    .result();

  const prepared = prepareValidation(request, sealed === "" ? null : sealed, decryptKey);
  if (prepared.stop) {
    runtime.log(`request ${request.requestId}: stopped, no report (${prepared.reason})`);
    return `stopped: ${prepared.reason}`;
  }

  // Confidential HTTP: the API key is injected inside the enclave from the vault and never enters handler code.
  // The template syntax below follows the CRE docs; confirm it with `cre workflow simulate` (docs/phase0.md).
  const screeningRes = new cre.capabilities.ConfidentialHTTPClient()
    .sendRequest(runtime, {
      vaultDonSecrets: [{ key: "SCREENING_API_KEY" }],
      request: {
        url: `${config.screeningUrl}/screen`,
        method: "POST",
        bodyString: JSON.stringify({ subject: prepared.subject }),
        multiHeaders: {
          "content-type": { values: ["application/json"] },
          "x-api-key": { values: ["{{.SCREENING_API_KEY}}"] },
        },
      },
    })
    .result();
  if (!ok(screeningRes)) throw new Error(`screening API ${screeningRes.statusCode}`);
  const screening = JSON.parse(text(screeningRes)) as { hit: boolean };

  const evm = evmClient(config);
  const call = evm
    .callContract(runtime, {
      call: encodeCallMsg({
        from: "0x0000000000000000000000000000000000000000",
        to: config.policyRegistry,
        data: encodeFunctionData({ abi: policyRegistryAbi, functionName: "getPolicy", args: [request.policyId] }),
      }),
      blockNumber: LATEST_BLOCK_NUMBER,
    })
    .result();
  const policy = decodeFunctionResult({ abi: policyRegistryAbi, functionName: "getPolicy", data: bytesToHex(call.data) as Hex });

  const now = BigInt(Math.floor(runtime.now().getTime() / 1000));
  const { report, decoded } = finishValidation(
    prepared,
    screening,
    now,
    policy.validityWindow,
    config.confidentialWorkflow ? Tier.TeeDon : Tier.Don,
  );

  const signed = runtime.report(prepareReportRequest(report)).result();
  const reply = evm
    .writeReport(runtime, { receiver: config.privateValidationRegistry, report: signed, gasConfig: { gasLimit: config.gasLimit } })
    .result();
  runtime.log(`request ${request.requestId}: ${decoded.passed ? "pass" : "fail"} written, tx status ${reply.txStatus}`);
  return decoded.passed ? "pass" : "fail";
};

const initWorkflow = (config: Config) => [
  cre.handler(
    evmClient(config).logTrigger(
      logTriggerConfig({ addresses: [config.privateValidationRegistry], topics: [[REQUESTED]], confidence: "SAFE" }),
    ),
    onRequested,
  ),
];

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}

main();
