"use client";
import { useRef, useState } from "react";
import { download, updateVault, type Vault } from "../../lib/app/vault";
import { Explain } from "./ui";
import type { Veil } from "./useVeil";

export function SecretsSection({ veil }: { veil: Veil }) {
  const { vault, scope } = veil;
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <section className="card" data-testid="secrets">
      <h2>My secrets (this browser only)</h2>
      <Explain>
        These never leave this browser unless you export them. Without a request's input and salt you cannot disclose it
        to an auditor; without a task's identity you cannot rate the agent. Clearing site data deletes them.
      </Explain>
      <ul>
        <li>{vault.openings.length} validation opening{vault.openings.length === 1 ? "" : "s"} (input + salt)</li>
        <li>{vault.bids.length} bid opening{vault.bids.length === 1 ? "" : "s"} (price + salt)</li>
        <li>{vault.identities.length} anonymous identit{vault.identities.length === 1 ? "y" : "ies"} (one per task)</li>
      </ul>
      <div className="actions">
        <button onClick={() => download(`veil8004-secrets-${scope.split(":")[0]}.json`, JSON.stringify({ scope, ...vault }, null, 2))}>Export all</button>
        <button onClick={() => file.current?.click()}>Import…</button>
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
              setMsg("Imported.");
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
