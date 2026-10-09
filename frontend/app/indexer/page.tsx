import { connection } from "next/server";
import { buildPublicGraph, fetchPublicData, type PublicGraph } from "@veil8004/sdk";
import { deployment, publicClient, RPC_URL } from "../../lib/chain";
import { LeakGraph } from "./LeakGraph";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const result = (r: number | null) => (r === null ? "pending" : r === 100 ? "pass" : r === 0 ? "fail" : `${r}/100`);

async function load(): Promise<{ graph: PublicGraph } | { error: string }> {
  try {
    return { graph: buildPublicGraph(await fetchPublicData(publicClient, deployment())) };
  } catch (e) {
    return { error: e instanceof Error ? e.message.split("\n")[0]! : String(e) };
  }
}

export default async function IndexerPage() {
  await connection(); // always read the chain at request time
  const data = await load();

  return (
    <main>
      <nav>
        <a href="/indexer">Indexer view</a>
      </nav>
      <h1>What an indexer sees</h1>
      <p className="lede">
        Plain ERC-8004 on local Anvil (<code>{RPC_URL}</code>). Everything below is rebuilt from public events and
        transactions only: no keys, no off-chain database. Entity names are fictional demo data.
      </p>

      {"error" in data ? (
        <div className="card error">
          <strong>Could not read the chain.</strong> {data.error}
          <p>
            Start Anvil and run the baseline: <code>make phase1</code>.
          </p>
        </div>
      ) : (
        <Graph graph={data.graph} />
      )}
    </main>
  );
}

function Graph({ graph }: { graph: PublicGraph }) {
  return (
    <>
      <section className="card graph" data-testid="leak-graph">
        <LeakGraph nodes={graph.nodes} edges={graph.edges} />
        <div className="legend">
          <span><span className="dot" style={{ background: "var(--client)" }} />client / payment</span>
          <span><span className="dot" style={{ background: "var(--agent)" }} />agent</span>
          <span><span className="dot" style={{ background: "var(--validator)" }} />validator / validation</span>
          <span><span className="dot" style={{ background: "var(--leak)" }} />rating</span>
        </div>
      </section>

      <h2>What leaks ({graph.leaks.length} facts)</h2>
      <ul className="leaks" data-testid="leaks">
        {graph.leaks.map((l, i) => <li key={i}>{l}</li>)}
      </ul>

      <h2>Ratings: who rated whom, and what they paid</h2>
      <div className="table-wrap card">
        <table data-testid="feedback">
          <thead>
            <tr><th>Client</th><th>Agent</th><th>Score</th><th>Tags</th><th>Payment</th></tr>
          </thead>
          <tbody>
            {graph.feedback.map((f, i) => (
              <tr key={i}>
                <td className="mono leak">{short(f.client)}</td>
                <td>{f.agentName} <span className="mono">#{f.agentId.toString()}</span></td>
                <td className="leak">{f.score}</td>
                <td>{[f.tag1, f.tag2].filter(Boolean).join(", ")}</td>
                <td className="leak">{f.payment ? `${f.payment.amountEth} ETH` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Validations: input and result in the clear</h2>
      <div className="table-wrap card">
        <table data-testid="validations">
          <thead>
            <tr><th>Agent</th><th>Requested by</th><th>Validator</th><th>Input (from requestURI)</th><th>Result</th><th>Tag</th></tr>
          </thead>
          <tbody>
            {graph.validations.map((v) => (
              <tr key={v.requestHash}>
                <td>{v.agentName} <span className="mono">#{v.agentId.toString()}</span></td>
                <td className="mono">{short(v.requester)}</td>
                <td className="mono">{short(v.validator)}</td>
                <td className="mono leak">{JSON.stringify((v.request as { input?: unknown } | null)?.input ?? v.request)}</td>
                <td className="leak">{result(v.response)}</td>
                <td>{v.tag ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Registered agents</h2>
      <div className="table-wrap card">
        <table>
          <thead><tr><th>Id</th><th>Name</th><th>Owner</th></tr></thead>
          <tbody>
            {graph.agents.map((a) => (
              <tr key={a.agentId.toString()}><td className="mono">#{a.agentId.toString()}</td><td>{a.name}</td><td className="mono">{a.owner}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
