"use client";
import { useState } from "react";
import type { Hex } from "viem";
import { ShieldIcon } from "../icons";
import { downloadBundle, executeTreasury, requestPrivateValidation } from "../../lib/app/actions";
import { ctxOf, Explain, Pill, short, useRun, when } from "./ui";
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
    <section className="card" data-testid="screening">
      <h2>Screen privately</h2>
      <Explain>
        Ask the validator (workflow W1) to check something about an agent without publishing it. The chain gets a salted
        commitment; W1 gets a copy sealed to its key; the input and salt stay in this browser. The result (pass or fail)
        is public.
      </Explain>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          run("request", "Committing on-chain, then sealing your input to W1…", async () => {
            const id = await requestPrivateValidation(ctxOf(veil), { agentId: BigInt(agentId), policy, input: input.trim() });
            setInput("");
            return `Requested ${short(id)}. Waiting for W1's result below (a few seconds).`;
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
          Policy
          <select value={policy} onChange={(e) => setPolicy(e.target.value as typeof policy)}>
            {POLICIES.map((x) => (
              <option key={x.name}>{x.name}</option>
            ))}
          </select>
        </label>
        <label className="wide">
          <span>
            {p.input} <span className="sub">(stays in this browser)</span>
          </span>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={p.placeholder} required maxLength={200} />
        </label>
        <button type="submit" disabled={!!busy || !input.trim()}>
          <ShieldIcon size={16} /> Commit and request
        </button>
      </form>
      {veil.config.local && (
        <p className="sub">
          Mock provider (fictional): <em>Kestrel Shipping Co</em>, <em>Blackfin Holdings Ltd</em> and <em>Orrin Maritime SA</em> are
          on the sanctions list; credentials <em>QS-2026-0417</em>, <em>-0582</em>, <em>-0733</em> and <em>-0901</em> are qualified.
          Only a request by the agent's owner changes the agent's own qualification.
        </p>
      )}
      <Status />

      <h3>My requests</h3>
      {mine.length === 0 ? (
        <p className="empty">No requests from this account in this browser yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Request</th><th>Agent</th><th>Policy</th><th>Your input (local only)</th><th>Result (public)</th><th></th></tr>
            </thead>
            <tbody>
              {mine.map((o) => {
                const r = rows.get(o.requestId);
                const pass = r?.result === "pass" && !r.expired;
                return (
                  <tr key={o.requestId} data-testid="my-request">
                    <td className="mono">{short(o.requestId)}</td>
                    <td>{r?.agentName ?? `#${o.agentId}`}</td>
                    <td>{o.policy}</td>
                    <td className="sealed">{o.input}</td>
                    <td>
                      {!r ? "…" : r.result === "pending" ? <Pill value="pending">pending · W1</Pill> : r.expired ? <Pill value="neutral">{r.result} · expired</Pill> : <Pill value={r.result} />}
                      {r?.expiry ? <div className="sub">until {when(r.expiry)}</div> : null}
                    </td>
                    <td className="actions">
                      <button className="small" disabled={!!busy} onClick={() => run(o.requestId, "Building the bundle…", async () => {
                        await downloadBundle(ctxOf(veil), o.requestId as Hex);
                        return "Bundle downloaded. It holds this request's salt: give it only to your auditor (they can check it on the Audit page).";
                      })}>
                        Audit bundle
                      </button>
                      {isOperator && o.policy === "SANCTIONS_SCREEN_V1" && pass && !r!.treasuryExecuted && (
                        <button className="small" disabled={!!busy} onClick={() => run(o.requestId + "x", "Executing…", async () => {
                          await executeTreasury(ctxOf(veil), o.requestId as Hex);
                          return "Treasury action executed (gated on this exact result).";
                        })}>
                          Execute treasury action
                        </button>
                      )}
                      {r?.treasuryExecuted && <span className="sub">treasury executed</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
