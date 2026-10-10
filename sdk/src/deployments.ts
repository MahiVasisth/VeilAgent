import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Address } from "viem";

/** Shape of contracts/deployments/<chainId>.json, written by script/Deploy.s.sol. */
export type Deployment = {
  chainId: number;
  startBlock: number;
  identityRegistry: Address;
  reputationRegistry: Address;
  validationRegistry: Address;
  /** Phase 2+. Absent in a Phase 1-only deployment file. */
  veil?: VeilDeployment;
};

/** Veil8004 contracts from script/Deploy.s.sol (Phase 2). */
export type VeilDeployment = {
  /** MockForwarder on Anvil (SIMULATION); the CRE forwarder elsewhere. */
  forwarder: Address;
  forwarderIsMock: boolean;
  policyRegistry: Address;
  privateValidationRegistry: Address;
  treasuryAction: Address;
  treasuryOperator: Address;
  /** Workflow id the registry accepts reports from (`setExpectedWorkflowId`); zero if unset. */
  w1WorkflowId: `0x${string}`;
  /** Phase 3. Absent in a Phase 2-only deployment file. */
  sealedBidHiring?: Address;
  /** Workflow id SealedBidHiring accepts reports from (W3); zero if unset. */
  w3WorkflowId?: `0x${string}`;
  /** Phase 5: our own Semaphore V4 deployment. Absent in a Phase 3/4 deployment file. */
  semaphoreVerifier?: Address;
  semaphore?: Address;
  /** Phase 5: receipts and anonymous feedback. */
  nullifierRegistry?: Address;
  receiptGroupManager?: Address;
  anonymousFeedback?: Address;
  /** Workflow id ReceiptGroupManager accepts reports from (W2); zero if unset. */
  w2WorkflowId?: `0x${string}`;
};

/** Shape of contracts/deployments/<chainId>-agents.json, written by script/RegisterAgents.s.sol. */
export type AgentsFile = { agentIds: number[]; owners: Address[] };

export function loadDeployment(dir: string, chainId: number): Deployment {
  return JSON.parse(readFileSync(join(dir, `${chainId}.json`), "utf8")) as Deployment;
}

export function loadAgents(dir: string, chainId: number): AgentsFile {
  return JSON.parse(readFileSync(join(dir, `${chainId}-agents.json`), "utf8")) as AgentsFile;
}

/** Shape of contracts/deployments/<chainId>-simulated.json, written by scripts/src/simulator.ts (Phase 6). Everything
 *  the population simulator puts on-chain is listed here, so the frontend and the demo can label it as SIMULATED. */
export type SimulatedFile = {
  note: string;
  /** Tasks posted by simulated clients (decimal strings). */
  taskIds: string[];
  /** Simulated clients' wallets (postTask, markCompleted). */
  clients: Address[];
  /** Fresh wallets that sent simulated clients' ratings. */
  raters: Address[];
};

const simulatedPath = (dir: string, chainId: number) => join(dir, `${chainId}-simulated.json`);

/** Null when the simulator has not run against this chain's deployment. */
export function loadSimulated(dir: string, chainId: number): SimulatedFile | null {
  const p = simulatedPath(dir, chainId);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as SimulatedFile) : null;
}

export function saveSimulated(dir: string, chainId: number, file: SimulatedFile) {
  writeFileSync(simulatedPath(dir, chainId), JSON.stringify(file, null, 2) + "\n");
}
