"use client";
// Paste a disclosure bundle, verify it against the chain, and see which row it opens. Everything else stays sealed.
import { useEffect, useRef, useState } from "react";
import type { PublicClient } from "viem";
import { bundleToJson, exportBundle } from "@veil8004/sdk/disclosure";
import { loadConfig, makePublicClient } from "../../lib/app/runtime";
import { readVault, type Opening } from "../../lib/app/vault";
import { label, short } from "../../lib/format";
import { CheckIcon, FileCheckIcon, LockIcon, ShieldIcon } from "../icons";

export type SealedRow = { requestId: string; agentName: string; requester: string; policy: string; commitment: string; result: string };

type Report = {
  valid: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
  request: { requestId: string; input: string; result: string; tier: string | null; policyTier: string | null; expiry: string | null; expired: boolean; currentlyValid: boolean } | null;
  learned: string[];
};

/** Screenings this browser holds the opening for (made in the app), so a visitor can try disclosure in one click. */
function useMyScreenings() {
  const [mine, setMine] = useState<{ o: Opening; client: PublicClient }[]>([]);
  useEffect(() => {
    (async () => {
      const config = await loadConfig();
      const client = makePublicClient(config);
      const genesis = await client.getBlock({ blockNumber: 0n });
      const openings = readVault(`${config.chainId}:${genesis.hash}`).openings.sort((a, b) => b.at - a.at);
      setMine(openings.map((o) => ({ o, client })));
    })().catch(() => setMine([]));
  }, []);
  return mine;
}

export function AuditForm({ rows }: { rows: SealedRow[] }) {
  const [text, setText] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [paste, setPaste] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const result = useRef<HTMLDivElement>(null);
  const mine = useMyScreenings();

  async function verify(body = text) {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch("/audit/verify", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? `HTTP ${res.status}`);
      else setReport(json as Report);
      setTimeout(() => result.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function load(content: string) {
    setText(content);
    await verify(content);
  }
  const preview = summarize(text, rows);

  const opened = report?.valid ? report.request : null;
  return (
    <>
      <div className="audit-grid">
        <section className="card">
          <div className="card-head">
            <div>
              <h2><label htmlFor="bundle">Disclosure bundle</label></h2>
              <p className="sub">The JSON file someone exported for you from their Screening page.</p>
            </div>
          </div>

          <div
            className={`dropzone ${drag ? "drag" : ""} ${text ? "loaded" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={async (e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files[0];
              if (f) await load(await f.text());
            }}
            onClick={() => file.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") file.current?.click(); }}
          >
            <span className="dz-icon"><FileCheckIcon size={22} /></span>
            {preview ? (
              <>
                <strong>{preview.title}</strong>
                <span className="sub">{preview.detail}</span>
              </>
            ) : (
              <>
                <strong>Drop the bundle here, or click to choose a file</strong>
                <span className="sub">A .json file, usually named veil8004-bundle-….json</span>
              </>
            )}
          </div>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) await load(await f.text());
            }}
          />

          <div className="actions dz-actions">
            <button type="button" className="ghost small" onClick={() => setPaste(!paste)}>{paste ? "Hide JSON" : "Paste JSON instead"}</button>
            {text && !busy && <button type="button" className="ghost small" onClick={() => { setText(""); setReport(null); setError(null); }}>Clear</button>}
            <span className="spacer" />
            <button type="button" className="primary" onClick={() => verify()} disabled={busy || !text.trim()}>
              {busy ? <><span className="spin" /> Verifying…</> : <><ShieldIcon size={16} /> Verify against the chain</>}
            </button>
          </div>
          <textarea
            id="bundle"
            className="mono bundle-input"
            rows={7}
            spellCheck={false}
            hidden={!paste}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='{"version":"veil8004-disclosure/1","chainId":31337,"registry":"0x…","requestId":"0x…","agentId":"0","policyId":"0x…","input":"…","salt":"0x…"}'
          />
          {error && <p className="error-text" role="alert">{error}</p>}

          {mine.length > 0 && (
            <div className="mine">
              <span className="mine-label">Or try it with a screening you made in this browser</span>
              <div className="mine-list">
                {mine.slice(0, 4).map(({ o, client }) => (
                  <button
                    key={o.requestId}
                    type="button"
                    className="chip"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        await load(bundleToJson(await exportBundle(client, { registry: o.registry, requestId: o.requestId, input: o.input, salt: o.salt })));
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    {label(o.policy)} · {short(o.requestId)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="card how">
          <h2>How verification works</h2>
          <ol className="how-steps">
            <li><strong>Recompute</strong><span className="sub">The input and salt in the bundle are hashed again.</span></li>
            <li><strong>Compare</strong><span className="sub">The hash must match the fingerprint recorded on-chain.</span></li>
            <li><strong>Confirm</strong><span className="sub">The policy and result are read back and checked.</span></li>
          </ol>
          <p className="fine"><LockIcon size={12} /> Reads only. Nothing is stored, and no other request is revealed.</p>
        </aside>
      </div>

      <div ref={result} className="result-anchor" />
      {report && (
        <section className={`card report ${report.valid ? "verified" : "error"}`} data-testid="audit-report">
          <div className="report-head">
            <span className={`report-icon ${report.valid ? "ok" : "bad"}`}>{report.valid ? <CheckIcon size={20} /> : "!"}</span>
            <div>
              <h2>{report.valid ? "Verified: the bundle opens this request" : "Not verified: the bundle does not open this request"}</h2>
              <p className="sub">{report.checks.filter((c) => c.ok).length} of {report.checks.length} checks passed</p>
            </div>
          </div>
          {opened && (
            <div className="disclosed">
              <div>
                <span className="dk">Disclosed input</span>
                <span className="dv">{opened.input}</span>
              </div>
              <div>
                <span className="dk">Result</span>
                <span className="dv"><span className={`pill ${opened.result === "pass" ? "pass" : opened.result === "fail" ? "fail" : "pending"}`}>{opened.result}</span></span>
              </div>
              <div>
                <span className="dk">Still valid</span>
                <span className="dv">{opened.currentlyValid ? "Yes" : opened.expired ? "No, expired" : "No"}</span>
              </div>
              <div>
                <span className="dk">Request</span>
                <span className="dv mono">{short(opened.requestId)}</span>
              </div>
            </div>
          )}
          <ul className="checks">
            {report.checks.map((c) => (
              <li key={c.name} className={c.ok ? "ok" : "bad"}>
                <span className="check-dot">{c.ok ? <CheckIcon size={12} /> : "×"}</span>
                <span><strong className="sr-only">{c.ok ? "ok" : "fail"}</strong> <b>{c.name}</b> <span className="sub">{c.detail}</span></span>
              </li>
            ))}
          </ul>
          <details className="raw-facts">
            <summary>What you learned ({report.learned.length})</summary>
            <ul className="learned">{report.learned.map((l) => <li key={l}>{l}</li>)}</ul>
          </details>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Every private validation on this network</h2>
            <p className="sub">What the public ledger shows. Inputs stay sealed unless a bundle opens them.</p>
          </div>
          <span className="pill neutral">{rows.length} requests</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Agent</th><th>Requested by</th><th>Policy</th><th>Commitment</th><th>Input</th><th>Result</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const open = opened?.requestId.toLowerCase() === r.requestId.toLowerCase();
                const base = r.result.split(" · ")[0]!;
                return (
                  <tr key={r.requestId} data-testid="audit-row" className={open ? "opened" : undefined}>
                    <td><strong>{r.agentName}</strong></td>
                    <td className="mono">{short(r.requester)}</td>
                    <td>{label(r.policy)} <div className="mono faint">{r.policy}</div></td>
                    <td className="mono faint">{short(r.commitment)}</td>
                    <td className={open ? "mono leak" : "sealed"}>{open ? JSON.stringify(opened!.input) + " (disclosed)" : "sealed"}</td>
                    <td><span className={`pill ${base === "pass" ? "pass" : base === "fail" ? "fail" : "pending"}`}>{r.result}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/** A one-line description of a pasted or dropped bundle, matched against the public rows when possible. */
function summarize(text: string, rows: SealedRow[]): { title: string; detail: string } | null {
  if (!text.trim()) return null;
  try {
    const b = JSON.parse(text) as { requestId?: string; chainId?: number };
    const row = rows.find((r) => r.requestId.toLowerCase() === b.requestId?.toLowerCase());
    return row
      ? { title: `Bundle for ${row.agentName} · ${label(row.policy)}`, detail: `Request ${short(row.requestId)} on chain ${b.chainId ?? "?"}` }
      : { title: "Bundle loaded", detail: b.requestId ? `Request ${short(b.requestId)} isn't on this network` : "No request id found" };
  } catch {
    return { title: "This doesn't look like a bundle", detail: "The file isn't valid JSON" };
  }
}
