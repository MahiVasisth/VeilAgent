import { connection } from "next/server";
import {
  type SimulatedFile,
  buildFeedbackView,
  buildPublicGraph,
  buildVeilView,
  fetchFeedbackData,
  fetchPublicData,
  fetchVeilData,
  formatAverage,
  type FeedbackView,
  type PublicGraph,
  type VeilView,
} from "@veil8004/sdk";
import { deployment, publicClient, RPC_URL, simulated as loadSimulated } from "../../lib/chain";
import { LeakGraph } from "./LeakGraph";
import { SimDataBanner } from "../Nav";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const result = (r: number | null) => (r === null ? "pending" : r === 100 ? "pass" : r === 0 ? "fail" : `${r}/100`);

type Loaded = {
  graph: PublicGraph;
  veil: VeilView | null;
  feedback: FeedbackView | null;
  veilRegistry: string | null;
  simulated: boolean;
  sim: SimulatedFile | null;
};

async function load(): Promise<Loaded | { error: string }> {
  try {
    const d = deployment();
    const rawPublic = await fetchPublicData(publicClient, d);
    // The averages AnonymousFeedback anchors are NewFeedback events too; they belong to the Veil8004 side.
    const anon = d.veil?.anonymousFeedback?.toLowerCase();
    const graph = buildPublicGraph({ ...rawPublic, feedback: rawPublic.feedback.filter((f) => f.client.toLowerCase() !== anon) });
    const [raw, rawFeedback] = await Promise.all([fetchVeilData(publicClient, d), fetchFeedbackData(publicClient, d)]);
    const names = new Map(graph.agents.map((a) => [a.agentId, a.name]));
    return {
      graph,
      veil: raw ? buildVeilView(raw, names) : null,
      feedback: rawFeedback ? buildFeedbackView(rawFeedback, names) : null,
      veilRegistry: d.veil?.privateValidationRegistry ?? null,
      simulated: d.veil?.forwarderIsMock ?? false,
      sim: loadSimulated(),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message.split("\n")[0]! : String(e) };
  }
}

export default async function IndexerPage() {
  await connection(); // always read the chain at request time
  const data = await load();

  return (
    <main>
      <h1>What an indexer sees</h1>
      <p className="lede">
        Plain ERC-8004 and Veil8004 on local Anvil (<code>{RPC_URL}</code>). Everything below is rebuilt from public events and
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
        <>
          <SimDataBanner sim={data.sim} />
          <Split data={data} />
          <RatingsSplit graph={data.graph} feedback={data.feedback} sim={data.sim} />
          <h2>Plain ERC-8004 in detail</h2>
          <Graph graph={data.graph} />
        </>
      )}
    </main>
  );
}

/** The same kind of interaction (screen a counterparty for an agent) under plain ERC-8004 and under Veil8004. */
function Split({ data }: { data: Loaded }) {
  const { graph, veil, veilRegistry, simulated } = data;
  // Standard validations, minus the ERC-8004 mirrors of Veil8004 results (those are shown on the right).
  const plain = graph.validations.filter((v) => v.validator.toLowerCase() !== veilRegistry?.toLowerCase());
  return (
    <section aria-label="Split view">
      <h2>Split view: the same screening, two ways</h2>
      {simulated && (
        <p className="sim-banner" data-testid="sim-banner">
          <strong>Simulated DON.</strong> Veil8004 results on this chain were delivered by the local runner through a
          MockForwarder, not by a Chainlink CRE DON. Screening uses a mock API with a fictional list.
        </p>
      )}
      <div className="split">
        <div className="card" data-testid="plain-view">
          <h3>Plain ERC-8004</h3>
          <p className="sub">ValidationRequest / ValidationResponse events</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Agent</th><th>Input</th><th>Result</th></tr></thead>
              <tbody>
                {plain.length === 0 && (
                  <tr><td colSpan={3} className="sub">No plain ERC-8004 validations on this chain yet.</td></tr>
                )}
                {plain.map((v) => (
                  <tr key={v.requestHash}>
                    <td>{v.agentName}</td>
                    <td className="mono leak">{JSON.stringify((v.request as { input?: unknown } | null)?.input ?? v.request)}</td>
                    <td className="leak">{result(v.response)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" data-testid="veil-view">
          <h3>Veil8004</h3>
          <p className="sub">PrivateValidationRequested / Recorded events</p>
          {veil === null ? (
            <p>Veil8004 is not deployed on this chain yet.</p>
          ) : veil.rows.length === 0 ? (
            <p>No private validations yet. Run <code>make phase2</code>.</p>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Agent</th><th>Requested by</th><th>Policy</th><th>Commitment</th><th>Result</th></tr></thead>
                  <tbody>
                    {veil.rows.map((r) => (
                      <tr key={r.requestId} data-testid="veil-row">
                        <td>{r.agentName}</td>
                        <td className="mono">{short(r.requester)}</td>
                        <td>{r.policyName ?? short(r.policyId)}</td>
                        <td className="mono sealed">{short(r.commitment)}</td>
                        <td className="result-cell">
                          <span className={`pill ${r.result === "pass" ? "pass" : r.result === "fail" ? "fail" : "pending"}`}>{r.result}</span>
                          <span className="sub">
                            {[r.tier, r.expired ? "expired" : null, r.treasuryExecuted ? "treasury action" : null, r.mirroredToERC8004 ? "mirrored" : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="sealed-list">
                {veil.hidden.map((h) => <li key={h}>Not on chain: {h}</li>)}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/** Ratings under plain ERC-8004 (rater, score and payment linked) and under Veil8004 (anonymous, per epoch). */
function RatingsSplit({ graph, feedback, sim }: { graph: PublicGraph; feedback: FeedbackView | null; sim: SimulatedFile | null }) {
  const simRaters = new Set((sim?.raters ?? []).map((a) => a.toLowerCase()));
  return (
    <section aria-label="Ratings split view">
      <h2>Ratings, two ways</h2>
      <div className="split">
        <div className="card" data-testid="plain-ratings">
          <h3>Plain ERC-8004</h3>
          <p className="sub">NewFeedback events: who rated whom, and what they paid</p>
          <div className="table-wrap">
            <table data-testid="feedback">
              <thead>
                <tr><th>Client</th><th>Agent</th><th>Score</th><th>Tags</th><th>Payment</th></tr>
              </thead>
              <tbody>
                {graph.feedback.length === 0 && (
                  <tr><td colSpan={5} className="sub">No plain ERC-8004 feedback on this chain yet.</td></tr>
                )}
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
        </div>

        <div className="card" data-testid="anon-ratings">
          <h3>Veil8004</h3>
          <p className="sub">FeedbackSubmitted / FeedbackAnchored events: Semaphore proofs from receipt holders</p>
          {feedback === null ? (
            <p>Receipts and anonymous feedback are not deployed on this chain yet.</p>
          ) : feedback.ratings.length === 0 ? (
            <p>
              No anonymous ratings yet ({feedback.receiptCount} receipt{feedback.receiptCount === 1 ? "" : "s"} issued). Run{" "}
              <code>make phase5</code>.
            </p>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Rater</th><th>Agent</th><th>Epoch</th><th>Score</th><th>Sent from</th></tr></thead>
                  <tbody>
                    {feedback.ratings.map((r) => (
                      <tr key={r.nullifier.toString()} data-testid="anon-rating">
                        <td className="sealed">
                          one of {r.anonymitySet}
                          {simRaters.has(r.sender.toLowerCase()) && <> <span className="sim-tag">simulated</span></>}
                        </td>
                        <td>{r.agentName}</td>
                        <td className="mono">{r.epoch.toString()}</td>
                        <td>{r.score}</td>
                        <td className={r.senderIsClient ? "mono leak" : "mono"}>
                          {short(r.sender)}
                          {r.senderIsClient ? " (client)" : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="table-wrap">
                <table data-testid="anon-aggregates">
                  <thead><tr><th>Agent</th><th>Epoch</th><th>Ratings</th><th>Average</th><th>Reputation Registry</th></tr></thead>
                  <tbody>
                    {feedback.aggregates.map((a) => (
                      <tr key={`${a.agentId}:${a.epoch}`}>
                        <td>{a.agentName}</td>
                        <td className="mono">{a.epoch.toString()}</td>
                        <td>{a.count}</td>
                        <td>{formatAverage(a.average)}</td>
                        <td>{a.anchoredValue !== null ? `anchored ${formatAverage(a.anchoredValue)}` : a.status === "closed" ? "closed, not anchored" : "window open"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="sealed-list">
                {feedback.hidden.map((h) => <li key={h}>Not on chain: {h}</li>)}
              </ul>
              {feedback.ratings.some((r) => r.anonymitySet < 5) && (
                <p className="sub">Small groups give weak anonymity: a rater here hides among at most {Math.max(...feedback.ratings.map((r) => r.anonymitySet))} receipt holders.</p>
              )}
            </>
          )}
        </div>
      </div>
      {feedback && feedback.leaks.length > 0 && (
        <>
          <h3>What Veil8004 receipts and ratings still show ({feedback.leaks.length} facts)</h3>
          <ul className="leaks" data-testid="anon-leaks">
            {feedback.leaks.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </>
      )}
    </section>
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
