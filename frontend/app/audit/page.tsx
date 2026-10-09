import { connection } from "next/server";
import { buildPublicGraph, buildVeilView, fetchPublicData, fetchVeilData } from "@veil8004/sdk";
import { deployment, publicClient, RPC_URL } from "../../lib/chain";
import { AuditForm, type SealedRow } from "./AuditForm";

type Loaded = { rows: SealedRow[] | null; simulated: boolean };

async function load(): Promise<Loaded | { error: string }> {
  try {
    const d = deployment();
    const raw = await fetchVeilData(publicClient, d);
    if (!raw) return { rows: null, simulated: false };
    const graph = buildPublicGraph(await fetchPublicData(publicClient, d));
    const view = buildVeilView(raw, new Map(graph.agents.map((a) => [a.agentId, a.name])));
    const rows = view.rows.map((r) => ({
      requestId: r.requestId,
      agentName: r.agentName,
      requester: r.requester,
      policy: r.policyName ?? r.policyId,
      commitment: r.commitment,
      result: `${r.result}${r.tier ? ` · ${r.tier}` : ""}${r.expired ? " · expired" : ""}`,
    }));
    return { rows, simulated: d.veil?.forwarderIsMock ?? false };
  } catch (e) {
    return { error: e instanceof Error ? e.message.split("\n")[0]! : String(e) };
  }
}

export default async function AuditPage() {
  await connection(); // always read the chain at request time
  const data = await load();

  return (
    <main>
      <nav>
        <a href="/indexer">Indexer view</a>
        <a href="/auction">Auction view</a>
        <a href="/audit">Audit</a>
      </nav>
      <h1>Selective disclosure</h1>
      <p className="lede">
        PrivateValidationRegistry on local Anvil (<code>{RPC_URL}</code>). A requester can open one of its own
        validations to an auditor by handing over that request's input and salt. The auditor recomputes the commitment and
        compares it, the policy and the result with the chain. Nothing goes on-chain, and every other request stays sealed.
        Entity names are fictional demo data.
      </p>

      {"error" in data ? (
        <div className="card error">
          <strong>Could not read the chain.</strong> {data.error}
          <p>
            Run <code>KEEP=1 make phase4</code>.
          </p>
        </div>
      ) : data.rows === null ? (
        <div className="card">Veil8004 is not deployed on this chain yet.</div>
      ) : (
        <>
          {data.simulated && (
            <p className="sim-banner" data-testid="sim-banner">
              <strong>Simulated DON.</strong> Results on this chain were delivered by the local runner through a
              MockForwarder, not by a Chainlink CRE DON. Disclosure itself needs no DON.
            </p>
          )}
          <AuditForm rows={data.rows} />
        </>
      )}
    </main>
  );
}
