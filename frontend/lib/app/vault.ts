"use client";
// The user's secrets, kept in this browser only: validation openings (input + salt, needed to disclose a request
// later), sealed-bid openings, and Semaphore identities (needed to rate after a job). Nothing here is sent anywhere.
// Scoped to the chain's genesis block, so a fresh local chain at the same addresses starts with an empty vault.
// Clearing site data loses them; the app offers an export.
import type { Address, Hex } from "viem";

export type Opening = { requestId: Hex; registry: Address; agentId: string; policy: string; input: string; salt: Hex; requester: Address; at: number };
export type BidSecret = { taskId: string; agentId: string; price: string; salt: Hex; commitment: Hex; at: number };
export type IdentitySecret = { taskId: string | null; commitment: string; privateKey: string; owner: Address; at: number; rated?: string[] };
export type Vault = { openings: Opening[]; bids: BidSecret[]; identities: IdentitySecret[] };

const empty = (): Vault => ({ openings: [], bids: [], identities: [] });
const keyFor = (scope: string) => `veil8004:vault:${scope}`;

export function readVault(scope: string): Vault {
  try {
    const raw = localStorage.getItem(keyFor(scope));
    return raw ? { ...empty(), ...(JSON.parse(raw) as Vault) } : empty();
  } catch {
    return empty();
  }
}

export function updateVault(scope: string, change: (v: Vault) => void): Vault {
  const v = readVault(scope);
  change(v);
  try {
    localStorage.setItem(keyFor(scope), JSON.stringify(v));
  } catch {
    throw new Error("could not save to this browser's storage; export your secrets before continuing");
  }
  return v;
}

export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
