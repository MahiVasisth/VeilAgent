import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Address } from "viem";

/** Shape of contracts/deployments/<chainId>.json, written by script/Deploy.s.sol. */
export type Deployment = {
  chainId: number;
  startBlock: number;
  identityRegistry: Address;
  reputationRegistry: Address;
  validationRegistry: Address;
};

/** Shape of contracts/deployments/<chainId>-agents.json, written by script/RegisterAgents.s.sol. */
export type AgentsFile = { agentIds: number[]; owners: Address[] };

export function loadDeployment(dir: string, chainId: number): Deployment {
  return JSON.parse(readFileSync(join(dir, `${chainId}.json`), "utf8")) as Deployment;
}

export function loadAgents(dir: string, chainId: number): AgentsFile {
  return JSON.parse(readFileSync(join(dir, `${chainId}-agents.json`), "utf8")) as AgentsFile;
}
