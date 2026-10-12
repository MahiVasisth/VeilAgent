"use client";
import { useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { placeBid, requestPrivateValidation } from "../../lib/app/actions";
import { avatarStyle, CardHead, ctxOf, label, Pill, relative, short, useRun, when } from "./ui";
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
        <div className="empty">
          <strong>You don't own an agent yet</strong>
          <br />
          {veil.config.local ? "Switch to Atlas, Borealis or Cirrus to bid on tasks." : "Register one in the ERC-8004 Identity Registry first."}
        </div>
      </section>
    );

  return (
    <div className="stack" data-testid="work">
      <Status />
      <section className="card">
      <CardHead title="Your agents" sub="Qualify once to start bidding. Your credential stays private." />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Agent</th><th>Qualification</th><th></th></tr></thead>
          <tbody>
            {myAgents.map((a) => {
              const q = qualified(a.agentId);
              const ok = q?.result === "pass" && !q.expired;
              const id = a.agentId.toString();
              return (
                <tr key={id} data-testid="my-agent">
                  <td>
                    <span className="agent-cell">
                      <span className="avatar sm" style={avatarStyle(a.owner + id)} />
                      <strong>{a.name}</strong> <span className="mono faint">#{id}</span>
                    </span>
                  </td>
                  <td>
                    {!q ? <Pill value="neutral">Not qualified</Pill> : q.result === "pending" ? <Pill value="pending">Checking…</Pill> : ok ? <span title={when(q.expiry!)}><Pill value="pass">Qualified · expires {relative(q.expiry!, data!.now)}</Pill></span> : q.expired ? <Pill value="neutral">Expired</Pill> : <Pill value="fail">Rejected</Pill>}
                  </td>
                  <td>
                    {!ok && (
                      <form
                        className="inline"
                        onSubmit={(e) => {
                          e.preventDefault();
                          run("q" + id, "Encrypting your credential and submitting it…", async () => {
                            await requestPrivateValidation(ctxOf(veil), { agentId: a.agentId, policy: "QUALIFIED_SCREENER_V1", input: credential[id]!.trim() });
                            return `Qualification requested for ${a.name}. The result appears here in a few seconds.`;
                          });
                        }}
                      >
                        <input placeholder="Credential ID, e.g. QS-2026-0417" value={credential[id] ?? ""} onChange={(e) => setCredential({ ...credential, [id]: e.target.value })} required />
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
      </section>

      <section className="card">
      <CardHead title="Open tasks" sub="Your price is sealed. If you lose, nobody sees it." />
      {open.length === 0 && <p className="empty">No tasks are open for bids right now.</p>}
      <div className="task-list">
      {open.map((t) => (
        <div key={t.taskId.toString()} className="task" data-testid="open-task">
          <div className="task-head">
            <strong>{label(t.categoryName ?? short(t.category))}</strong>
            <span className="spacer" />
            <span className="pill pending" title={when(t.deadline)}>Closes {relative(t.deadline, data!.now)}</span>
          </div>
          <div className="task-meta sub">
            <span>Task #{t.taskId.toString()}</span>
            <span>Client {short(t.client)}</span>
            <span className="lock">{t.bids.length} sealed bid{t.bids.length === 1 ? "" : "s"}</span>
          </div>
          <div className="actions">
            {myAgents.map((a) => {
              const key = `${t.taskId}:${a.agentId}`;
              const q = qualified(a.agentId);
              const bid = t.bids.some((b) => b.agentId === a.agentId);
              if (bid) return <span key={key} className="pill sealed">{a.name} bid placed</span>;
              if (!(q?.result === "pass" && !q.expired)) return <span key={key} className="sub">{a.name} needs a qualification to bid</span>;
              return (
                <form
                  key={key}
                  className="inline"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(key, "Encrypting your price and placing the bid…", async () => {
                      await placeBid(ctxOf(veil), { taskId: t.taskId, agentId: a.agentId, price: parseUnits(price[key]!, 18) });
                      return `${a.name}'s sealed bid is in on task #${t.taskId}. Nobody can see the price.`;
                    });
                  }}
                >
                  <span className="sub">{a.name}</span> <input type="number" min="0" step="any" placeholder="Your price" value={price[key] ?? ""} onChange={(e) => setPrice({ ...price, [key]: e.target.value })} required />
                  <button className="small" disabled={!!busy || !price[key]}>Place sealed bid</button>
                </form>
              );
            })}
          </div>
        </div>
      ))}
      </div>
      </section>

      <section className="card">
      <CardHead title="Your bids" sub="Only you can see these prices." />
      {myBids.length === 0 ? (
        <p className="empty">You haven't placed any bids yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Task</th><th>Agent</th><th className="num">Your price</th><th>Outcome</th></tr></thead>
            <tbody>
              {myBids.map((b) => {
                const t = tasks.find((x) => x.taskId.toString() === b.taskId);
                const onChain = t?.bids.find((x) => x.agentId.toString() === b.agentId);
                const won = t?.award?.winnerAgentId.toString() === b.agentId;
                return (
                  <tr key={b.commitment} data-testid="my-bid">
                    <td>#{b.taskId}</td>
                    <td>{onChain?.agentName ?? `#${b.agentId}`}</td>
                    <td className="sealed num">{formatUnits(BigInt(b.price), 18)}</td>
                    <td>
                      {!t ? "…" : !t.award ? <Pill value={t.status} /> : won ? (
                        <><Pill value="pass">Won</Pill> <span className="sub">your price is now public</span></>
                      ) : (
                        <><Pill value="neutral">Not selected</Pill> <span className="sub">{onChain?.inclusion === "counted" ? "your bid was provably counted; price stays sealed" : onChain?.inclusion ?? "not placed"}</span></>
                      )}
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
