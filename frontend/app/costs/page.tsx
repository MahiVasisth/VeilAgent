import { connection } from "next/server";
import { buildCostView, fetchCostData, formatGas, type CostView } from "@veil8004/sdk";
import { deployment, publicClient, RPC_URL, simulated as loadSimulated } from "../../lib/chain";
import { SimDataBanner } from "../Nav";

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
      <h1>Cost panel</h1>
      <p className="lede">
        Gas used per operation on local Anvil (<code>{RPC_URL}</code>), measured from the receipts of the transactions that
        emitted each public event. Gas only: what a unit of gas costs depends on the chain.
      </p>
      {"error" in data ? (
        <div className="card error">
          <strong>Could not read the chain.</strong> {data.error}
          <p>
            Run <code>KEEP=1 make demo</code>.
          </p>
        </div>
      ) : (
        <>
          <SimDataBanner sim={data.sim} />
          {data.view.forwarderIsMock && (
            <p className="sim-banner" data-testid="sim-banner">
              <strong>Simulated DON.</strong> W1, W3 and W2 results were delivered through the MockForwarder, so their gas
              includes its overhead, not the CRE KeystoneForwarder's (which also verifies DON signatures).
            </p>
          )}
          <div className="totals">
            <div className="card">
              <div className="sub">One private attestation (request + W1 result, medians)</div>
              <div className="big" data-testid="attestation-total">
                {data.view.attestationTotal === null ? "not measured yet" : `${formatGas(data.view.attestationTotal)} gas`}
              </div>
            </div>
          </div>
          {data.view.rows.length === 0 ? (
            <div className="card">No transactions yet.</div>
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
                      <td className={r.side === "plain" ? "side-plain" : "side-veil"}>{r.side === "plain" ? "ERC-8004" : "Veil8004"}</td>
                      <td>{r.label}</td>
                      <td className="mono">{r.what}</td>
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
          <p className="sub">
            A rating's gas is dominated by the on-chain Groth16 check in Semaphore. A receipt's grows with the group's
            Merkle tree. Proving a rating happens off-chain on the client and costs no gas.
          </p>
        </>
      )}
    </main>
  );
}
