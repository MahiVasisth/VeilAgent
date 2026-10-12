"use client";
// Browser runtime for the Veil8004 app: config from /api/config, a public client, wallets (an injected wallet such as
// MetaMask, or Anvil's public demo accounts on a local chain), and a send helper that simulates first so a revert shows
// its custom error name before anything is signed.
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  type Abi,
  type Account,
  type Address,
  type Chain,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import {
  anonymousFeedbackAbi,
  identityRegistryAbi,
  mockForwarderAbi,
  nullifierRegistryAbi,
  policyRegistryAbi,
  privateValidationRegistryAbi,
  receiptGroupManagerAbi,
  reputationRegistryAbi,
  sealedBidHiringAbi,
  semaphoreAbi,
  treasuryActionAbi,
  validationRegistryAbi,
} from "@veil8004/sdk";
import type { AppConfig } from "../server";

export type { AppConfig };

export async function loadConfig(): Promise<AppConfig> {
  const res = await fetch("/api/config", { cache: "no-store" });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `config: ${res.status}`);
  return body as AppConfig;
}

export function chainOf(c: AppConfig): Chain {
  return defineChain({
    id: c.chainId,
    name: c.local ? "Anvil (local)" : c.chainId === 10143 ? "Monad testnet" : `chain ${c.chainId}`,
    nativeCurrency: { name: c.chainId === 10143 ? "MON" : "ETH", symbol: c.chainId === 10143 ? "MON" : "ETH", decimals: 18 },
    rpcUrls: { default: { http: [c.rpcUrl] } },
  });
}

export const makePublicClient = (c: AppConfig): PublicClient => createPublicClient({ chain: chainOf(c), transport: http(c.rpcUrl) }) as PublicClient;

// ---- wallets ----------------------------------------------------------------------------------------------------

export type Signer = { address: Address; label: string; kind: "demo" | "injected"; wallet: WalletClient };

/** Anvil's default mnemonic: its keys are public. Offered only on a local chain, and labeled as such. */
const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
export const DEMO_ACCOUNTS = [
  { index: 1, label: "Atlas's owner (agent)" },
  { index: 2, label: "Borealis's owner (agent)" },
  { index: 3, label: "Cirrus's owner (agent)" },
  { index: 4, label: "Client A" },
  { index: 5, label: "Client B" },
  { index: 7, label: "Treasury operator" },
] as const;

export function demoSigner(c: AppConfig, index: number, label: string): Signer {
  if (!c.local) throw new Error("demo accounts exist only on a local Anvil chain");
  const account: Account = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: index });
  return { address: account.address, label, kind: "demo", wallet: createWalletClient({ account, chain: chainOf(c), transport: http(c.rpcUrl) }) };
}

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
const injected = () => (globalThis as { ethereum?: Eip1193 }).ethereum;
export const hasInjectedWallet = () => !!injected();

/** Connects the browser wallet and switches it to this app's chain (adding it if the wallet does not know it). */
export async function connectInjected(c: AppConfig): Promise<Signer> {
  const eth = injected();
  if (!eth) throw new Error("no browser wallet found (install MetaMask or similar)");
  const [address] = (await eth.request({ method: "eth_requestAccounts" })) as Address[];
  if (!address) throw new Error("the wallet returned no account");
  const hex = `0x${c.chainId.toString(16)}`;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch {
    const chain = chainOf(c);
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: hex, chainName: chain.name, rpcUrls: [c.rpcUrl], nativeCurrency: chain.nativeCurrency }],
    });
  }
  return { address, label: "Browser wallet", kind: "injected", wallet: createWalletClient({ account: address, chain: chainOf(c), transport: custom(eth) }) };
}

// ---- transactions -------------------------------------------------------------------------------------------------

/** Every ABI the app calls, so reverts bubbled up through other contracts decode to their error names. */
export const ERRORS_ABI = [
  ...privateValidationRegistryAbi,
  ...sealedBidHiringAbi,
  ...treasuryActionAbi,
  ...anonymousFeedbackAbi,
  ...receiptGroupManagerAbi,
  ...semaphoreAbi,
  ...nullifierRegistryAbi,
  ...policyRegistryAbi,
  ...mockForwarderAbi,
  ...identityRegistryAbi,
  ...reputationRegistryAbi,
  ...validationRegistryAbi,
] as Abi;

export type Call = { address: Address; abi: Abi; functionName: string; args: readonly unknown[] };

/** A readable reason for a failed call: the contract's custom error name when there is one. */
export function reason(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) return revert.data?.errorName ?? revert.reason ?? revert.shortMessage;
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Simulates (so a revert is caught before signing), sends, and waits for the receipt. */
export async function sendTx(client: PublicClient, signer: Signer, call: Call): Promise<TransactionReceipt> {
  await client.simulateContract({ ...call, abi: [...call.abi, ...ERRORS_ABI], account: signer.address } as never);
  const hash = await signer.wallet.writeContract({ ...call, account: signer.wallet.account ?? signer.address, chain: signer.wallet.chain } as never);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`transaction reverted: ${hash}`);
  return receipt;
}

/** The time the chain will stamp on the *next* block, which is what a contract's `block.timestamp` check sees. An idle
 *  Anvil keeps an old latest block while its clock runs on (and `skipTime` adds an offset), so the latest block's time
 *  can be hours behind; Anvil reports the next block's time as the pending block. Elsewhere, falls back to the later of
 *  the latest block and this machine's clock. */
export async function nextBlockTime(client: PublicClient): Promise<bigint> {
  const [latest, pending] = await Promise.all([
    client.getBlock({ blockTag: "latest" }),
    client.getBlock({ blockTag: "pending" }).catch(() => null),
  ]);
  const wall = BigInt(Math.floor(Date.now() / 1000));
  return [latest.timestamp, pending?.timestamp ?? 0n, wall].reduce((a, b) => (b > a ? b : a));
}

/** Anvil only: moves the chain clock forward (deadlines, expiries, rating windows) and mines a block. */
export async function skipTime(client: PublicClient, seconds: number) {
  await client.request({ method: "evm_increaseTime" as never, params: [`0x${seconds.toString(16)}`] as never });
  await client.request({ method: "evm_mine" as never, params: [] as never });
}

/** Uploads a sealed box through this app's server (it forwards ciphertext only). */
export async function uploadSealed(key: string, sealed: string) {
  const res = await fetch(`/api/store/${encodeURIComponent(key)}`, { method: "PUT", body: sealed });
  if (!res.ok) throw new Error(`sealed store: ${res.status} ${await res.text()}`);
}
