"use client";
import { useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { placeBid, requestPrivateValidation } from "../../lib/app/actions";
import { ctxOf, Explain, Pill, short, useRun, when } from "./ui";
import type { Veil } from "./useVeil";

export function WorkSection({ veil }: { veil: Veil }) {
  const { data, signer, vault } = veil;
  const me = signer!.address.toLowerCase();
  const { busy, run, Status } = useRun(veil);
  const [credential, setCredential] = useState<Record<string, string>>({});
  const [price, setPrice] = useState<Record<string, string>>({});
  const myAgents = data!.graph.agents.filter((a) => a.owner.toLowerCase() === me);
  const qualified = (agentId: bigint) =>
    (data!.veil?.rows ?? []).find((r) => r.agentId === agentId && r.agentLevel && r.policyName === "QUALIFIED_SCREENER_V1");
  const tasks = data!.auction?.tasks ?? [];
  const open = tasks.filter((t) => t.status === "open" && data!.now < t.deadline);
  const myBids = vault.bids.filter((b) => myAgents.some((a) => a.agentId.toString() === b.agentId));

  if (myAgents.length === 0)
    return (
      <section className="card" data-testid="work">
        <h2>Bid on work</h2>
        <p>
          This account owns no agent. {veil.config.local ? "Switch to one of the agent owners (Atlas's, Borealis's or Cirrus's owner)." : "Register one in the ERC-8004 Identity Registry first."}
        </p>
      </section>
    );

  return (
    <section className="card" data-testid="work">
      <h2>Bid on work</h2>
      <Explain>
        To bid, an agent must hold <code>QUALIFIED_SCREENER_V1</code>: you prove your screener credential to W1 privately
        (only a commitment goes on-chain). Bids are sealed: the chain gets a commitment, W3 gets your price sealed to its
        key, and only the winning price is ever published.
      </Explain>
      <Status />
      <h3>My agents</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Agent</th><th>QUALIFIED_SCREENER_V1</th><th></th></tr></thead>
          <tbody>
            {myAgents.map((a) => {
              const q = qualified(a.agentId);
              const ok = q?.result === "pass" && !q.expired;
              const id = a.agentId.toString();
              return (
                <tr key={id} data-testid="my-agent">
                  <td>{a.name} <span className="mono">#{id}</span></td>
                  <td>
                    {!q ? <Pill value="neutral">not requested</Pill> : q.result === "pending" ? <Pill value="pending">pending · W1</Pill> : ok ? <Pill value="pass">qualified until {when(q.expiry!)}</Pill> : q.expired ? <Pill value="neutral">expired</Pill> : <Pill value="fail">failed</Pill>}
                  </td>
                  <td>
                    {!ok && (
                      <form
                        className="inline"
                        onSubmit={(e) => {
                          e.preventDefault();
                          run("q" + id, "Committing to your credential and sealing it to W1…", async () => {
                            await requestPrivateValidation(ctxOf(veil), { agentId: a.agentId, policy: "QUALIFIED_SCREENER_V1", input: credential[id]!.trim() });
                            return `Qualification requested for ${a.name}; W1's result appears here in a few seconds.`;
                          });
                        }}
                      >
                        <input placeholder="credential, e.g. QS-2026-0417" value={credential[id] ?? ""} onChange={(e) => setCredential({ ...credential, [id]: e.target.value })} required />
                        <button className="small" disabled={!!busy || !credential[id]?.trim()}>Get qualified</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3>Open tasks</h3>
      {open.length === 0 && <p className="empty">No task is open for bids right now. Post one on the "Hire an agent" tab.</p>}
      {open.map((t) => (
        <div key={t.taskId.toString()} className="task" data-testid="open-task">
          <div className="task-head">
            <strong>Task #{t.taskId.toString()}</strong> · {t.categoryName ?? short(t.category)} · client {short(t.client)} · closes {when(t.deadline)}
          </div>
          <div className="actions">
            {myAgents.map((a) => {
              const key = `${t.taskId}:${a.agentId}`;
              const q = qualified(a.agentId);
              const bid = t.bids.some((b) => b.agentId === a.agentId);
              if (bid) return <span key={key} className="sub">{a.name} has bid</span>;
              if (!(q?.result === "pass" && !q.expired)) return <span key={key} className="sub">{a.name}: qualify first</span>;
              return (
                <form
                  key={key}
                  className="inline"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(key, "Sealing your price to W3, uploading, then bidding…", async () => {
                      await placeBid(ctxOf(veil), { taskId: t.taskId, agentId: a.agentId, price: parseUnits(price[key]!, 18) });
                      return `${a.name} bid on task ${t.taskId}. Only the commitment is on-chain.`;
                    });
                  }}
                >
                  {a.name}: <input type="number" min="0" step="any" placeholder="price" value={price[key] ?? ""} onChange={(e) => setPrice({ ...price, [key]: e.target.value })} required />
                  <button className="small" disabled={!!busy || !price[key]}>Place sealed bid</button>
                </form>
              );
            })}
          </div>
        </div>
      ))}

      <h3>My bids</h3>
      {myBids.length === 0 ? (
        <p className="empty">No bids from this browser yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Task</th><th>Agent</th><th>Your price (local only)</th><th>Outcome</th></tr></thead>
            <tbody>
              {myBids.map((b) => {
                const t = tasks.find((x) => x.taskId.toString() === b.taskId);
                const onChain = t?.bids.find((x) => x.agentId.toString() === b.agentId);
                const won = t?.award?.winnerAgentId.toString() === b.agentId;
                return (
                  <tr key={b.commitment} data-testid="my-bid">
                    <td>#{b.taskId}</td>
                    <td>{onChain?.agentName ?? `#${b.agentId}`}</td>
                    <td className="sealed">{formatUnits(BigInt(b.price), 18)}</td>
                    <td>
                      {!t ? "…" : !t.award ? t.status : won ? "won (your price is now public)" : `lost; ${onChain?.inclusion === "counted" ? "your bid was counted (Merkle proof verifies)" : onChain?.inclusion ?? "not placed"}`}
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
