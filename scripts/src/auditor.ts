// Auditor (Phase 4, Flow C): verify one disclosure bundle against the chain and print what was learned.
//
//   bun scripts/src/auditor.ts <bundle.json | -> [--registry <address>] [--json]
//
// Reads only (eth_call): sends no transaction and needs no key. The registry the bundle names is compared with the one
// you trust: --registry, or else the local deployment file's PrivateValidationRegistry. Exit 0 when the bundle opens
// its request, 1 when it does not, 2 on bad usage or a malformed bundle.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { getAddress, type Address } from "viem";
import { parseBundle, verifyBundle, type AuditReport, type DisclosureBundle } from "@veil8004/sdk";
import { local, publicClient } from "./env";

export async function audit(bundle: DisclosureBundle, expectedRegistry?: Address): Promise<AuditReport> {
  return verifyBundle(publicClient, bundle, expectedRegistry ?? trustedRegistry());
}

function trustedRegistry(): Address | undefined {
  try {
    return local().deployment.veil?.privateValidationRegistry;
  } catch {
    return undefined;
  }
}

export function formatReport(r: AuditReport): string {
  const lines = ["checks:"];
  for (const c of r.checks) lines.push(`  ${c.ok ? "ok  " : "FAIL"}  ${c.name.padEnd(15)} ${c.detail}`);
  if (r.request) {
    const q = r.request;
    lines.push(
      "request:",
      `  id          ${q.requestId}`,
      `  agent       ${q.agentId}`,
      `  policy      ${q.policyName ?? q.policyId}`,
      `  requester   ${q.requester}`,
      `  input       ${JSON.stringify(q.input)}`,
      `  result      ${q.result}${q.tier ? ` (tier ${q.tier}; policy tier ${q.policyTier ?? "unknown"})` : ""}`,
      `  expiry      ${q.expiry === null ? "-" : `${new Date(Number(q.expiry) * 1000).toISOString()}${q.expired ? " (expired)" : ""}`}`,
      `  valid now   ${q.currentlyValid}`,
    );
  }
  lines.push("learned:", ...r.learned.map((l) => `  - ${l}`));
  lines.push(r.valid ? "VERIFIED: the bundle opens this request's on-chain commitment." : "NOT VERIFIED: the bundle does not open this request.");
  return lines.join("\n");
}

// ---- CLI ----------------------------------------------------------------------------------------
if (import.meta.main) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { registry: { type: "string" }, json: { type: "boolean", default: false } },
  });
  const [path] = positionals;
  if (!path) {
    console.error("usage: auditor.ts <bundle.json | -> [--registry <address>] [--json]");
    process.exit(2);
  }
  let bundle: DisclosureBundle;
  try {
    bundle = parseBundle(readFileSync(path === "-" ? 0 : path, "utf8"));
  } catch (e) {
    console.error(`bad bundle: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
  const report = await audit(bundle, values.registry ? getAddress(values.registry) : undefined);
  console.log(values.json ? JSON.stringify(report, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) : formatReport(report));
  process.exit(report.valid ? 0 : 1);
}
