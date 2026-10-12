"use client";
import { useState } from "react";
import type { Hex } from "viem";
import { ShieldIcon } from "../icons";
import { downloadBundle, executeTreasury, requestPrivateValidation } from "../../lib/app/actions";
import { CardHead, ctxOf, label, Pill, relative, short, useRun, when } from "./ui";
import type { Veil } from "./useVeil";

const POLICIES = [
  { name: "SANCTIONS_SCREEN_V1", input: "Counterparty name", placeholder: "e.g. Northwind Trading LLC" },
  { name: "QUALIFIED_SCREENER_V1", input: "Screener credential", placeholder: "e.g. QS-2026-0417" },
] as const;

export function ScreeningSection({ veil }: { veil: Veil }) {
  const { data, vault, signer, d } = veil;
  const agents = data!.graph.agents;
  const [agentId, setAgentId] = useState(agents[0]?.agentId.toString() ?? "");
  const [policy, setPolicy] = useState<(typeof POLICIES)[number]["name"]>("SANCTIONS_SCREEN_V1");
  const [input, setInput] = useState("");
  const { busy, run, Status } = useRun(veil);
  const p = POLICIES.find((x) => x.name === policy)!;
  const rows = new Map((data!.veil?.rows ?? []).map((r) => [r.requestId, r]));
  const mine = vault.openings.filter((o) => o.requester.toLowerCase() === signer!.address.toLowerCase()).sort((a, b) => b.at - a.at);
  const isOperator = d.veil?.treasuryOperator.toLowerCase() === signer!.address.toLowerCase();

  return (
    <div className="stack" data-testid="screening">
      <Status />
      <section className="card">
      <CardHead
        title="New screening"
        sub="Only a fingerprint and pass/fail go on-chain."
      />
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          run("request", "Encrypting and submitting your request…", async () => {
            const id = await requestPrivateValidation(ctxOf(veil), { agentId: BigInt(agentId), policy, input: input.trim() });
            setInput("");
            return `Screening ${short(id)} submitted. The result appears below in a few seconds.`;
          });
        }}
      >
        <label>
          Agent
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            {agents.map((a) => (
              <option key={a.agentId.toString()} value={a.agentId.toString()}>
                {a.name} (#{a.agentId.toString()})
              </option>
            ))}
          </select>
        </label>
        <label>
          Check
          <select value={policy} onChange={(e) => setPolicy(e.target.value as typeof policy)}>
            {POLICIES.map((x) => (
              <option key={x.name} value={x.name}>{label(x.name)}</option>
            ))}
          </select>
        </label>
        <label className="wide">
          <span>
            {p.input} <span className="faint">· private</span>
          </span>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={p.placeholder} required maxLength={200} />
        </label>
        <button type="submit" disabled={!!busy || !input.trim()}>
          <ShieldIcon size={16} /> Run screening
        </button>
      </form>
      {veil.config.local && (
        <p className="fine">
          Try it (fictional test data): <em>Kestrel Shipping Co</em>, <em>Blackfin Holdings Ltd</em> and <em>Orrin Maritime SA</em> are
          on the sanctions list; credentials <em>QS-2026-0417</em>, <em>-0582</em>, <em>-0733</em> and <em>-0901</em> are valid.
          Only the agent's owner can change the agent's own qualification.
        </p>
      )}
      </section>

      <section className="card">
      <CardHead title="Your screenings" sub="Only visible to you, in this browser." />
      {mine.length === 0 ? (
        <p className="empty">You haven't run any screenings yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Request</th><th>Agent</th><th>Check</th><th>What you checked</th><th>Result</th><th></th></tr>
            </thead>
            <tbody>
              {mine.map((o) => {
                const r = rows.get(o.requestId);
                const pass = r?.result === "pass" && !r.expired;
                return (
                  <tr key={o.requestId} data-testid="my-request">
                    <td className="mono">{short(o.requestId)}</td>
                    <td>{r?.agentName ?? `#${o.agentId}`}</td>
                    <td title={o.policy}>{label(o.policy)}</td>
                    <td className="sealed">{o.input}</td>
                    <td>
                      {!r ? "…" : r.result === "pending" ? <Pill value="pending">Checking…</Pill> : r.expired ? <Pill value="neutral">{r.result} · expired</Pill> : <Pill value={r.result} />}
                      {r?.expiry && !r.expired ? <div className="sub" title={when(r.expiry)}>valid {relative(r.expiry, data!.now).replace("in ", "for ")}</div> : null}
                    </td>
                    <td className="actions">
                      <button className="small" disabled={!!busy} onClick={() => run(o.requestId, "Building the bundle…", async () => {
                        await downloadBundle(ctxOf(veil), o.requestId as Hex);
                        return "Audit bundle downloaded. It reveals this one screening, so share it only with your auditor.";
                      })}>
                        Export for audit
                      </button>
                      {isOperator && o.policy === "SANCTIONS_SCREEN_V1" && pass && !r!.treasuryExecuted && (
                        <button className="small" disabled={!!busy} onClick={() => run(o.requestId + "x", "Executing…", async () => {
                          await executeTreasury(ctxOf(veil), o.requestId as Hex);
                          return "Payout executed. It was allowed because this screening passed.";
                        })}>
                          Execute payout
                        </button>
                      )}
                      {r?.treasuryExecuted && <span className="pill pass">Payout executed</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </section>
    </div>
  );
}
