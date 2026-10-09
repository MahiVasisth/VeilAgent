// Server-only access to public chain data. The frontend never holds keys and reads only public events and storage.
import path from "node:path";
import { createPublicClient, http } from "viem";
import { anvil } from "viem/chains";
import { loadDeployment, type Deployment } from "@veil8004/sdk/deployments";

export const RPC_URL = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
const DEPLOYMENTS_DIR = process.env.VEIL_DEPLOYMENTS_DIR ?? path.resolve(process.cwd(), "../contracts/deployments");

export const publicClient = createPublicClient({ chain: anvil, transport: http(RPC_URL) });

export function deployment(): Deployment {
  return loadDeployment(DEPLOYMENTS_DIR, anvil.id);
}
