import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

// snarkjs's own browser build, for the prover Web Worker (public/prove-worker.js). Served from node_modules so its
// version is the one bun.lock pins.
export async function GET() {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const file = path.join(path.dirname(require.resolve("snarkjs")), "snarkjs.min.js");
  return new Response(await readFile(file), { headers: { "content-type": "text/javascript", "cache-control": "public, max-age=3600" } });
}
