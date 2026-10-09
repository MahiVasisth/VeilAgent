// LOCAL DON SIMULATION entry point. Run: bun cre/local-runner/src/main.ts
// Env: ANVIL_RPC_URL, W1_DECRYPT_KEY, SEALED_STORE_URL, SEALED_STORE_W1_TOKEN, MOCK_SCREENING_URL, SCREENING_API_KEY,
//      LOCAL_DON_PRIVATE_KEY (default: Anvil account 8, which Deploy.s.sol allow-lists on the MockForwarder).
//      Phase 3 (W3, optional): W3_DECRYPT_KEY and SEALED_STORE_W3_TOKEN. Without both, BiddingClosed is ignored.
//      Phase 5 (W2): no env; runs whenever the deployment has a ReceiptGroupManager.
import { join } from "node:path";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import { loadDeployment } from "@veil8004/sdk/deployments";
import { createLocalRunner } from "./runner";

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
};

const deployment = loadDeployment(join(import.meta.dir, "../../../contracts/deployments"), anvil.id);
const transmitter = process.env.LOCAL_DON_PRIVATE_KEY
  ? privateKeyToAccount(process.env.LOCAL_DON_PRIVATE_KEY as `0x${string}`)
  : mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: 8 });

const runner = createLocalRunner({
  rpcUrl: process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545",
  chain: anvil,
  deployment,
  transmitter,
  workflowOwner: transmitter.address,
  w1DecryptKey: need("W1_DECRYPT_KEY"),
  sealedStoreUrl: process.env.SEALED_STORE_URL ?? "http://127.0.0.1:8787",
  sealedStoreToken: need("SEALED_STORE_W1_TOKEN"),
  screeningUrl: process.env.MOCK_SCREENING_URL ?? "http://127.0.0.1:8788",
  screeningApiKey: need("SCREENING_API_KEY"),
  w3:
    process.env.W3_DECRYPT_KEY && process.env.SEALED_STORE_W3_TOKEN
      ? { decryptKey: process.env.W3_DECRYPT_KEY, sealedStoreToken: process.env.SEALED_STORE_W3_TOKEN }
      : undefined,
});

console.log("[SIMULATED DON] local runner: a stand-in for the CRE Workflow DON (no consensus, no signatures, no enclave)");
const fromBlock = BigInt(process.env.RUNNER_FROM_BLOCK ?? deployment.startBlock);
await runner.watch(fromBlock);
