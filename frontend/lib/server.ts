// Server-only settings for the app's API routes. Nothing here is secret except the relayer key, which can only send
// AnonymousFeedback.submit (app/api/relay).
import path from "node:path";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { loadAgents } from "@veil8004/sdk/deployments";
import { deployment } from "./chain";

export const REPO_ROOT = path.resolve(process.cwd(), "..");
export const DEPLOYMENTS_DIR = process.env.VEIL_DEPLOYMENTS_DIR ?? path.join(REPO_ROOT, "contracts/deployments");
export const SEALED_STORE_URL = process.env.SEALED_STORE_URL ?? "http://127.0.0.1:8787";
/** The RPC URL the *browser* talks to (Anvil allows cross-origin requests). */
export const BROWSER_RPC_URL = process.env.BROWSER_RPC_URL ?? process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";

export const isLocal = (chainId: number) => chainId === 31337;

/** Relayer for anonymous ratings: RELAYER_PRIVATE_KEY, or on Anvil the default account 9. Null if neither applies. */
export function relayerAccount(chainId: number) {
  const key = process.env.RELAYER_PRIVATE_KEY;
  if (key) return privateKeyToAccount(key as `0x${string}`);
  if (isLocal(chainId)) return mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: 9 });
  return null;
}

export function appConfig() {
  const d = deployment();
  let agents: { agentIds: number[]; owners: string[] } | null = null;
  try {
    agents = loadAgents(DEPLOYMENTS_DIR, d.chainId);
  } catch {
    agents = null;
  }
  return {
    chainId: d.chainId,
    rpcUrl: BROWSER_RPC_URL,
    deployment: d,
    demoAgents: agents,
    // Public keys only: the workflows' decryption keys never leave them (or the local runner).
    w1PublicKey: process.env.W1_PUBLIC_KEY ?? null,
    w3PublicKey: process.env.W3_PUBLIC_KEY ?? null,
    local: isLocal(d.chainId),
    relayer: relayerAccount(d.chainId)?.address ?? null,
  };
}

export type AppConfig = ReturnType<typeof appConfig>;
