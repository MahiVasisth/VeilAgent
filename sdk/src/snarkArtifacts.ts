// Semaphore V4 proving artifacts (Phase 5, docs/phase0.md S-5). @semaphore-protocol/proof downloads a `.wasm` and a
// `.zkey` per Merkle tree depth on first use. Veil8004 fetches them once into a local cache
// (scripts/src/fetch-artifacts.ts), checks them against the hashes pinned below, and passes the paths to generateProof,
// so proving works offline and a swapped file is caught.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export { DEFAULT_DEPTHS, PINNED_SHA256, SEMAPHORE_ARTIFACT_URL, SEMAPHORE_ARTIFACT_VERSION, artifactFileNames } from "./snarkPins";
import { artifactFileNames, PINNED_SHA256 } from "./snarkPins";

/** Default cache: <repo>/.cache/snark-artifacts (git-ignored). Override with SNARK_ARTIFACTS_DIR. */
export function artifactsDir(): string {
  return process.env.SNARK_ARTIFACTS_DIR ?? fileURLToPath(new URL("../../.cache/snark-artifacts", import.meta.url));
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Paths for `depth`, after checking both files exist and match their pins. Throws with what to run otherwise. */
export function snarkArtifacts(depth: number, dir = artifactsDir()): { wasm: string; zkey: string } {
  const names = artifactFileNames(depth);
  const paths = { wasm: join(dir, names.wasm), zkey: join(dir, names.zkey) };
  for (const [kind, path] of Object.entries(paths)) {
    const name = names[kind as "wasm" | "zkey"];
    if (!existsSync(path)) throw new Error(`missing Semaphore artifact ${path}; run: bun scripts/src/fetch-artifacts.ts --depth ${depth}`);
    const pin = PINNED_SHA256[name];
    if (!pin) throw new Error(`no pinned hash for ${name}; add it to PINNED_SHA256 in sdk/src/snarkArtifacts.ts`);
    if (sha256File(path) !== pin) throw new Error(`${path} does not match its pinned SHA-256; delete it and fetch again`);
  }
  return paths;
}
