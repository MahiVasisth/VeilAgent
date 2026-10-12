"use client";
import { useEffect, useState } from "react";
import { reason } from "../../lib/app/runtime";
import type { Veil } from "./useVeil";

export { avatarStyle, label, relative, short } from "../../lib/format";
export const when = (t: bigint) => new Date(Number(t) * 1000).toISOString().replace(".000Z", "Z").replace("T", " ");
const PILL: Record<string, string> = { pass: "pass", fail: "fail", failed: "fail", pending: "pending", open: "pending", closed: "pending", awarded: "pass", completed: "sealed", "no award": "neutral" };
const STATUS_TEXT: Record<string, string> = { open: "Accepting bids", closed: "Opening bids", awarded: "Hired", completed: "Completed", pass: "Passed", fail: "Failed", pending: "Pending" };
export function Pill({ value, children }: { value: string; children?: React.ReactNode }) {
  return <span className={`pill ${PILL[value] ?? "neutral"}`}>{children ?? STATUS_TEXT[value] ?? value}</span>;
}

export const ctxOf = (v: Veil) => ({ config: v.config, d: v.d, client: v.client, signer: v.signer!, scope: v.scope });

/** Runs one action at a time per section and shows its progress and outcome as a toast, then refreshes the chain view
 *  and vault. Successes fade after a few seconds; errors stay until dismissed. */
export function useRun(veil: Veil) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (busy || !msg?.ok) return;
    const t = setTimeout(() => setMsg(null), 7000);
    return () => clearTimeout(t);
  }, [busy, msg]);
  async function run(key: string, step: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setMsg({ ok: true, text: step });
    try {
      const done = await fn();
      setMsg(done ? { ok: true, text: done } : null);
    } catch (e) {
      setMsg({ ok: false, text: reason(e) });
    } finally {
      setBusy(null);
      veil.reloadVault();
      await veil.refresh();
    }
  }
  const Status = () =>
    msg ? (
      <div className={`toast ${busy ? "busy" : msg.ok ? "status-ok" : "error-text"}`} role="status" data-testid="action-status">
        <span className="toast-icon">{busy ? <span className="spin" /> : msg.ok ? "✓" : "!"}</span>
        <span className="toast-text">{msg.text}</span>
        {!busy && (
          <button className="toast-close" aria-label="Dismiss" onClick={() => setMsg(null)}>
            ×
          </button>
        )}
      </div>
    ) : null;
  return { busy, run, Status };
}

export function Explain({ children }: { children: React.ReactNode }) {
  return <p className="sub explain">{children}</p>;
}

export function CardHead({ title, sub, right }: { title: string; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="card-head">
      <div>
        <h2>{title}</h2>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
