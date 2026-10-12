"use client";
import { useState } from "react";
import { formatUnits } from "viem";
import { formatAverage } from "@veil8004/sdk";
import { anchor, closeBidding, markCompleted, postTask, rateAnonymously } from "../../lib/app/actions";
import { updateVault } from "../../lib/app/vault";
import { CardHead, ctxOf, label, Pill, relative, short, useRun, when } from "./ui";
import type { Veil } from "./useVeil";

const CATEGORIES = ["sanctions-screening", "compliance-screening"];

export function HireSection({ veil }: { veil: Veil }) {
  const { data, signer, vault } = veil;
  const me = signer!.address.toLowerCase();
  const [category, setCategory] = useState(CATEGORIES[0]!);
  const [minutes, setMinutes] = useState(10);
  const [scores, setScores] = useState<Record<string, number>>({});
  const { busy, run, Status } = useRun(veil);
  const tasks = [...(data!.auction?.tasks ?? [])].sort((a, b) => Number(b.taskId - a.taskId));
  const receipts = new Map((data!.feedbackRaw?.receipts ?? []).map((r) => [r.taskId.toString(), r]));
  const identities = new Map(vault.identities.filter((i) => i.taskId).map((i) => [i.taskId!, i]));

  return (
    <div className="stack" data-testid="hire">
      <Status />
      <section className="card">
      <CardHead
        title="Post a task"
        sub="Qualified agents bid privately. Lowest bid wins."
      />
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          run("post", "Posting your task…", async () => `Task #${await postTask(ctxOf(veil), { category, minutes })} is live. Agents can bid for the next ${minutes} min.`);
        }}
      >
        <label>
          What do you need?
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
          </select>
        </label>
        <label>
          Accept bids for (minutes)
          <input type="number" min={1} max={10080} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        </label>
        <button type="submit" disabled={!!busy}>Post task</button>
      </form>
      <p className="fine">You'll be able to rate the agent anonymously afterwards.</p>
      </section>

      <section className="card">
      <CardHead title="Tasks" sub="Losing prices are never published." />
      {tasks.length === 0 && <p className="empty">No tasks yet. Post the first one above.</p>}
      <div className="task-list">
        {tasks.map((t) => {
          const id = t.taskId.toString();
          const mine = t.client.toLowerCase() === me;
          const past = data!.now >= t.deadline;
          const receipt = receipts.get(id);
          const identity = identities.get(id);
          const rated = receipt && identity?.rated?.includes(`${receipt.agentId}:${receipt.epoch}`);
          return (
            <div key={id} className="task" data-testid="app-task">
              <div className="task-head">
                <strong>{label(t.categoryName ?? short(t.category))}</strong>
                {mine && <span className="tag">yours</span>}
                <span className="spacer" />
                <Pill value={t.status} />
              </div>
              <div className="task-meta sub">
                <span>Task #{id}</span>
                <span title={when(t.deadline)}>{past ? "Bidding ended" : "Bidding closes"} {relative(t.deadline, data!.now)}</span>
                <span className="lock">{t.bids.length} sealed bid{t.bids.length === 1 ? "" : "s"}</span>
                {!mine && <span>Client {short(t.client)}</span>}
              </div>
              {t.award && (
                <div className="award-line">
                  Hired <strong>{t.award.winnerName}</strong> for <strong>{formatUnits(t.award.winningPrice, 18)}</strong>
                  <span className="sub"> · lowest of {t.award.validBidCount} bid{t.award.validBidCount === 1 ? "" : "s"}; the others stay sealed</span>
                </div>
              )}
              <div className="actions">
                {t.status === "open" && past && (
                  <button className="small" disabled={!!busy} onClick={() => run(id + "c", "Closing bidding…", async () => {
                    await closeBidding(ctxOf(veil), t.taskId);
                    return `Bidding closed on task #${id}. The sealed bids are being opened…`;
                  })}>
                    Close bidding
                  </button>
                )}
                {t.status === "closed" && <span className="sub"><span className="spin" /> Opening sealed bids…</span>}
                {mine && t.status === "awarded" && (
                  <button className="small" disabled={!!busy} onClick={() => run(id + "m", "Marking completed…", async () => {
                    await markCompleted(ctxOf(veil), t.taskId);
                    return `Task #${id} completed. Your rating receipt arrives in a few seconds.`;
                  })}>
                    Mark job completed
                  </button>
                )}
                {mine && t.status === "completed" && !receipt && <span className="sub"><span className="spin" /> Issuing your rating receipt…</span>}
                {mine && receipt && !identity && <span className="sub">This task's anonymous identity isn't in this browser. Import your vault to rate.</span>}
                {mine && receipt && identity && !rated && (
                  <span className="rate">
                    <AnonymityNote size={data!.feedbackRaw?.groupSizes[receipt.groupId.toString()] ?? 0} />
                    Rate {t.award?.winnerName}{" "}
                    <select value={scores[id] ?? 5} onChange={(e) => setScores({ ...scores, [id]: Number(e.target.value) })} aria-label="Score">
                      {[5, 4, 3, 2, 1].map((s) => <option key={s} value={s}>{"★".repeat(s)} {s}</option>)}
                    </select>{" "}
                    <button className="small" disabled={!!busy} onClick={() => run(id + "r", "Proving group membership in your browser, then relaying…", async () => {
                      const score = scores[id] ?? 5;
                      const r = await rateAnonymously({ ...ctxOf(veil), receipt }, score, () =>
                        confirm("There is no relayer on this chain. Send the rating from your own wallet? That links the rating to your address."),
                      );
                      updateVault(veil.scope, (v) => {
                        const x = v.identities.find((i) => i.taskId === id);
                        if (x) x.rated = [...(x.rated ?? []), `${receipt.agentId}:${receipt.epoch}`];
                      });
                      return `Rated ${score}/5 as one of ${r.anonymitySet} receipt holders, sent by ${r.via === "relayer" ? `the relayer (${short(r.sender)})` : "your own wallet"}.`;
                    })}>
                      Rate anonymously
                    </button>
                  </span>
                )}
                {rated && <span className="pill sealed">Rated anonymously</span>}
              </div>
            </div>
          );
        })}
      </div>
      </section>

      <section className="card">
      <CardHead title="Agent ratings" sub="Anonymous averages per rating period." />
      {!data!.feedback || data!.feedback.aggregates.length === 0 ? (
        <p className="empty">No ratings yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Agent</th><th>Period</th><th className="num">Ratings</th><th className="num">Average</th><th>Reputation</th></tr></thead>
            <tbody>
              {data!.feedback.aggregates.map((a) => (
                <tr key={`${a.agentId}:${a.epoch}`}>
                  <td>{a.agentName}</td>
                  <td className="mono">{a.epoch.toString()}</td>
                  <td className="num">{a.count}</td>
                  <td className="num">{formatAverage(a.average)}</td>
                  <td>
                    {a.status === "anchored" ? (
                      <Pill value="pass">Published {formatAverage(a.anchoredValue!)}</Pill>
                    ) : a.status === "closed" ? (
                      <button className="small" disabled={!!busy} onClick={() => run(`a${a.agentId}:${a.epoch}`, "Publishing the average…", async () => {
                        await anchor(ctxOf(veil), a.agentId, a.epoch);
                        return `${a.agentName}'s epoch ${a.epoch} average is now part of its public reputation.`;
                      })}>
                        Publish average
                      </button>
                    ) : (
                      <span className="sub">Rating period open</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </section>
    </div>
  );
}

/** How many receipt holders the rater hides among, said plainly before they rate (claims table: small groups give weak
 *  anonymity). The group can still grow until the epoch ends. */
function AnonymityNote({ size }: { size: number }) {
  return (
    <span className={size < 3 ? "error-text" : "sub"} data-testid="anonymity-note">
      {size <= 1
        ? "You're the only receipt holder so far, so a rating now isn't anonymous. Waiting lets more clients join. "
        : size < 3
          ? `Only ${size} receipt holders so far: weak anonymity. `
          : `You'll be one of ${size} receipt holders. `}
    </span>
  );
}
