import { MAX_SEALED_BYTES } from "@veil8004/sdk/sealed-store";
import { SEALED_STORE_URL } from "../../../../lib/server";

// Forwards a sealed box from the browser to the sealed store, so the store needs no cross-origin setup. Only
// ciphertext passes through here: the browser seals to the workflow's public key before sending.
const KEY = /^(0x[0-9a-f]{64}|bid:0x[0-9a-f]{64})$/;

export async function PUT(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  if (!KEY.test(key)) return Response.json({ error: "bad key" }, { status: 400 });
  const body = await req.text();
  if (body.length > Math.ceil((MAX_SEALED_BYTES * 4) / 3) + 4) return Response.json({ error: "too large" }, { status: 413 });
  const res = await fetch(`${SEALED_STORE_URL}/v1/payload/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "content-type": "text/plain" },
    body,
  }).catch(() => null);
  if (!res) return Response.json({ error: "sealed store unreachable" }, { status: 502 });
  return new Response(await res.text(), { status: res.status });
}
