"use client";
import { useState } from "react";
import { reason } from "../../lib/app/runtime";
import type { Veil } from "./useVeil";

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const when = (t: bigint) => new Date(Number(t) * 1000).toISOString().replace(".000Z", "Z").replace("T", " ");
/** A deterministic two-colour gradient per address, so accounts are recognisable at a glance. */
export function avatarStyle(address: string): React.CSSProperties {
  const h1 = parseInt(address.slice(2, 6), 16) % 360;
  const h2 = (h1 + 60 + (parseInt(address.slice(6, 8), 16) % 120)) % 360;
  return { background: `linear-gradient(135deg, hsl(${h1} 80% 62%), hsl(${h2} 75% 48%))` };
}

const PILL: Record<string, string> = { pass: "pass", fail: "fail", failed: "fail", pending: "pending", open: "pending", closed: "pending", awarded: "pass", completed: "sealed", "no award": "neutral" };
export function Pill({ value, children }: { value: string; children?: React.ReactNode }) {
  return <span className={`pill ${PILL[value] ?? "neutral"}`}>{children ?? value}</span>;
}

export const ctxOf = (v: Veil) => ({ config: v.config, d: v.d, client: v.client, signer: v.signer!, scope: v.scope });

/** Runs one action at a time per section, shows its progress and outcome, then refreshes the chain view and vault. */
export function useRun(veil: Veil) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
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
      <p className={msg.ok ? "status-ok" : "error-text"} role="status" data-testid="action-status">
        {busy ? <span className="spin" /> : msg.ok ? "✔" : "✘"}{" "}
        {msg.text}
      </p>
    ) : null;
  return { busy, run, Status };
}

export function Explain({ children }: { children: React.ReactNode }) {
  return <p className="sub explain">{children}</p>;
}
