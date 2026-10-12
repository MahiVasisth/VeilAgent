import { connection } from "next/server";
import { buildCostView, fetchCostData, formatGas, type CostView } from "@veil8004/sdk";
import { deployment, publicClient, simulated as loadSimulated } from "../../lib/chain";
import { EmptyState, ErrorState, PageHeader } from "../components";
import { DemoInfo, SimDataBanner, SimDonBanner } from "../Nav";

export const metadata = { title: "Gas costs" };

async function load(): Promise<{ view: CostView; sim: ReturnType<typeof loadSimulated> } | { error: string }> {
  try {
    return { view: buildCostView(await fetchCostData(publicClient, deployment())), sim: loadSimulated() };
  } catch (e) {
    return { error: e instanceof Error ? e.message.split("\n")[0]! : String(e) };
  }
}

export default async function CostsPage() {
  await connection(); // always read the chain at request time
  const data = await load();
  return (
    <main>
      <PageHeader eyebrow="Transparency" title="What privacy costs in gas" actions={!("error" in data) && <DemoInfo>
            {data.view.forwarderIsMock && (
              <SimDonBanner>
                W1, W3 and W2 results were delivered through the MockForwarder, so their gas includes its overhead, not the
                CRE KeystoneForwarder's (which also verifies DON signatures).
              </SimDonBanner>
            )}
            <SimDataBanner sim={data.sim} />
</DemoInfo>}>
        Gas per operation, measured from real transactions on this network.
      </PageHeader>
      {"error" in data ? (
        <ErrorState error={data.error} hint={<>Run <code>KEEP=1 make demo</code>.</>} />
      ) : (
        <>
          <div className="kpis page-kpis">
            <div className="kpi static">
              <span className="n" data-testid="attestation-total">
                {data.view.attestationTotal === null ? "—" : `${formatGas(data.view.attestationTotal)}`}
              </span>
              <span className="l">Gas for one private attestation (request + result, medians)</span>
            </div>
            <div className="kpi static">
              <span className="n">{data.view.rows.length}</span>
              <span className="l">Operations measured</span>
            </div>
            <div className="kpi static">
              <span className="n">{data.view.rows.reduce((n, r) => n + r.count, 0)}</span>
              <span className="l">Transactions sampled</span>
            </div>
          </div>
          {data.view.rows.length === 0 ? (
            <EmptyState title="No transactions yet" />
          ) : (
            <div className="card table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Side</th><th>Operation</th><th>Call</th><th className="num">Tx</th>
                    <th className="num">Min</th><th className="num">Median</th><th className="num">Max</th>
                  </tr>
                </thead>
                <tbody>
                  {data.view.rows.map((r) => (
                    <tr key={r.op} data-testid="cost-row">
                      <td><span className={`pill ${r.side === "plain" ? "leak" : "sealed"}`}>{r.side === "plain" ? "ERC-8004" : "Veil8004"}</span></td>
                      <td><strong>{r.label}</strong></td>
                      <td className="mono faint">{r.what}</td>
                      <td className="num">{r.count}</td>
                      <td className="num">{formatGas(r.min)}</td>
                      <td className="num">{formatGas(r.median)}</td>
                      <td className="num">{formatGas(r.max)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="fine">
            A rating's gas is dominated by the on-chain Groth16 check in Semaphore. A receipt's grows with the group's
            Merkle tree. Proving a rating happens off-chain on the client and costs no gas.
          </p>
        </>
      )}
    </main>
  );
}
