"use client";
import { useRef, useState } from "react";
import { download, updateVault, type Vault } from "../../lib/app/vault";
import { CardHead } from "./ui";
import type { Veil } from "./useVeil";

export function SecretsSection({ veil }: { veil: Veil }) {
  const { vault, scope } = veil;
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <section className="card" data-testid="secrets">
      <CardHead
        title="Stored in this browser"
        sub="Your keys live only in this browser. Export a backup before clearing site data."
      />
      <div className="kpis">
        <div className="kpi static"><span className="n">{vault.openings.length}</span><span className="l">Screening keys</span></div>
        <div className="kpi static"><span className="n">{vault.bids.length}</span><span className="l">Bid keys</span></div>
        <div className="kpi static"><span className="n">{vault.identities.length}</span><span className="l">Anonymous identities</span></div>
      </div>
      <div className="actions">
        <button className="primary" onClick={() => download(`veil8004-secrets-${scope.split(":")[0]}.json`, JSON.stringify({ scope, ...vault }, null, 2))}>Export backup</button>
        <button onClick={() => file.current?.click()}>Restore from file…</button>
        <input
          ref={file}
          type="file"
          accept="application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const imported = JSON.parse(await f.text()) as Vault & { scope: string };
              if (imported.scope !== scope) throw new Error("that export is from another chain or deployment");
              updateVault(scope, (v) => {
                const merge = <T,>(a: T[], b: T[], k: (x: T) => string) => [...new Map([...a, ...b].map((x) => [k(x), x])).values()];
                v.openings = merge(v.openings, imported.openings, (x) => x.requestId);
                v.bids = merge(v.bids, imported.bids, (x) => x.commitment);
                v.identities = merge(v.identities, imported.identities, (x) => x.commitment);
              });
              veil.reloadVault();
              setMsg("Backup restored.");
            } catch (err) {
              setMsg(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          }}
        />
      </div>
      {msg && <p className="sub">{msg}</p>}
    </section>
  );
}
