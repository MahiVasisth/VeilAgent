// Shared local setup for scripts: RPC, deployment files and the Anvil demo accounts.
import { join } from "node:path";
import { createPublicClient, createWalletClient, http, type Account, type Chain } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import { loadAgents, loadDeployment } from "@veil8004/sdk/deployments";

export const DEPLOYMENTS_DIR = join(import.meta.dir, "../../contracts/deployments");
export const RPC_URL = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
export const CHAIN: Chain = anvil;

// Anvil's well-known default mnemonic. Local demo only: these keys are public.
const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
const anvilAccount = (index: number): Account => mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: index });

/** Demo roles. Indices 1-3 match RegisterAgents.s.sol's default agent owners. */
export const roles = {
  deployer: anvilAccount(0),
  agentOwners: [anvilAccount(1), anvilAccount(2), anvilAccount(3)],
  clients: [anvilAccount(4), anvilAccount(5)],
  publicValidator: anvilAccount(6),
};

export const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });
export const walletFor = (account: Account) => createWalletClient({ account, chain: CHAIN, transport: http(RPC_URL) });

export function local() {
  return { deployment: loadDeployment(DEPLOYMENTS_DIR, CHAIN.id), agents: loadAgents(DEPLOYMENTS_DIR, CHAIN.id) };
}
