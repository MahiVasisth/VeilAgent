// POST a disclosure bundle (Phase 4) and get the auditor's report. Reads the chain with eth_call only and sends no
// transaction. The bundle holds a secret salt: this handler neither logs nor stores it.
import { parseBundle, verifyBundle } from "@veil8004/sdk";
import { deployment, publicClient } from "../../../lib/chain";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > 16_384) return json(413, { error: "bundle too large" });
  let bundle;
  try {
    bundle = parseBundle(text);
  } catch (e) {
    return json(400, { error: e instanceof Error ? e.message : "bad bundle" });
  }
  const trusted = deployment().veil?.privateValidationRegistry;
  if (!trusted) return json(503, { error: "Veil8004 is not deployed on this chain" });
  try {
    return json(200, await verifyBundle(publicClient, bundle, trusted));
  } catch {
    return json(502, { error: "could not read the chain" });
  }
}
