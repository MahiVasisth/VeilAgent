// Server-only access to public chain data. The frontend never holds keys and reads only public events and storage.
import path from "node:path";
import { createPublicClient, http } from "viem";
import { anvil } from "viem/chains";
import { loadDeployment, loadSimulated, type Deployment, type SimulatedFile } from "@veil8004/sdk/deployments";

export const RPC_URL = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
const DEPLOYMENTS_DIR = process.env.VEIL_DEPLOYMENTS_DIR ?? path.resolve(process.cwd(), "../contracts/deployments");

export const publicClient = createPublicClient({ chain: anvil, transport: http(RPC_URL) });

export function deployment(): Deployment {
  return loadDeployment(DEPLOYMENTS_DIR, anvil.id);
}

/** The population simulator's labels for this chain, or null when nothing on it is simulated. */
export function simulated(): SimulatedFile | null {
  return loadSimulated(DEPLOYMENTS_DIR, anvil.id);
}

/** The time the next block will carry (see nextBlockTime in lib/app/runtime.ts): on an idle Anvil the latest block can
 *  be hours old, so "closes in" and "ago" are measured against the pending block instead. */
export async function chainNow(): Promise<bigint> {
  const [latest, pending] = await Promise.all([
    publicClient.getBlock({ blockTag: "latest" }),
    publicClient.getBlock({ blockTag: "pending" }).catch(() => null),
  ]);
  const wall = BigInt(Math.floor(Date.now() / 1000));
  return [latest.timestamp, pending?.timestamp ?? 0n, wall].reduce((a, b) => (b > a ? b : a));
}
