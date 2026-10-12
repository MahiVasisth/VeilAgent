"use client";
// "Try it": run the real commitment and sealing code from the SDK on the visitor's own input, in their browser, and
// show what each kind of chain would publish. Nothing is sent anywhere; the decision step uses the demo's fictional list.
import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { inputCommitment, policyId, randomSalt } from "@veil8004/sdk/commitments";
import { generateKeyPair, sealFor } from "@veil8004/sdk/seal";
import { short } from "../../lib/format";
import { ArrowIcon, CheckIcon, EyeIcon, KeyIcon, LockIcon, ShieldIcon } from "../icons";

// The mock screening provider's fictional hit list (services/mock-screening/src/screening.ts).
const HIT_LIST = ["Kestrel Shipping Co", "Blackfin Holdings Ltd", "Orrin Maritime SA"];
const EXAMPLES = ["Northwind Trading LLC", "Kestrel Shipping Co", "Harbor Light Logistics"];
const STEPS = [
  { t: "Commit", icon: <KeyIcon size={16} /> },
  { t: "Seal", icon: <LockIcon size={16} /> },
  { t: "Decide", icon: <ShieldIcon size={16} /> },
  { t: "Publish", icon: <CheckIcon size={16} /> },
];

type Run = { input: string; salt: Hex; commitment: Hex; sealed: string; pass: boolean; realKey: boolean };

export function Playground() {
  const [input, setInput] = useState(EXAMPLES[0]!);
  const [key, setKey] = useState<{ pk: string; real: boolean } | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [step, setStep] = useState(-1);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: { w1PublicKey?: string | null }) => (c.w1PublicKey ? { pk: c.w1PublicKey, real: true } : null))
      .catch(() => null)
      .then((k) => setKey(k ?? { pk: generateKeyPair().publicKey, real: false }));
  }, []);

  useEffect(() => {
    if (step < 0 || step >= STEPS.length) return;
    const t = setTimeout(() => setStep((s) => s + 1), 650);
    return () => clearTimeout(t);
  }, [step]);

  function go(value = input) {
    const v = value.trim();
    if (!v || !key) return;
    const salt = randomSalt();
    setRun({
      input: v,
      salt,
      commitment: inputCommitment({ agentId: 1n, policyId: policyId("SANCTIONS_SCREEN_V1"), input: v, salt }),
      sealed: sealFor(key.pk, { input: v, salt }),
      pass: !HIT_LIST.some((h) => h.toLowerCase() === v.toLowerCase()),
      realKey: key.real,
    });
    setStep(0);
  }

  const done = run && step >= STEPS.length;
  const result = run ? (run.pass ? "pass" : "fail") : "";
  return (
    <div className="playground card" data-testid="playground">
      <form className="pg-input" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <label htmlFor="pg">Who do you want to screen?</label>
        <div className="pg-row">
          <input id="pg" value={input} onChange={(e) => setInput(e.target.value)} maxLength={80} placeholder="A company name" />
          <button type="submit" className="primary" disabled={!input.trim() || !key || (step >= 0 && step < STEPS.length)}>
            <ShieldIcon size={16} /> Screen privately
          </button>
        </div>
        <div className="pg-examples">
          Try:{" "}
          {EXAMPLES.map((x) => (
            <button key={x} type="button" className="chip" onClick={() => { setInput(x); go(x); }}>{x}</button>
          ))}
        </div>
      </form>

      <ol className="pg-steps">
        {STEPS.map((s, i) => {
          const state = !run ? "" : step > i ? "done" : step === i ? "active" : "";
          return (
            <li key={s.t} className={state}>
              <span className="pg-icon">{state === "done" ? <CheckIcon size={16} /> : s.icon}</span>
              <strong>{s.t}</strong>
              <span className="pg-art mono">
                {!run || step < i ? "—"
                  : i === 0 ? short(run.commitment)
                  : i === 1 ? `${run.sealed.slice(0, 10)}… (${Math.round((run.sealed.length * 3) / 4)} bytes)`
                  : i === 2 ? (step > 2 ? (run.pass ? "not on the list" : "on the list") : "checking…")
                  : step > 3 ? `${result.toUpperCase()}` : "…"}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="pg-out">
        <div className={`pg-side plain ${done ? "in" : ""}`}>
          <span className="pg-label"><EyeIcon size={14} /> Plain ERC-8004 publishes</span>
          <code className="pg-code">{done ? `{"subject":"${run.input}"} → ${result}` : "…"}</code>
          <span className="sub">Anyone can see who you checked.</span>
        </div>
        <ArrowIcon size={18} />
        <div className={`pg-side veil ${done ? "in" : ""}`}>
          <span className="pg-label"><LockIcon size={14} /> Veil8004 publishes</span>
          <code className="pg-code">{done ? `${short(run.commitment)} → ${result}` : "…"}</code>
          <span className="sub">Only a fingerprint and the result.</span>
        </div>
      </div>
      <p className="fine pg-fine">
        Runs in your browser with the real SDK code{run && !run.realKey ? " (sealed to a throwaway key)" : ""}. Nothing is sent. Demo list:{" "}
        {HIT_LIST.join(", ")} are flagged.
      </p>
    </div>
  );
}
