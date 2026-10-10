import { readFileSync } from "node:fs";
import path from "node:path";
import { claimKind, parseClaimsTable, type Claim } from "@veil8004/sdk";

// Read from docs/threat-model.md at build time: the page claims exactly what the document does.
const THREAT_MODEL = path.resolve(process.cwd(), "../docs/threat-model.md");

function load(): Claim[] | { error: string } {
  try {
    return parseClaimsTable(readFileSync(THREAT_MODEL, "utf8"));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const LABEL = { yes: "✔", no: "✘", partial: "~" } as const;

export default function ClaimsPage() {
  const claims = load();
  return (
    <main>
      <h1>Claims and limits</h1>
      <p className="lede">
        What Veil8004 claims, and what it does not. This table is read from <code>docs/threat-model.md</code>; the README,
        the demo and these pages claim nothing beyond it. Rows marked "Only with a Confidential Workflow" are designed, not
        demoed: the demo runs a simulated DON locally.
      </p>
      {"error" in claims ? (
        <div className="card error">Could not read the claims table: {claims.error}</div>
      ) : (
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
                    <td>{c.property}</td>
                    <td className={`claim-${kind}`}>{c.claimed}</td>
                    <td>{c.notes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
