// Fetch the Semaphore proving artifacts into the local cache and check them against the pinned hashes
// (docs/phase0.md S-5). Run once while online; proving then works offline.
//
//   bun scripts/src/fetch-artifacts.ts [--depth <n> ...] [--print-hashes]
//
// --print-hashes prints the SHA-256 of every cached file instead of failing on a missing pin (used once, to pin).
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  artifactFileNames,
  artifactsDir,
  DEFAULT_DEPTHS,
  PINNED_SHA256,
  SEMAPHORE_ARTIFACT_URL,
  sha256File,
} from "@veil8004/sdk/snark-artifacts";

const { values } = parseArgs({ options: { depth: { type: "string", multiple: true }, "print-hashes": { type: "boolean", default: false } } });
const depths = values.depth?.map(Number) ?? [...DEFAULT_DEPTHS];
const dir = artifactsDir();
mkdirSync(dir, { recursive: true });

let bad = 0;
for (const depth of depths) {
  if (!Number.isInteger(depth) || depth < 1 || depth > 32) throw new Error(`bad depth ${depth}`);
  for (const name of Object.values(artifactFileNames(depth))) {
    const path = join(dir, name);
    if (!existsSync(path)) {
      const res = await fetch(`${SEMAPHORE_ARTIFACT_URL}/${name}`);
      if (!res.ok) throw new Error(`GET ${SEMAPHORE_ARTIFACT_URL}/${name}: HTTP ${res.status}`);
      writeFileSync(`${path}.part`, new Uint8Array(await res.arrayBuffer()));
      renameSync(`${path}.part`, path);
      console.log(`fetched ${name}`);
    }
    const hash = sha256File(path);
    if (values["print-hashes"]) {
      console.log(`  "${name}": "${hash}",`);
    } else if (PINNED_SHA256[name] !== hash) {
      bad++;
      console.error(`${name}: ${PINNED_SHA256[name] ? "does not match its pinned SHA-256" : "no pinned hash"} (${hash})`);
    }
  }
}
if (bad) process.exit(1);
if (!values["print-hashes"]) console.log(`Semaphore artifacts for depths ${depths.join(", ")} present and match their pins in ${dir}`);
