"use client";
// Paste a disclosure bundle, verify it against the chain, and see which row it opens. Everything else stays sealed.
import { useState } from "react";

export type SealedRow = { requestId: string; agentName: string; requester: string; policy: string; commitment: string; result: string };

type Report = {
  valid: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
  request: { requestId: string; input: string; result: string; tier: string | null; policyTier: string | null; expiry: string | null; expired: boolean; currentlyValid: boolean } | null;
  learned: string[];
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function AuditForm({ rows }: { rows: SealedRow[] }) {
  const [text, setText] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch("/audit/verify", { method: "POST", body: text });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? `HTTP ${res.status}`);
      else setReport(body as Report);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const opened = report?.valid ? report.request : null;
  return (
    <>
      <section className="card">
        <label htmlFor="bundle"><strong>Disclosure bundle</strong> (JSON from the requester)</label>
        <textarea
          id="bundle"
          className="mono bundle-input"
          rows={10}
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='{"version":"veil8004-disclosure/1","chainId":31337,"registry":"0x…","requestId":"0x…","agentId":"0","policyId":"0x…","input":"…","salt":"0x…"}'
        />
        <button type="button" onClick={verify} disabled={busy || !text.trim()}>{busy ? "Verifying…" : "Verify"}</button>
        <p className="sub">The bundle goes to this page's own server, which reads the chain (eth_call only) and keeps nothing.</p>
        {error && <p className="error-text" role="alert">{error}</p>}
      </section>

      {report && (
        <section className={`card ${report.valid ? "verified" : "error"}`} data-testid="audit-report">
          <h3>{report.valid ? "Verified: the bundle opens this request" : "Not verified: the bundle does not open this request"}</h3>
          <ul className="checks">
            {report.checks.map((c) => (
              <li key={c.name} className={c.ok ? "ok" : "bad"}><strong>{c.ok ? "ok" : "fail"}</strong> {c.name}: {c.detail}</li>
            ))}
          </ul>
          <h3>What the auditor learned</h3>
          <ul>{report.learned.map((l) => <li key={l}>{l}</li>)}</ul>
        </section>
      )}

      <h2>Every private validation on this chain</h2>
      <div className="table-wrap card">
        <table>
          <thead><tr><th>Agent</th><th>Requested by</th><th>Policy</th><th>Commitment</th><th>Input</th><th>Result</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const open = opened?.requestId.toLowerCase() === r.requestId.toLowerCase();
              return (
                <tr key={r.requestId} data-testid="audit-row" className={open ? "opened" : undefined}>
                  <td>{r.agentName}</td>
                  <td className="mono">{short(r.requester)}</td>
                  <td>{r.policy}</td>
                  <td className="mono">{short(r.commitment)}</td>
                  <td className={open ? "mono leak" : "sealed"}>{open ? JSON.stringify(opened!.input) + " (disclosed)" : "sealed"}</td>
                  <td>{r.result}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
