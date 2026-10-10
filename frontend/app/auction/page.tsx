import { connection } from "next/server";
import { formatUnits } from "viem";
import { buildAuctionView, buildPublicGraph, fetchAuctionData, fetchPublicData, type AuctionView, type SimulatedFile } from "@veil8004/sdk";
import { deployment, publicClient, RPC_URL, simulated as loadSimulated } from "../../lib/chain";
import { SimDataBanner } from "../Nav";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

type Loaded = { view: AuctionView | null; simulated: boolean; sim: SimulatedFile | null };

async function load(): Promise<Loaded | { error: string }> {
  try {
    const d = deployment();
    const raw = await fetchAuctionData(publicClient, d);
    if (!raw) return { view: null, simulated: false, sim: null };
    const graph = buildPublicGraph(await fetchPublicData(publicClient, d));
    return { view: buildAuctionView(raw, new Map(graph.agents.map((a) => [a.agentId, a.name]))), simulated: d.veil?.forwarderIsMock ?? false, sim: loadSimulated() };
  } catch (e) {
    return { error: e instanceof Error ? e.message.split("\n")[0]! : String(e) };
  }
}

export default async function AuctionPage() {
  await connection(); // always read the chain at request time
  const data = await load();

  return (
    <main>
      <h1>Sealed-bid hiring</h1>
      <p className="lede">
        SealedBidHiring on local Anvil (<code>{RPC_URL}</code>), rebuilt from public events and transactions only. Bids
        are commitments; only the winning price is ever opened. Agent names, credentials and prices are fictional demo
        data, in base units of an 18-decimal demo token.
      </p>

      {"error" in data ? (
        <div className="card error">
          <strong>Could not read the chain.</strong> {data.error}
          <p>
            Run <code>KEEP=1 make phase3</code>.
          </p>
        </div>
      ) : data.view === null ? (
        <div className="card">SealedBidHiring is not deployed on this chain yet.</div>
      ) : (
        <>
          {data.simulated && (
            <p className="sim-banner" data-testid="sim-banner">
              <strong>Simulated DON.</strong> Awards (W3) and qualifications (W1) on this chain were delivered by the local
              runner through a MockForwarder, not by a Chainlink CRE DON. Qualification uses a mock provider with a
              fictional credential list.
            </p>
          )}
          <SimDataBanner sim={data.sim} />
          {data.view.tasks.length === 0 && <div className="card">No tasks yet.</div>}
          {data.view.tasks.map((t) => (
            <section key={t.taskId.toString()} className="card" data-testid="task">
              <h2>
                Task #{t.taskId.toString()} · {t.status}
                {data.sim?.taskIds.includes(t.taskId.toString()) && (
                  <> <span className="sim-tag" data-testid="sim-task">simulated client</span></>
                )}
              </h2>
              <p className="sub">
                Client <span className="mono">{short(t.client)}</span> · category {t.categoryName ?? short(t.category)} · bidders
                must hold {t.policyName ?? short(t.policyId)} · deadline {new Date(Number(t.deadline) * 1000).toISOString()}
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Agent</th><th>Bid sent by</th><th>Bid (commitment)</th><th>Price</th><th>Inclusion check</th></tr>
                  </thead>
                  <tbody>
                    {t.bids.map((b) => (
                      <tr key={b.agentId.toString()} data-testid="bid-row">
                        <td>{b.agentName}</td>
                        <td className="mono leak">{short(b.bidder)}</td>
                        <td className="mono sealed">{short(b.commitment)}</td>
                        <td className={b.winner ? "leak" : "sealed"}>
                          {b.winner && t.award ? `${formatUnits(t.award.winningPrice, 18)} (winner, public)` : "sealed"}
                        </td>
                        <td data-testid="inclusion">{b.inclusion}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {t.award && (
                <p data-testid="award">
                  Awarded to <strong>{t.award.winnerName}</strong> at {formatUnits(t.award.winningPrice, 18)};{" "}
                  {t.award.validBidCount} of {t.bids.length} bids counted; Merkle root{" "}
                  <span className="mono">{short(t.award.merkleRoot)}</span>. The chain checked that the winner's price
                  opens its commitment; that it was the lowest valid bid is trusted to W3.
                </p>
              )}
            </section>
          ))}

          <h2>What leaks ({data.view.leaks.length} facts)</h2>
          <ul className="leaks" data-testid="leaks">
            {data.view.leaks.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
          <ul className="sealed-list">
            {data.view.hidden.map((h) => <li key={h}>Not on chain: {h}</li>)}
          </ul>
        </>
      )}
    </main>
  );
}
