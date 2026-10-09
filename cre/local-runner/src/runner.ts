// LOCAL DON SIMULATION. Stands in for the CRE Workflow DON on Anvil so the demo and end-to-end tests run without a CRE
// account. It watches the same trigger event as the deployed workflow, runs the same pure handler
// (cre/handlers/validator.ts), and delivers the report through the MockForwarder from one allow-listed key.
// What it does NOT simulate: DON consensus, report signatures, the enclave for Confidential HTTP (the screening API
// key is read from env here), or Confidential Workflows. Results are reported at Tier.Don.
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { mockForwarderAbi, policyRegistryAbi, privateValidationRegistryAbi } from "@veil8004/sdk/abi/veil";
import { getPayload } from "@veil8004/sdk/sealed-store";
import type { Deployment } from "@veil8004/sdk/deployments";
import { decodeValidationRequested, runValidator, Tier, type ValidationRequest } from "../../handlers/validator";

export const W1_WORKFLOW_NAME = "veil8004-w1-validator";
const STATUS_PENDING = 1;

export type RunnerConfig = {
  rpcUrl: string;
  chain: Chain;
  deployment: Deployment;
  /** Allow-listed MockForwarder transmitter: the simulated DON's key. */
  transmitter: Account;
  /** Reported as the workflow owner in report metadata. */
  workflowOwner: Address;
  w1DecryptKey: string;
  sealedStoreUrl: string;
  sealedStoreToken: string;
  screeningUrl: string;
  screeningApiKey: string;
  /** How long to wait for the client's sealed upload after the request event. */
  payloadWaitMs?: number;
  pollMs?: number;
  log?: (line: string) => void;
};

export type Outcome =
  | { requestId: Hex; delivered: true; passed: boolean; txHash: Hex }
  | { requestId: Hex; delivered: false; reason: string };

export function createLocalRunner(cfg: RunnerConfig) {
  const maybeVeil = cfg.deployment.veil;
  if (!maybeVeil) throw new Error("deployment has no Phase 2 contracts; re-run Deploy.s.sol");
  const veil = maybeVeil;
  if (!veil.forwarderIsMock) throw new Error("the local runner only delivers through the MockForwarder");
  const log = cfg.log ?? ((l: string) => console.log(`[SIMULATED DON] ${l}`));
  const publicClient = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) }) as PublicClient;
  const wallet = createWalletClient({ account: cfg.transmitter, chain: cfg.chain, transport: http(cfg.rpcUrl) });
  const registry = veil.privateValidationRegistry;
  const seen = new Set<Hex>();
  const waitMs = cfg.payloadWaitMs ?? 15_000;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // One transmitter key: serialise deliveries so concurrent requests never race on the nonce.
  let deliveryQueue: Promise<unknown> = Promise.resolve();
  const serialised = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = deliveryQueue.then(fn, fn);
    deliveryQueue = run.catch(() => {});
    return run;
  };

  // The workflow name CRE would put in metadata (first 10 hex chars of sha256(name), as ASCII).
  let workflowName: Hex | undefined;
  const nameBytes = async () =>
    (workflowName ??= await publicClient.readContract({
      address: veil.forwarder,
      abi: mockForwarderAbi,
      functionName: "workflowNameOf",
      args: [W1_WORKFLOW_NAME],
    }));

  /** Polls the sealed store until the client's upload appears or the wait runs out. */
  async function fetchSealedPayload(requestId: Hex): Promise<string | null> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const payload = await getPayload(cfg.sealedStoreUrl, requestId, cfg.sealedStoreToken);
      if (payload !== null || Date.now() >= deadline) return payload;
      await sleep(250);
    }
  }

  /** Stands in for Confidential HTTP: same request shape, but the API key comes from env, not an enclave. */
  async function screen(subject: string) {
    const res = await fetch(`${cfg.screeningUrl}/screen`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cfg.screeningApiKey },
      body: JSON.stringify({ subject }),
    });
    if (!res.ok) throw new Error(`screening API ${res.status}`);
    return (await res.json()) as { hit: boolean };
  }

  async function process(request: ValidationRequest): Promise<Outcome> {
    const { requestId } = request;
    const result = await runValidator(request, {
      fetchSealedPayload,
      decryptKey: cfg.w1DecryptKey,
      screen,
      validityWindow: async (policyId) =>
        (await publicClient.readContract({ address: veil.policyRegistry, abi: policyRegistryAbi, functionName: "getPolicy", args: [policyId] }))
          .validityWindow,
      // Chain time, not wall time, so the demo can move the clock with evm_increaseTime.
      now: async () => (await publicClient.getBlock({ blockTag: "latest" })).timestamp,
      tier: Tier.Don,
    });
    if (result.stop) {
      log(`request ${short(requestId)}: stopped, no report (${result.reason})`);
      return { requestId, delivered: false, reason: result.reason };
    }

    return serialised(() => deliver(requestId, result.report, result.decoded.passed));
  }

  async function deliver(requestId: Hex, report: Hex, passed: boolean): Promise<Outcome> {
    const stored = await publicClient.readContract({ address: registry, abi: privateValidationRegistryAbi, functionName: "getRequest", args: [requestId] });
    if (stored.status !== STATUS_PENDING) {
      log(`request ${short(requestId)}: already resolved, skipping`);
      return { requestId, delivered: false, reason: "not pending" };
    }

    const txHash = await wallet.writeContract({
      address: veil.forwarder,
      abi: mockForwarderAbi,
      functionName: "deliver",
      args: [registry, veil.w1WorkflowId, await nameBytes(), cfg.workflowOwner, "0x0001", report],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new Error(`report delivery reverted: ${txHash}`);
    log(`request ${short(requestId)}: report delivered (${passed ? "pass" : "fail"}, tier Don) tx ${txHash}`);
    return { requestId, delivered: true, passed, txHash };
  }

  /** Processes every not-yet-seen PrivateValidationRequested log in [fromBlock, toBlock]. */
  async function processRange(fromBlock: bigint, toBlock: bigint): Promise<Outcome[]> {
    const logs = await publicClient.getLogs({ address: registry, fromBlock, toBlock });
    const events = parseEventLogs({ abi: privateValidationRegistryAbi, eventName: "PrivateValidationRequested", logs });
    const fresh = events.filter((e) => !seen.has(e.args.requestId));
    for (const e of fresh) seen.add(e.args.requestId);
    // Each request is independent; run them concurrently so one slow upload does not hold up the rest.
    return Promise.all(
      fresh.map((e) =>
        process(decodeValidationRequested({ topics: e.topics as Hex[], data: e.data })).catch((err: unknown) => {
          const reason = err instanceof Error ? err.message.split("\n")[0]! : String(err);
          log(`request ${short(e.args.requestId)}: error (${reason})`);
          return { requestId: e.args.requestId, delivered: false as const, reason };
        }),
      ),
    );
  }

  /** Follows the chain from `fromBlock` until `signal` aborts. */
  async function watch(fromBlock: bigint, signal?: AbortSignal): Promise<void> {
    let next = fromBlock;
    log(`watching ${registry} for PrivateValidationRequested from block ${next}`);
    while (!signal?.aborted) {
      const head = await publicClient.getBlockNumber();
      if (head >= next) {
        void processRange(next, head);
        next = head + 1n;
      }
      await sleep(cfg.pollMs ?? 300);
    }
  }

  return { process, processRange, watch };
}

const short = (h: string) => `${h.slice(0, 10)}…`;
