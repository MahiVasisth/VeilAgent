// LOCAL DON SIMULATION. Stands in for the CRE Workflow DON on Anvil so the demo and end-to-end tests run without a CRE
// account. It watches the same trigger events as the deployed workflows, runs the same pure handlers
// (cre/handlers/validator.ts for W1; cre/handlers/bidOpener.ts for W3, Phase 3; cre/handlers/receiptIssuer.ts for W2,
// Phase 5), and delivers each report through the
// MockForwarder from one allow-listed key.
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
import {
  mockForwarderAbi,
  policyRegistryAbi,
  privateValidationRegistryAbi,
  receiptGroupManagerAbi,
  sealedBidHiringAbi,
} from "@veil8004/sdk/abi/veil";
import { getPayload } from "@veil8004/sdk/sealed-store";
import type { Deployment } from "@veil8004/sdk/deployments";
import { decodeValidationRequested, runValidator, Tier, type ValidationRequest } from "../../handlers/validator";
import { decodeBiddingClosed, runBidOpener, type BiddingClosed } from "../../handlers/bidOpener";
import { decodeJobCompleted, runReceiptIssuer, type JobCompleted } from "../../handlers/receiptIssuer";

export const W1_WORKFLOW_NAME = "veil8004-w1-validator";
export const W3_WORKFLOW_NAME = "veil8004-w3-bid-opener";
export const W2_WORKFLOW_NAME = "veil8004-w2-receipt-issuer";
const STATUS_PENDING = 1;
const TASK_CLOSED = 2;

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
  /** W3 (Phase 3). Without it, BiddingClosed is ignored. */
  w3?: { decryptKey: string; sealedStoreToken: string };
  /** How long to wait for the client's sealed upload after the request event. */
  payloadWaitMs?: number;
  pollMs?: number;
  log?: (line: string) => void;
};

export type Outcome =
  | { requestId: Hex; delivered: true; passed: boolean; txHash: Hex }
  | { requestId: Hex; delivered: false; reason: string };

export type AwardOutcome =
  | { taskId: bigint; delivered: true; winnerAgentId: bigint; validBidCount: number; dropped: number; txHash: Hex }
  | { taskId: bigint; delivered: false; reason: string };

export type ReceiptOutcome = { taskId: bigint; delivered: true; txHash: Hex } | { taskId: bigint; delivered: false; reason: string };

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
  const workflowNames = new Map<string, Hex>();
  const nameBytesOf = async (name: string) => {
    let bytes = workflowNames.get(name);
    if (!bytes) {
      bytes = await publicClient.readContract({ address: veil.forwarder, abi: mockForwarderAbi, functionName: "workflowNameOf", args: [name] });
      workflowNames.set(name, bytes);
    }
    return bytes;
  };
  const nameBytes = () => nameBytesOf(W1_WORKFLOW_NAME);

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
  async function callProvider<T>(path: "/screen" | "/qualify", body: Record<string, string>): Promise<T> {
    const res = await fetch(`${cfg.screeningUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cfg.screeningApiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`screening API ${path} ${res.status}`);
    return (await res.json()) as T;
  }
  const screen = (subject: string) => callProvider<{ hit: boolean }>("/screen", { subject });
  const qualify = (credential: string) => callProvider<{ qualified: boolean }>("/qualify", { credential });

  async function process(request: ValidationRequest): Promise<Outcome> {
    const { requestId } = request;
    const result = await runValidator(request, {
      fetchSealedPayload,
      decryptKey: cfg.w1DecryptKey,
      screen,
      qualify,
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

  // ---- W3 bid opener (Phase 3) ---------------------------------------------------------------
  const hiring = veil.sealedBidHiring;
  const w3 = cfg.w3;
  const seenTasks = new Set<bigint>();

  /** Runs W3 for one BiddingClosed event. Logs only what the report makes public (winner, winning price, count)
   *  plus how many bids were dropped and why; never a counted losing price. */
  async function processClosed(event: BiddingClosed): Promise<AwardOutcome> {
    if (!hiring || !w3 || !veil.w3WorkflowId) throw new Error("W3 is not configured");
    const { taskId } = event;
    const result = await runBidOpener(event, {
      readBids: async (id) =>
        (await publicClient.readContract({ address: hiring, abi: sealedBidHiringAbi, functionName: "getBids", args: [id] })).map((b) => ({
          agentId: b.agentId,
          commitment: b.commitment,
        })),
      // Sealed bids are uploaded before the bid transaction (docs/phase0.md P3-2), so there is nothing to wait for.
      fetchSealedBid: (key) => getPayload(cfg.sealedStoreUrl, key, w3.sealedStoreToken),
      decryptKey: w3.decryptKey,
    });
    for (const d of result.dropped) log(`task ${taskId}: dropped the bid of agent #${d.agentId} (${d.reason})`);
    const { decoded } = result;

    return serialised(async () => {
      const task = await publicClient.readContract({ address: hiring, abi: sealedBidHiringAbi, functionName: "getTask", args: [taskId] });
      if (task.status !== TASK_CLOSED) {
        log(`task ${taskId}: not Closed, skipping`);
        return { taskId, delivered: false as const, reason: "not closed" };
      }
      const txHash = await wallet.writeContract({
        address: veil.forwarder,
        abi: mockForwarderAbi,
        functionName: "deliver",
        args: [hiring, veil.w3WorkflowId!, await nameBytesOf(W3_WORKFLOW_NAME), cfg.workflowOwner, "0x0003", result.report],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") throw new Error(`award delivery reverted: ${txHash}`);
      log(
        decoded.validBidCount === 0
          ? `task ${taskId}: no valid bid, NoAward delivered tx ${txHash}`
          : `task ${taskId}: award delivered (agent #${decoded.winnerAgentId} at ${decoded.winningPrice}, ${decoded.validBidCount} counted, ${result.dropped.length} dropped) tx ${txHash}`,
      );
      return {
        taskId,
        delivered: true as const,
        winnerAgentId: decoded.winnerAgentId,
        validBidCount: decoded.validBidCount,
        dropped: result.dropped.length,
        txHash,
      };
    });
  }

  /** Processes every not-yet-seen BiddingClosed log in [fromBlock, toBlock]. */
  async function processBidRange(fromBlock: bigint, toBlock: bigint): Promise<AwardOutcome[]> {
    if (!hiring || !w3) return [];
    const logs = await publicClient.getLogs({ address: hiring, fromBlock, toBlock });
    const events = parseEventLogs({ abi: sealedBidHiringAbi, eventName: "BiddingClosed", logs });
    const fresh = events.filter((e) => !seenTasks.has(e.args.taskId));
    for (const e of fresh) seenTasks.add(e.args.taskId);
    return Promise.all(
      fresh.map((e) =>
        processClosed(decodeBiddingClosed({ topics: e.topics as Hex[], data: e.data })).catch((err: unknown) => {
          const reason = err instanceof Error ? err.message.split("\n")[0]! : String(err);
          log(`task ${e.args.taskId}: error (${reason})`);
          return { taskId: e.args.taskId, delivered: false as const, reason };
        }),
      ),
    );
  }

  // ---- W2 receipt issuer (Phase 5) -----------------------------------------------------------
  // Runs whenever ReceiptGroupManager is deployed: W2 reads only public data, so it needs no secrets.
  const receipts = veil.receiptGroupManager;
  const seenCompleted = new Set<bigint>();

  /** Runs W2 for one JobCompleted event. The checks run inside the delivery queue so they see the latest state. */
  async function processCompleted(event: JobCompleted): Promise<ReceiptOutcome> {
    if (!hiring || !receipts || !veil.w2WorkflowId) throw new Error("W2 is not configured");
    const { taskId } = event;
    return serialised(async () => {
      const result = await runReceiptIssuer(event, {
        readTask: (id) => publicClient.readContract({ address: hiring, abi: sealedBidHiringAbi, functionName: "getTask", args: [id] }),
        receiptIssued: (id) => publicClient.readContract({ address: receipts, abi: receiptGroupManagerAbi, functionName: "receiptIssued", args: [id] }),
      });
      if (result.stop) {
        log(`${result.reason}, skipping`);
        return { taskId, delivered: false as const, reason: result.reason };
      }
      const txHash = await wallet.writeContract({
        address: veil.forwarder,
        abi: mockForwarderAbi,
        functionName: "deliver",
        args: [receipts, veil.w2WorkflowId!, await nameBytesOf(W2_WORKFLOW_NAME), cfg.workflowOwner, "0x0002", result.report],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") throw new Error(`receipt delivery reverted: ${txHash}`);
      log(`task ${taskId}: receipt delivered (agent #${event.agentId}) tx ${txHash}`);
      return { taskId, delivered: true as const, txHash };
    });
  }

  /** Processes every not-yet-seen JobCompleted log in [fromBlock, toBlock]. */
  async function processCompletedRange(fromBlock: bigint, toBlock: bigint): Promise<ReceiptOutcome[]> {
    if (!hiring || !receipts) return [];
    const logs = await publicClient.getLogs({ address: hiring, fromBlock, toBlock });
    const events = parseEventLogs({ abi: sealedBidHiringAbi, eventName: "JobCompleted", logs });
    const fresh = events.filter((e) => !seenCompleted.has(e.args.taskId));
    for (const e of fresh) seenCompleted.add(e.args.taskId);
    return Promise.all(
      fresh.map((e) =>
        processCompleted(decodeJobCompleted({ topics: e.topics as Hex[], data: e.data })).catch((err: unknown) => {
          const reason = err instanceof Error ? err.message.split("\n")[0]! : String(err);
          log(`task ${e.args.taskId}: receipt error (${reason})`);
          return { taskId: e.args.taskId, delivered: false as const, reason };
        }),
      ),
    );
  }

  /** Follows the chain from `fromBlock` until `signal` aborts. */
  async function watch(fromBlock: bigint, signal?: AbortSignal): Promise<void> {
    let next = fromBlock;
    log(`watching ${registry} for PrivateValidationRequested from block ${next}`);
    if (hiring && w3) log(`watching ${hiring} for BiddingClosed from block ${next}`);
    if (hiring && receipts) log(`watching ${hiring} for JobCompleted from block ${next}`);
    while (!signal?.aborted) {
      const head = await publicClient.getBlockNumber();
      if (head >= next) {
        void processRange(next, head);
        void processBidRange(next, head);
        void processCompletedRange(next, head);
        next = head + 1n;
      }
      await sleep(cfg.pollMs ?? 300);
    }
  }

  return { process, processRange, processClosed, processBidRange, processCompleted, processCompletedRange, watch };
}

const short = (h: string) => `${h.slice(0, 10)}…`;
