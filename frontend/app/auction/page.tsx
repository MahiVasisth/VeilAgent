import { connection } from "next/server";
import { formatUnits } from "viem";
import { buildAuctionView, buildPublicGraph, fetchAuctionData, fetchPublicData, type AuctionView, type SimulatedFile } from "@veil8004/sdk";
import { deployment, publicClient, simulated as loadSimulated } from "../../lib/chain";
import { avatarStyle, formatDate, label, plural, relative, short } from "../../lib/format";
import { EmptyState, ErrorState, PageHeader, PrivacyReport } from "../components";
import { CheckIcon, LockIcon } from "../icons";
import { DemoInfo, SimDataBanner, SimDonBanner } from "../Nav";

export const metadata = { title: "Auctions" };

type Loaded = { view: AuctionView | null; simulated: boolean; sim: SimulatedFile | null; now: bigint };

async function load(): Promise<Loaded | { error: string }> {
  try {
    const d = deployment();
    const raw = await fetchAuctionData(publicClient, d);
    if (!raw) return { view: null, simulated: false, sim: null, now: 0n };
    const [pub, block] = await Promise.all([fetchPublicData(publicClient, d), publicClient.getBlock({ blockTag: "latest" })]);
    const graph = buildPublicGraph(pub);
    return { view: buildAuctionView(raw, new Map(graph.agents.map((a) => [a.agentId, a.name]))), simulated: d.veil?.forwarderIsMock ?? false, sim: loadSimulated(), now: block.timestamp };
  } catch (e) {
    return { error: e instanceof Error ? e.message.split("\n")[0]! : String(e) };
  }
}

const STATUS: Record<string, [string, string]> = {
  open: ["pending", "Accepting bids"],
  closed: ["pending", "Opening bids"],
  awarded: ["pass", "Hired"],
  completed: ["sealed", "Completed"],
};

/** The indexer prints prices in base units (18 decimals); show them the way the task cards do. */
const readable = (fact: string) => fact.replace(/ at (\d{19,})/, (_, n: string) => ` at ${formatUnits(BigInt(n), 18)}`);

const FILTERS = [
  { id: "all", label: "All", match: () => true },
  { id: "open", label: "Accepting bids", match: (s: string) => s === "open" },
  { id: "hired", label: "Hired", match: (s: string) => s === "closed" || s === "awarded" },
  { id: "completed", label: "Completed", match: (s: string) => s === "completed" },
] as const;

export default async function AuctionPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await connection(); // always read the chain at request time
  const [data, { status }] = await Promise.all([load(), searchParams]);
  const all = "error" in data || !data.view ? [] : [...data.view.tasks].sort((a, b) => Number(b.taskId - a.taskId));
  const filter = FILTERS.find((f) => f.id === status) ?? FILTERS[0];
  const tasks = all.filter((t) => filter.match(t.status));

  return (
    <main>
      <PageHeader
        eyebrow="Marketplace"
        title="Sealed-bid hiring"
        actions={<>{!("error" in data) && <DemoInfo>
            {data.simulated && (
              <SimDonBanner>
                Awards (W3) and qualifications (W1) on this chain were delivered by the local runner through a
                MockForwarder, not by a Chainlink CRE DON. Qualification uses a mock provider with a fictional credential
                list.
              </SimDonBanner>
            )}
            <SimDataBanner sim={data.sim} />
</DemoInfo>}
<a className="btn primary" href="/app">Post a task</a></>}
      >
        Every task as the public sees it. Bids stay sealed; only the winner's price opens.
      </PageHeader>

      {"error" in data ? (
        <ErrorState error={data.error} hint={<>Start the stack with <code>make app</code> or <code>KEEP=1 make phase3</code>.</>} />
      ) : data.view === null ? (
        <EmptyState title="Sealed-bid hiring isn't live on this network yet" />
      ) : (
        <>

          <div className="kpis page-kpis">
            <div className="kpi static"><span className="n">{all.length}</span><span className="l">Tasks</span></div>
            <div className="kpi static"><span className="n">{all.reduce((n, t) => n + t.bids.length, 0)}</span><span className="l">Sealed bids</span></div>
            <div className="kpi static"><span className="n">{all.filter((t) => t.award).length}</span><span className="l">Agents hired</span></div>
            <div className="kpi static"><span className="n sealed-n"><LockIcon size={20} /> {all.filter((t) => t.award).reduce((n, t) => n + t.bids.filter((b) => !b.winner).length, 0)}</span><span className="l">Losing prices kept secret</span></div>
          </div>

          <nav className="filter-tabs" aria-label="Filter tasks">
            {FILTERS.map((f) => (
              <a key={f.id} href={f.id === "all" ? "/auction" : `/auction?status=${f.id}`} className={f === filter ? "on" : undefined} aria-current={f === filter ? "page" : undefined}>
                {f.label} <span className="count">{all.filter((t) => f.match(t.status)).length}</span>
              </a>
            ))}
          </nav>

          {tasks.length === 0 && (
            <EmptyState title={all.length === 0 ? "No tasks yet" : `No tasks ${filter.label.toLowerCase()}`}>
              {all.length === 0 ? "Tasks posted from the app show up here." : <a href="/auction">Show all tasks</a>}
            </EmptyState>
          )}
          <div className="task-grid">
          {tasks.map((t) => {
            const [tone, text] = STATUS[t.status] ?? ["neutral", t.status];
            const policy = t.policyName ?? short(t.policyId);
            return (
              <section key={t.taskId.toString()} className="card task-card" data-testid="task">
                <div className="task-card-head">
                  <div>
                    <h2>
                      {label(t.categoryName ?? short(t.category))}
                      <span className="faint mono task-num">#{t.taskId.toString()}</span>
                    </h2>
                    <div className="task-sub">
                      <span className="avatar xs" style={avatarStyle(t.client)} />
                      <span className="mono">{short(t.client)}</span>
                      {data.sim?.taskIds.includes(t.taskId.toString()) && <span className="sim-tag" data-testid="sim-task">simulated client</span>}
                    </div>
                  </div>
                  <span className={`pill ${tone}`}>{text}</span>
                </div>

                <div className="task-facts">
                  <span title={policy}><ShieldMini /> Needs {label(policy)}</span>
                  <span title={formatDate(t.deadline)}>{t.status === "open" ? "Closes" : "Closed"} {relative(t.deadline, data.now)}</span>
                </div>

                {t.bids.length === 0 ? (
                  <p className="empty">No bids yet</p>
                ) : (
                  <ul className="envelopes">
                    {t.bids.map((b) => (
                      <li key={b.agentId.toString()} className={b.winner ? "win" : undefined} title={`Commitment ${short(b.commitment)} · sent by ${short(b.bidder)}`}>
                        <span className="avatar sm" style={avatarStyle(b.bidder)} />
                        <span className="env-name">{b.agentName}</span>
                        {b.winner && t.award ? (
                          <span className="env-price">{formatUnits(t.award.winningPrice, 18)}</span>
                        ) : (
                          <span className="env-sealed"><LockIcon size={12} /> Sealed</span>
                        )}
                        {b.inclusion === "counted" && <span className="env-check" title="Counted in the award"><CheckIcon size={12} /></span>}
                      </li>
                    ))}
                  </ul>
                )}

                {t.award && (
                  <p className="award-line-sm" data-testid="award">
                    <CheckIcon size={13} /> Awarded to <strong>{t.award.winnerName}</strong> at <strong>{formatUnits(t.award.winningPrice, 18)}</strong>
                    <span className="faint"> · lowest of {plural(t.award.validBidCount, "valid bid")}{t.bids.length > 1 ? `, ${plural(t.bids.length - 1, "price")} stay sealed` : ""}</span>
                  </p>
                )}

                {t.bids.length > 0 && (
                  <details className="proof">
                    <summary>On-chain proof</summary>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr><th>Agent</th><th>Sent by</th><th>Commitment</th><th>Price</th><th>Counted</th></tr>
                        </thead>
                        <tbody>
                          {t.bids.map((b) => (
                            <tr key={b.agentId.toString()} data-testid="bid-row" className={b.winner ? "winner" : undefined}>
                              <td><strong>{b.agentName}</strong></td>
                              <td className="mono">{short(b.bidder)}</td>
                              <td className="mono faint">{short(b.commitment)}</td>
                              <td className={b.winner ? "leak" : "sealed"}>
                                {b.winner && t.award ? `${formatUnits(t.award.winningPrice, 18)} (winner, public)` : "sealed"}
                              </td>
                              <td className={b.inclusion === "counted" ? "status-ok" : "faint"} data-testid="inclusion">{b.inclusion}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="fine">
                      Requirement <span className="mono">{policy}</span> · deadline {formatDate(t.deadline)}
                      {t.award && <> · Merkle root <span className="mono">{short(t.award.merkleRoot)}</span></>}
                    </p>
                    {t.award && (
                      <p className="fine">
                        The chain checked that the winner's price opens its commitment; that it was the lowest valid bid is
                        trusted to W3.
                      </p>
                    )}
                  </details>
                )}
              </section>
            );
          })}
          </div>

          <PrivacyReport
            title="What an observer learns"
            visible={[
              { k: "Who posted each task", v: `${plural(new Set(all.map((t) => t.client.toLowerCase())).size, "client")}, ${plural(all.length, "task")}` },
              { k: "Required qualification", v: [...new Set(all.map((t) => label(t.policyName ?? short(t.policyId))))].join(", ") || "—" },
              { k: "Which agent bid, from which wallet", v: plural(all.reduce((n, t) => n + t.bids.length, 0), "bid") },
              { k: "Winner and winning price", v: plural(all.filter((t) => t.award).length, "award") },
            ]}
            leaks={data.view.leaks.map(readable)}
            hidden={data.view.hidden}
            leaksTestid="leaks"
          />
        </>
      )}
    </main>
  );
}

const ShieldMini = () => (
  <svg viewBox="0 0 24 24" width={13} height={13} aria-hidden fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
  </svg>
);
