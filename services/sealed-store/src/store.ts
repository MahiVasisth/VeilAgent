// Sealed store: holds ciphertext only, write-once, read with a workflow bearer token.
//   PUT /v1/payload/:key   body = base64 sealed box (decoded size <= 4096 bytes). 201, or 409 if the key exists.
//   GET /v1/payload/:key   Authorization: Bearer <token>. 200 + base64 body, 401/403, or 404.
// Keys: a requestId (0x + 64 hex) for W1 validations; for W3 bids, `bid:<bidCommitment>` (Phase 3, uploaded before the
// bid transaction so the key cannot be claimed first, docs/phase0.md P3-2) or the spec's `taskId:agentId` (decimal).
// Each token may read one key kind only. Payloads and tokens are never logged.
// Known limitation (docs/threat-model.md): PUT is unauthenticated, so anyone can claim a key first.

export const MAX_SEALED_BYTES = 4096;

export type KeyKind = "validation" | "bid";
const KEY_PATTERNS: Record<KeyKind, RegExp> = {
  validation: /^0x[0-9a-f]{64}$/,
  bid: /^(\d{1,78}:\d{1,78}|bid:0x[0-9a-f]{64})$/,
};

export type StoreConfig = { tokens: Partial<Record<KeyKind, string>> };

export function kindOf(key: string): KeyKind | null {
  for (const [kind, re] of Object.entries(KEY_PATTERNS)) if (re.test(key)) return kind as KeyKind;
  return null;
}

export function createSealedStore(config: StoreConfig) {
  const data = new Map<string, string>();
  const text = (status: number, body: string) => new Response(body, { status, headers: { "content-type": "text/plain" } });

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") return text(200, "ok");
    const match = /^\/v1\/payload\/([^/]+)$/.exec(url.pathname);
    if (!match) return text(404, "not found");
    const key = decodeURIComponent(match[1]!).toLowerCase();
    const kind = kindOf(key);
    if (!kind) return text(400, "bad key: expected a requestId (0x + 64 hex), bid:<commitment> or taskId:agentId");

    if (req.method === "PUT") {
      const body = (await req.text()).trim();
      if (body.length > Math.ceil(MAX_SEALED_BYTES / 3) * 4 + 4) return text(413, "payload too large");
      let bytes: Uint8Array;
      try {
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw new Error();
        bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
      } catch {
        return text(400, "body must be base64");
      }
      if (bytes.length > MAX_SEALED_BYTES) return text(413, "payload too large");
      if (bytes.length < 48) return text(400, "not a sealed box (too short)");
      if (data.has(key)) return text(409, "key already written");
      data.set(key, body);
      return text(201, "stored");
    }

    if (req.method === "GET") {
      const auth = req.headers.get("authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!token) return text(401, "missing bearer token");
      const allowed = config.tokens[kind];
      if (!allowed || !timingSafeEqual(token, allowed)) return text(403, "token not valid for this key");
      const value = data.get(key);
      return value === undefined ? text(404, "no payload") : text(200, value);
    }

    return text(405, "method not allowed");
  }

  return { handle, size: () => data.size };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
