// Client for services/sealed-store: a ciphertext-only, write-once key/value store.
// Keys: a requestId (0x + 64 hex) for validations, `taskId:agentId` for bids.

export const MAX_SEALED_BYTES = 4096;

export type SealedStoreError = { status: number; error: string };

/** Uploads a base64 sealed box under `key`. Throws on any non-2xx (409 = key already written). */
export async function putPayload(baseUrl: string, key: string, ciphertextB64: string): Promise<void> {
  const res = await fetch(`${baseUrl}/v1/payload/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "content-type": "text/plain" },
    body: ciphertextB64,
  });
  if (!res.ok) throw new Error(`sealed-store PUT ${key}: ${res.status} ${await res.text()}`);
}

/** Fetches the base64 sealed box under `key` with a workflow bearer token. Returns null if nothing is stored. */
export async function getPayload(baseUrl: string, key: string, token: string): Promise<string | null> {
  const res = await fetch(`${baseUrl}/v1/payload/${encodeURIComponent(key)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`sealed-store GET ${key}: ${res.status} ${await res.text()}`);
  return res.text();
}
