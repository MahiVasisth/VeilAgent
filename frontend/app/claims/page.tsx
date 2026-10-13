import { readFileSync } from "node:fs";
import path from "node:path";
import { claimKind, parseClaimsTable, type Claim } from "@veil8004/sdk";
import { PageHeader } from "../components";

export const metadata = { title: "Security claims" };

// Read from the README's "Claims and limits" table at build time: the page claims exactly what the README does.
const CLAIMS_SOURCE = path.resolve(process.cwd(), "../README.md");

function load(): Claim[] | { error: string } {
  try {
    return parseClaimsTable(readFileSync(CLAIMS_SOURCE, "utf8"));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const LABEL = { yes: "✔", no: "✘", partial: "~" } as const;
const PILL = { yes: "pass", no: "fail", partial: "pending" } as const;

export default function ClaimsPage() {
  const claims = load();
  return (
    <main>
      <PageHeader eyebrow="Security" title="What we claim, and what we don't">
        Every privacy property, stated plainly, straight from the README's claims table.
      </PageHeader>
      {"error" in claims ? (
        <div className="card error">Could not read the claims table: {claims.error}</div>
      ) : (
        <>
        <div className="kpis page-kpis">
          {(["yes", "partial", "no"] as const).map((k) => (
            <div key={k} className="kpi static">
              <span className={`n claim-${k}`}>{claims.filter((c) => claimKind(c.claimed) === k).length}</span>
              <span className="l">{k === "yes" ? "Claimed" : k === "partial" ? "Partly, or with conditions" : "Not claimed"}</span>
            </div>
          ))}
        </div>
        <div className="card table-wrap">
          <table>
            <thead>
              <tr><th></th><th>Property</th><th>Claimed?</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {claims.map((c) => {
                const kind = claimKind(c.claimed);
                return (
                  <tr key={c.property} data-testid="claim-row">
                    <td className={`claim-${kind}`} aria-hidden>{LABEL[kind]}</td>
                    <td><strong>{c.property}</strong></td>
                    <td><span className={`pill ${PILL[kind]} wrap`}>{c.claimed}</span></td>
                    <td className="sub">{c.notes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </main>
  );
}
