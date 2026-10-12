import { connection } from "next/server";
import {
  type SimulatedFile,
  buildAuctionView,
  buildFeedbackView,
  buildPublicGraph,
  buildVeilView,
  fetchAuctionData,
  fetchFeedbackData,
  fetchPublicData,
  fetchVeilData,
  formatAverage,
  type FeedbackView,
  type PublicGraph,
  type VeilView,
} from "@veil8004/sdk";
import { deployment, publicClient, simulated as loadSimulated } from "../../lib/chain";
import { avatarStyle, label, plural, short } from "../../lib/format";
import { ErrorState, PageHeader, RawFacts } from "../components";
import { EyeIcon, LockIcon } from "../icons";
import { LeakGraph } from "./LeakGraph";
import { Tabs } from "./Tabs";
import { buildActivity, type ActivityEvent } from "../../lib/activity";
import { ActivityFeed, AgentDirectory, type AgentRow } from "./ExplorerApp";
import { DemoInfo, SimDataBanner, SimDonBanner } from "../Nav";

export const metadata = { title: "Explorer" };
const result = (r: number | null) => (r === null ? "pending" : r === 100 ? "pass" : r === 0 ? "fail" : `${r}/100`);

type Loaded = {
  graph: PublicGraph;
  veil: VeilView | null;
  feedback: FeedbackView | null;
  veilRegistry: string | null;
  simulated: boolean;
  sim: SimulatedFile | null;
  events: ActivityEvent[];
  agents: AgentRow[];
  now: number;
  latestBlock: number;
};

async function load(): Promise<Loaded | { error: string }> {
  try {
    const d = deployment();
    const rawPublic = await fetchPublicData(publicClient, d);
    // The averages AnonymousFeedback anchors are NewFeedback events too; they belong to the Veil8004 side.
    const anon = d.veil?.anonymousFeedback?.toLowerCase();
    const graph = buildPublicGraph({ ...rawPublic, feedback: rawPublic.feedback.filter((f) => f.client.toLowerCase() !== anon) });
    const [raw, rawFeedback, rawAuction, block] = await Promise.all([
      fetchVeilData(publicClient, d),
      fetchFeedbackData(publicClient, d),
      fetchAuctionData(publicClient, d),
      publicClient.getBlock({ blockTag: "latest" }),
    ]);
    const names = new Map(graph.agents.map((a) => [a.agentId, a.name]));
    const veil = raw ? buildVeilView(raw, names) : null;
    const feedback = rawFeedback ? buildFeedbackView(rawFeedback, names) : null;
    const auction = rawAuction ? buildAuctionView(rawAuction, names) : null;
    const veilRegistry = d.veil?.privateValidationRegistry ?? null;
    const events = await buildActivity(publicClient, { graph, rawPublic, rawVeil: raw, veil, rawAuction, auction, rawFeedback, feedback, veilRegistry });
    const agents: AgentRow[] = graph.agents.map((a) => {
      const q = veil?.rows.find((r) => r.agentId === a.agentId && r.agentLevel && r.policyName === "QUALIFIED_SCREENER_V1");
      const agg = (feedback?.aggregates ?? []).filter((x) => x.agentId === a.agentId);
      const count = agg.reduce((n, x) => n + x.count, 0);
      const last = events.filter((e) => e.agent === a.name && e.block !== null).map((e) => e.block!);
      return {
        id: a.agentId.toString(),
        name: a.name,
        owner: a.owner,
        qualification: !q ? "none" : q.result === "pending" ? "pending" : q.result === "fail" ? "rejected" : q.expired ? "expired" : "qualified",
        bids: (auction?.tasks ?? []).reduce((n, t) => n + t.bids.filter((b) => b.agentId === a.agentId).length, 0),
        wins: (auction?.tasks ?? []).filter((t) => t.award?.winnerAgentId === a.agentId).length,
        plainRatings: graph.feedback.filter((f) => f.agentId === a.agentId).map((f) => Number(f.score)),
        anonAverage: agg.length ? formatAverage(agg[agg.length - 1]!.anchoredValue ?? agg[agg.length - 1]!.average) : null,
        anonCount: count,
        lastBlock: last.length ? Math.max(...last) : null,
      };
    });
    return {
      graph,
      veil,
      feedback,
      veilRegistry,
      simulated: d.veil?.forwarderIsMock ?? false,
      sim: loadSimulated(),
      events,
      agents,
      now: Number(block.timestamp),
      latestBlock: Number(block.number),
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
      <PageHeader eyebrow="Explorer" title="Network explorer" actions={!("error" in data) && <DemoInfo>
            {data.simulated && (
              <SimDonBanner>
                Veil8004 results on this chain were delivered by the local runner through a MockForwarder, not by a
                Chainlink CRE DON. Screening uses a mock API with a fictional list.
              </SimDonBanner>
            )}
            <SimDataBanner sim={data.sim} />
</DemoInfo>}>
        Everything an outside observer can read, rebuilt from public chain data only.
      </PageHeader>

      {"error" in data ? (
        <ErrorState error={data.error} hint={<>Start Anvil and run the baseline: <code>make phase1</code>.</>} />
      ) : (
        <>
          <StatStrip data={data} />
          <Tabs
            tabs={[
              { id: "activity", label: "Activity", count: data.events.length },
              { id: "agents", label: "Agents", count: data.agents.length },
              { id: "exposed", label: "Privacy check" },
              { id: "screenings", label: "Screenings: public vs private" },
              { id: "ratings", label: "Ratings: public vs private" },
            ]}
          >
            <ActivityFeed events={data.events} now={data.now} />
            <AgentDirectory agents={data.agents} />
            <div>
              <Scoreboard data={data} />
              <h2 className="section-h first" id="graph">What plain ERC-8004 gives away</h2>
              <p className="sub section-sub">Two ordinary hires, rebuilt by anyone from public events.</p>
              <Graph graph={data.graph} />
            </div>
            <Split data={data} />
            <RatingsSplit graph={data.graph} feedback={data.feedback} sim={data.sim} />
          </Tabs>
        </>
      )}
    </main>
  );
}

/** Standard validations, minus the ERC-8004 mirrors of Veil8004 results (those belong to the Veil8004 side). */
const plainOf = ({ graph, veilRegistry }: Loaded) => graph.validations.filter((v) => v.validator.toLowerCase() !== veilRegistry?.toLowerCase());

/** Network totals, explorer-style. */
function StatStrip({ data }: { data: Loaded }) {
  const n = (k: string[]) => data.events.filter((e) => k.includes(e.kind)).length;
  const stats = [
    { l: "Latest block", v: data.latestBlock.toLocaleString("en-US") },
    { l: "Agents", v: data.agents.length },
    { l: "Transactions", v: new Set(data.events.map((e) => e.txHash)).size },
    { l: "Screenings", v: n(["screening"]) },
    { l: "Sealed bids", v: n(["bid"]) },
    { l: "Ratings", v: n(["rating"]) },
  ];
  return (
    <div className="stat-strip card">
      {stats.map((s, i) => (
        <div key={s.l}>
          <span className="faint">{s.l}</span>
          <strong className={i === 0 ? "mono" : undefined}>{s.v}</strong>
        </div>
      ))}
      <span className="stat-live"><span className="live" /> Live</span>
    </div>
  );
}

/** The page in one glance: what each side lets an observer read. */
function Scoreboard({ data }: { data: Loaded }) {
  const plain = plainOf(data);
  const paid = data.graph.feedback.filter((f) => f.payment).length;
  const veilRows = data.veil?.rows.length ?? 0;
  const ratings = data.feedback?.ratings ?? [];
  const crowd = ratings.length ? Math.max(...ratings.map((r) => r.anonymitySet)) : 0;
  return (
    <div className="scoreboard">
      <div className="score plain">
        <span className="score-label"><EyeIcon size={15} /> Plain ERC-8004</span>
        <div className="score-rows">
          <div><b>{plain.length}</b><span>screenings with the name in the clear</span></div>
          <div><b>{paid}</b><span>payments tied to a client wallet</span></div>
          <div><b>{data.graph.feedback.length}</b><span>ratings signed by the client</span></div>
        </div>
      </div>
      <div className="score veil">
        <span className="score-label"><LockIcon size={15} /> Veil8004</span>
        <div className="score-rows">
          <div><b>{veilRows}</b><span>screenings, <strong>0</strong> names exposed</span></div>
          <div><b>{ratings.length}</b><span>ratings, rater hidden{crowd ? ` among up to ${crowd}` : ""}</span></div>
          <div><b>0</b><span>losing bid prices on-chain</span></div>
        </div>
      </div>
    </div>
  );
}

/** The same kind of interaction (screen a counterparty for an agent) under plain ERC-8004 and under Veil8004. */
function Split({ data }: { data: Loaded }) {
  const { veil } = data;
  const plain = plainOf(data);
  return (
    <section aria-label="Split view" id="screenings">
      <h2 className="section-h first">Screenings, two ways</h2>
      <p className="sub section-sub">A client screens a counterparty before hiring an agent.</p>
      <div className="split">
        <div className="card side-card" data-testid="plain-view">
          <SideHead kind="plain" title="Plain ERC-8004" sub="Who was screened, in the clear" count={plain.length} />
          {plain.length === 0 && <p className="empty">No plain ERC-8004 validations on this chain yet.</p>}
          <ul className="items">
            {plain.map((v) => {
              const input = (v.request as { input?: { subject?: string } } | null)?.input;
              return (
                <li key={v.requestHash}>
                  <span className="avatar sm" style={avatarStyle(v.requester)} />
                  <span className="item-main">
                    <strong className="leak">{input?.subject ?? JSON.stringify(input ?? v.request)}</strong>
                    <span className="sub">for {v.agentName} · by {short(v.requester)}</span>
                    <code className="item-raw leak">{JSON.stringify(input ?? v.request)}</code>
                  </span>
                  <ResultPill r={result(v.response)} />
                </li>
              );
            })}
          </ul>
          {plain.length > 0 && <p className="side-foot leak-foot"><EyeIcon size={13} /> The counterparty's name is readable by anyone, forever.</p>}
        </div>

        <div className="card side-card" data-testid="veil-view">
          <SideHead kind="veil" title="Veil8004" sub="Only a salted fingerprint and the result" count={veil?.rows.length ?? 0} />
          {veil === null ? (
            <p className="empty">Veil8004 is not deployed on this chain yet.</p>
          ) : veil.rows.length === 0 ? (
            <p className="empty">No private validations yet.</p>
          ) : (
            <>
              <ul className="items">
                {veil.rows.map((r) => (
                  <li key={r.requestId} data-testid="veil-row">
                    <span className="avatar sm" style={avatarStyle(r.requester)} />
                    <span className="item-main">
                      <strong className="sealed-text"><LockIcon size={12} /> {short(r.commitment)}</strong>
                      <span className="sub" title={r.policyName ?? r.policyId}>
                        {r.policyName ? label(r.policyName) : short(r.policyId)} for {r.agentName} · by {short(r.requester)}
                      </span>
                    </span>
                    <span className="item-end">
                      <ResultPill r={r.result} />
                      {(r.expired || r.treasuryExecuted) && (
                        <span className="faint item-note">{[r.expired ? "expired" : null, r.treasuryExecuted ? "payout made" : null].filter(Boolean).join(" · ")}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <NeverOnChain items={veil.hidden} />
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
    <section aria-label="Ratings split view" id="ratings">
      <h2 className="section-h first">Ratings, two ways</h2>
      <p className="sub section-sub">A client rates the agent after the job is done.</p>
      <div className="split">
        <div className="card side-card" data-testid="plain-ratings">
          <SideHead kind="plain" title="Plain ERC-8004" sub="Who rated whom, and what they paid" count={graph.feedback.length} />
          {graph.feedback.length === 0 && <p className="empty">No plain ERC-8004 feedback on this chain yet.</p>}
          <ul className="items" data-testid="feedback">
            {graph.feedback.map((f, i) => (
              <li key={i}>
                <span className="avatar sm" style={avatarStyle(f.client)} />
                <span className="item-main">
                  <strong><span className="mono leak">{short(f.client)}</span> rated {f.agentName}</strong>
                  <span className="sub">{[f.tag1, f.tag2].filter(Boolean).map(label).join(" · ")}{f.payment && <> · paid <span className="leak">{f.payment.amountEth} ETH</span></>}</span>
                </span>
                <span className="item-score leak">{f.score}<small>/100</small></span>
              </li>
            ))}
          </ul>
          {graph.feedback.length > 0 && <p className="side-foot leak-foot"><EyeIcon size={13} /> Each rating is signed by the client's own wallet.</p>}
        </div>

        <div className="card side-card" data-testid="anon-ratings">
          <SideHead kind="veil" title="Veil8004" sub="Each rating proves &quot;one of this agent's clients&quot;, never which" count={feedback?.ratings.length ?? 0} />
          {feedback === null ? (
            <p className="empty">Receipts and anonymous feedback are not deployed on this chain yet.</p>
          ) : feedback.ratings.length === 0 ? (
            <p className="empty">
              No anonymous ratings yet ({feedback.receiptCount} receipt{feedback.receiptCount === 1 ? "" : "s"} issued).
            </p>
          ) : (
            <>
              <ul className="items">
                {feedback.ratings.map((r) => (
                  <li key={r.nullifier.toString()} data-testid="anon-rating">
                    <span className="crowd" aria-hidden>{Array.from({ length: Math.min(r.anonymitySet, 7) }, (_, i) => <i key={i} />)}</span>
                    <span className="item-main">
                      <strong className="sealed-text">
                        one of {r.anonymitySet} rated {r.agentName}
                        {simRaters.has(r.sender.toLowerCase()) && <> <span className="sim-tag">simulated</span></>}
                      </strong>
                      <span className={r.senderIsClient ? "sub leak" : "sub"}>
                        sent from <span className="mono">{short(r.sender)}</span>
                        {r.senderIsClient ? " (client)" : " · not linked to any client"}
                      </span>
                    </span>
                    <span className="item-score sealed-text">{r.score}<small>/5</small></span>
                  </li>
                ))}
              </ul>

              <div className="subhead">Published to the agent's public reputation</div>
              <ul className="items compact" data-testid="anon-aggregates">
                {feedback.aggregates.map((a) => (
                  <li key={`${a.agentId}:${a.epoch}`}>
                    <span className="item-main">
                      <strong>{a.agentName} · ★ {formatAverage(a.average)}</strong>
                      <span className="sub">average of {plural(a.count, "rating")} · rating period {a.epoch.toString()}</span>
                    </span>
                    <span className={`pill ${a.anchoredValue !== null ? "pass" : "neutral"}`}>
                      {a.anchoredValue !== null ? `anchored ${formatAverage(a.anchoredValue)}` : a.status === "closed" ? "closed, not anchored" : "window open"}
                    </span>
                  </li>
                ))}
              </ul>
              <NeverOnChain items={feedback.hidden} />
              {feedback.ratings.some((r) => r.anonymitySet < 5) && (
                <p className="fine">Small groups give weak anonymity: a rater here hides among at most {Math.max(...feedback.ratings.map((r) => r.anonymitySet))} receipt holders.</p>
              )}
            </>
          )}
        </div>
      </div>
      {feedback && feedback.leaks.length > 0 && (
        <div className="residual">
          <RawFacts facts={feedback.leaks} testid="anon-leaks" what="facts Veil8004 receipts and ratings still show" />
        </div>
      )}
    </section>
  );
}

function SideHead({ kind, title, sub, count }: { kind: "plain" | "veil"; title: string; sub: string; count: number }) {
  return (
    <div className={`side-head ${kind}`}>
      <span className="side-icon">{kind === "plain" ? <EyeIcon size={16} /> : <LockIcon size={16} />}</span>
      <div>
        <h3>{title} <span className={`pill ${kind === "plain" ? "leak" : "sealed"}`}>{kind === "plain" ? "public" : "private"}</span></h3>
        <p className="sub">{sub}</p>
      </div>
      <span className="side-count">{count}</span>
    </div>
  );
}

const ResultPill = ({ r }: { r: string }) => <span className={`pill ${r === "pass" ? "pass" : r === "fail" ? "fail" : "pending"}`}>{r}</span>;

/** What never reaches the chain, as a light footer list. */
function NeverOnChain({ items }: { items: string[] }) {
  return (
    <div className="never">
      <span className="never-label"><LockIcon size={13} /> Never on-chain</span>
      <ul className="sealed-list">
        {items.map((h) => <li key={h}>{h}</li>)}
      </ul>
    </div>
  );
}

function Graph({ graph }: { graph: PublicGraph }) {
  return (
    <>
      <Profiles graph={graph} />

      <h3 className="graph-h">Who is connected to whom</h3>
      <section className="card graph" data-testid="leak-graph">
        <LeakGraph nodes={graph.nodes} edges={graph.edges} />
        <div className="legend">
          <span><span className="dot" style={{ background: "var(--client)" }} />payment</span>
          <span><span className="dot" style={{ background: "var(--leak)" }} />rating</span>
          <span><span className="dot" style={{ background: "var(--validator)" }} />screening</span>
          <span className="faint">Hover a line for the raw event</span>
        </div>
      </section>

      <details className="raw-facts raw-tables">
        <summary>Show the raw tables (validations and registered agents)</summary>
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
        <div className="table-wrap card">
          <table>
            <thead><tr><th>Id</th><th>Name</th><th>Owner</th></tr></thead>
            <tbody>
              {graph.agents.map((a) => (
                <tr key={a.agentId.toString()}><td className="mono">#{a.agentId.toString()}</td><td>{a.name}</td><td className="mono">{short(a.owner)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

/** For each plain ERC-8004 client, the profile any observer can assemble from public events: whom they screened,
 *  whom they hired, what they paid, how they rated. The raw facts stay available underneath. */
function Profiles({ graph }: { graph: PublicGraph }) {
  const clients = [...new Set(graph.feedback.map((f) => f.client.toLowerCase()))];
  const subject = (v: PublicGraph["validations"][number]) => {
    const r = v.request as { input?: { subject?: string } } | null;
    return r?.input?.subject ?? JSON.stringify(r?.input ?? v.request);
  };
  const ofClient = (c: string) =>
    graph.validations.filter((v) => String((v.request as { client?: string } | null)?.client ?? "").toLowerCase().endsWith(c));
  return (
    <section className="profiles">
      <div className="profiles-head">
        <h3><span className="pill leak">Public</span> The profile anyone can build of each client</h3>
        <span className="sub">Assembled from {graph.leaks.length} public facts, no keys needed.</span>
      </div>
      <div className="profile-grid">
        {clients.map((c) => {
          const fb = graph.feedback.filter((f) => f.client.toLowerCase() === c);
          const vs = ofClient(c);
          return (
            <div key={c} className="card profile">
              <div className="profile-who">
                <span className="avatar" style={avatarStyle(c)} />
                <div>
                  <strong className="mono">client {short(c)}</strong>
                  <span className="sub">fully traceable</span>
                </div>
              </div>
              <ol className="profile-trail">
                {vs.map((v) => (
                  <li key={v.requestHash}>
                    <span className="k">Screened</span>
                    <span className="v">{subject(v)} <span className={`pill ${v.response === 100 ? "pass" : v.response === 0 ? "fail" : "pending"}`}>{result(v.response)}</span></span>
                  </li>
                ))}
                {fb.map((f, i) => (
                  <li key={i}>
                    <span className="k">Hired</span>
                    <span className="v">{f.agentName}{f.payment && <> for <strong>{f.payment.amountEth} ETH</strong></>}</span>
                  </li>
                ))}
                {fb.map((f, i) => (
                  <li key={`r${i}`}>
                    <span className="k">Rated</span>
                    <span className="v">{f.agentName} <strong>{f.score}/100</strong></span>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
      <RawFacts facts={graph.leaks} testid="leaks" />
    </section>
  );
}
