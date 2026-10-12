import { connection } from "next/server";
import { buildPublicGraph, buildVeilView, fetchPublicData, fetchVeilData } from "@veil8004/sdk";
import { deployment, publicClient } from "../../lib/chain";
import { EmptyState, ErrorState, PageHeader } from "../components";
import { DemoInfo, SimDonBanner } from "../Nav";
import { AuditForm, type SealedRow } from "./AuditForm";

export const metadata = { title: "Verify a disclosure" };

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
      <PageHeader eyebrow="Auditor tools" title="Selective disclosure" actions={!("error" in data) && <DemoInfo>
{data.simulated && (
              <SimDonBanner>
                Results on this chain were delivered by the local runner through a MockForwarder, not by a Chainlink CRE
                DON. Disclosure itself needs no DON.
              </SimDonBanner>
)}
</DemoInfo>}>
        Got a disclosure bundle? Check that one screening against the chain. Everything else stays sealed.
      </PageHeader>

      {"error" in data ? (
        <ErrorState error={data.error} hint={<>Start the stack with <code>make app</code> or <code>KEEP=1 make phase4</code>.</>} />
      ) : data.rows === null ? (
        <EmptyState title="Private validation isn't live on this network yet" />
      ) : (
        <>
          <AuditForm rows={data.rows} />
        </>
      )}
    </main>
  );
}
