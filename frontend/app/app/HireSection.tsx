"use client";
import { useState } from "react";
import { formatUnits } from "viem";
import { formatAverage } from "@veil8004/sdk";
import { anchor, closeBidding, markCompleted, postTask, rateAnonymously } from "../../lib/app/actions";
import { updateVault } from "../../lib/app/vault";
import { ctxOf, Explain, Pill, short, useRun, when } from "./ui";
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
    <section className="card" data-testid="hire">
      <h2>Hire an agent</h2>
      <Explain>
        Post a task; agents that hold <code>QUALIFIED_SCREENER_V1</code> bid with sealed prices; after the deadline the
        bid opener (W3) awards the lowest. A new anonymous identity is made for each task in this browser. When you
        mark the job completed you get a receipt (W2), which lets you rate the agent without saying which client you are.
      </Explain>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          run("post", "Posting the task…", async () => `Task ${await postTask(ctxOf(veil), { category, minutes })} posted. Bidding is open until the deadline.`);
        }}
      >
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>
          Bidding open for (minutes)
          <input type="number" min={1} max={10080} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        </label>
        <button type="submit" disabled={!!busy}>Post task</button>
      </form>
      <Status />

      <h3>Tasks</h3>
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
                <strong>Task #{id}</strong> <Pill value={t.status} />
                {mine && <span className="tag">yours</span>}
                <span className="sub"> · {t.categoryName ?? short(t.category)} · deadline {when(t.deadline)} · {t.bids.length} sealed bid{t.bids.length === 1 ? "" : "s"}</span>
              </div>
              {t.award && (
                <div className="sub">
                  Awarded to <strong>{t.award.winnerName}</strong> at {formatUnits(t.award.winningPrice, 18)} ({t.award.validBidCount} counted). Losing prices stay sealed.
                </div>
              )}
              <div className="actions">
                {t.status === "open" && past && (
                  <button className="small" disabled={!!busy} onClick={() => run(id + "c", "Closing bidding…", async () => {
                    await closeBidding(ctxOf(veil), t.taskId);
                    return `Bidding closed on task ${id}. W3 is opening the sealed bids…`;
                  })}>
                    Close bidding
                  </button>
                )}
                {t.status === "open" && !past && <span className="sub">bidding open</span>}
                {t.status === "closed" && <span className="sub">waiting for W3's award…</span>}
                {mine && t.status === "awarded" && (
                  <button className="small" disabled={!!busy} onClick={() => run(id + "m", "Marking completed…", async () => {
                    await markCompleted(ctxOf(veil), t.taskId);
                    return `Task ${id} completed. W2 issues your receipt in a few seconds.`;
                  })}>
                    Mark job completed
                  </button>
                )}
                {mine && t.status === "completed" && !receipt && <span className="sub">waiting for your receipt (W2)…</span>}
                {mine && receipt && !identity && <span className="sub">receipt issued, but this browser lacks the task's identity, so it cannot rate</span>}
                {mine && receipt && identity && !rated && (
                  <span className="rate">
                    <AnonymityNote size={data!.feedbackRaw?.groupSizes[receipt.groupId.toString()] ?? 0} />
                    Rate {t.award?.winnerName}:{" "}
                    <select value={scores[id] ?? 5} onChange={(e) => setScores({ ...scores, [id]: Number(e.target.value) })} aria-label="Score">
                      {[5, 4, 3, 2, 1].map((s) => <option key={s} value={s}>{s}</option>)}
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
                {rated && <span className="sub">you rated this job anonymously</span>}
              </div>
            </div>
          );
        })}
      </div>

      <h3>Anonymous ratings (per agent and epoch)</h3>
      {!data!.feedback || data!.feedback.aggregates.length === 0 ? (
        <p className="empty">No ratings yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Agent</th><th>Epoch</th><th>Ratings</th><th>Average</th><th>ERC-8004 Reputation</th></tr></thead>
            <tbody>
              {data!.feedback.aggregates.map((a) => (
                <tr key={`${a.agentId}:${a.epoch}`}>
                  <td>{a.agentName}</td>
                  <td className="mono">{a.epoch.toString()}</td>
                  <td>{a.count}</td>
                  <td>{formatAverage(a.average)}</td>
                  <td>
                    {a.status === "anchored" ? (
                      `anchored ${formatAverage(a.anchoredValue!)}`
                    ) : a.status === "closed" ? (
                      <button className="small" disabled={!!busy} onClick={() => run(`a${a.agentId}:${a.epoch}`, "Anchoring…", async () => {
                        await anchor(ctxOf(veil), a.agentId, a.epoch);
                        return `${a.agentName}'s epoch ${a.epoch} average is now in the ERC-8004 Reputation Registry.`;
                      })}>
                        Anchor average
                      </button>
                    ) : (
                      "rating window open"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** How many receipt holders the rater hides among, said plainly before they rate (claims table: small groups give weak
 *  anonymity). The group can still grow until the epoch ends. */
function AnonymityNote({ size }: { size: number }) {
  return (
    <span className={size < 3 ? "error-text" : "sub"} data-testid="anonymity-note">
      {size <= 1
        ? "You are the only receipt holder in this group so far: a rating now is not anonymous. Waiting lets more clients join. "
        : size < 3
          ? `Only ${size} receipt holders so far: weak anonymity. `
          : `You will be one of ${size} receipt holders. `}
    </span>
  );
}
