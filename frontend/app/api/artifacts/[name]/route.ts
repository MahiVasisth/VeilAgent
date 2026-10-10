import { readFile } from "node:fs/promises";
import path from "node:path";
import { PINNED_SHA256 } from "@veil8004/sdk/snark-pins";
import { REPO_ROOT } from "../../../../lib/server";

// Same cache as sdk/src/snarkArtifacts.ts (make artifacts).
const DIR = process.env.SNARK_ARTIFACTS_DIR ?? path.join(REPO_ROOT, ".cache/snark-artifacts");

// Serves the pinned Semaphore proving artifacts to the browser's prover. The browser checks each file against the
// same SHA-256 pins before using it, so this route does not have to be trusted.
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  if (!(name in PINNED_SHA256)) return Response.json({ error: "unknown artifact" }, { status: 404 });
  try {
    const data = await readFile(path.join(DIR, name));
    return new Response(data, { headers: { "content-type": "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" } });
  } catch {
    return Response.json({ error: "artifact not fetched yet; run make artifacts" }, { status: 404 });
  }
}
