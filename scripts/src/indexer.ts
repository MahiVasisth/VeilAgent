// "What an indexer sees": rebuilds the client/agent/validator graph from public events and transactions only.
// Run: bun scripts/src/indexer.ts [--check]
// --check exits non-zero unless the graph exposes the Phase 1 leaks: client, agent, score and validation.
import { buildPublicGraph, fetchPublicData } from "@veil8004/sdk";
import { local, publicClient } from "./env";

const graph = buildPublicGraph(await fetchPublicData(publicClient, local().deployment));

console.log(`agents (${graph.agents.length}):`);
for (const a of graph.agents) console.log(`  #${a.agentId} ${a.name} owner ${a.owner}`);
console.log(`\nwhat leaks (${graph.leaks.length} facts, from public chain data only):`);
for (const line of graph.leaks) console.log(`  - ${line}`);
console.log(`\ngraph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
for (const e of graph.edges) console.log(`  ${e.from} --${e.kind}: ${e.label}--> ${e.to}`);

if (process.argv.includes("--check")) {
  const failures: string[] = [];
  if (graph.agents.length < 2) failures.push("expected at least 2 registered agents");
  if (graph.feedback.length === 0) failures.push("no feedback found");
  for (const f of graph.feedback) {
    if (!f.client || !f.agentName || !f.score) failures.push(`feedback missing client/agent/score: ${JSON.stringify(f)}`);
    if (!graph.edges.some((e) => e.kind === "feedback" && e.from === `client:${f.client.toLowerCase()}`))
      failures.push(`no client->agent feedback edge for ${f.client}`);
  }
  if (graph.validations.length === 0) failures.push("no validations found");
  for (const v of graph.validations) {
    const input = (v.request as { input?: unknown } | null)?.input;
    if (input === undefined) failures.push(`validation ${v.requestHash}: input not readable`);
    if (v.response === null) failures.push(`validation ${v.requestHash}: no public result`);
  }
  if (failures.length) {
    console.error(`\nEXIT CHECK FAILED:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log(
    `\nEXIT CHECK PASSED: ${graph.feedback.length} client->agent ratings and ${graph.validations.length} ` +
      `validations (input + result) are readable from public data.`,
  );
}
