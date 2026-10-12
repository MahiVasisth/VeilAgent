"use client";
// The explorer's interactive views: a searchable, filterable activity feed with a detail panel, and an agent
// directory. Data comes pre-built from the server (lib/activity.ts); nothing here talks to the chain.
import { useMemo, useState } from "react";
import type { ActivityEvent, EventKind } from "../../lib/activity";
import { avatarStyle, short } from "../../lib/format";
import { BriefcaseIcon, CheckIcon, EyeIcon, GavelIcon, LockIcon, ShieldIcon, StarIcon, WalletIcon } from "../icons";

export type AgentRow = {
  id: string;
  name: string;
  owner: string;
  qualification: "qualified" | "expired" | "rejected" | "pending" | "none";
  bids: number;
  wins: number;
  plainRatings: number[];
  anonAverage: string | null;
  anonCount: number;
  lastBlock: number | null;
};

const KIND: Record<EventKind, { label: string; icon: React.ReactNode }> = {
  screening: { label: "Screening", icon: <ShieldIcon size={15} /> },
  result: { label: "Result", icon: <CheckIcon size={15} /> },
  payout: { label: "Payout", icon: <WalletIcon size={15} /> },
  task: { label: "Task", icon: <BriefcaseIcon size={15} /> },
  bid: { label: "Bid", icon: <LockIcon size={15} /> },
  award: { label: "Award", icon: <GavelIcon size={15} /> },
  rating: { label: "Rating", icon: <StarIcon size={15} /> },
  anchor: { label: "Reputation", icon: <StarIcon size={15} /> },
  payment: { label: "Payment", icon: <WalletIcon size={15} /> },
};
const FILTERS: { id: string; label: string; kinds: EventKind[] | null }[] = [
  { id: "all", label: "All", kinds: null },
  { id: "screen", label: "Screenings", kinds: ["screening", "result", "payout"] },
  { id: "hire", label: "Hiring", kinds: ["task", "bid", "award", "payment"] },
  { id: "rate", label: "Ratings", kinds: ["rating", "anchor"] },
];

function age(t: number | null, now: number) {
  if (t === null) return "—";
  const s = Math.max(0, now - t);
  return s < 5 ? "just now" : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 172800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
}

export function ActivityFeed({ events, now }: { events: ActivityEvent[]; now: number }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [system, setSystem] = useState<"both" | "plain" | "veil">("both");
  const [selected, setSelected] = useState<string | null>(events[0]?.id ?? null);

  const shown = useMemo(() => {
    const kinds = FILTERS.find((f) => f.id === filter)!.kinds;
    const needle = q.trim().toLowerCase();
    return events.filter(
      (e) =>
        (!kinds || kinds.includes(e.kind)) &&
        (system === "both" || e.system === system) &&
        (!needle || [e.title, e.summary, e.agent ?? "", e.actor ?? "", e.txHash, ...e.fields.map((f) => f.v)].some((s) => s.toLowerCase().includes(needle))),
    );
  }, [events, q, filter, system]);
  const current = shown.find((e) => e.id === selected) ?? shown[0] ?? null;
  const count = (kinds: EventKind[] | null) => events.filter((e) => (!kinds || kinds.includes(e.kind)) && (system === "both" || e.system === system)).length;

  return (
    <div className="explorer">
      <div className="ex-toolbar">
        <label className="ex-search">
          <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by agent, address, transaction or text" aria-label="Search activity" />
          {q && <button type="button" className="ex-clear" onClick={() => setQ("")} aria-label="Clear search">×</button>}
        </label>
        <div className="segmented small-seg" role="radiogroup" aria-label="Which system">
          {(["both", "plain", "veil"] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={system === s} className={system === s ? "on" : ""} onClick={() => setSystem(s)}>
              {s === "both" ? "Both" : s === "plain" ? <><EyeIcon size={13} /> Plain ERC-8004</> : <><LockIcon size={13} /> Veil8004</>}
            </button>
          ))}
        </div>
      </div>
      <div className="ex-chips" role="tablist" aria-label="Event type">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={`chip ${filter === f.id ? "on" : ""}`} onClick={() => setFilter(f.id)}>
            {f.label} <span className="count">{count(f.kinds)}</span>
          </button>
        ))}
      </div>

      <div className="ex-body">
        <div className="card ex-table">
          <div className="ex-head" aria-hidden>
            <span>Event</span><span>Details</span><span>From</span><span>Block</span><span>Age</span>
          </div>
          {shown.length === 0 ? (
            <p className="empty">No events match. <button type="button" className="link-btn" onClick={() => { setQ(""); setFilter("all"); setSystem("both"); }}>Clear filters</button></p>
          ) : (
            <ul className="ex-rows">
              {shown.map((e) => (
                <li key={e.id}>
                  <button type="button" className={`ex-row ${current?.id === e.id ? "on" : ""}`} onClick={() => setSelected(e.id)}>
                    <span className="ex-kind">
                      <span className={`ex-icon ${e.system}`}>{KIND[e.kind].icon}</span>
                      <span className="ex-kind-text">
                        <strong>{e.title}</strong>
                        <span className={`sys ${e.system}`}>{e.system === "plain" ? "ERC-8004 · public" : "Veil8004"}</span>
                      </span>
                    </span>
                    <span className="ex-summary">{e.summary}</span>
                    <span className="ex-from">{e.actor ? <><span className="avatar xs" style={avatarStyle(e.actor)} /><span className="mono">{short(e.actor)}</span></> : <span className="faint">workflow</span>}</span>
                    <span className="mono ex-block">{e.block ?? "—"}</span>
                    <span className="ex-age faint">{age(e.time, now)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="ex-foot faint">{shown.length} of {events.length} events · rebuilt from public chain data</div>
        </div>

        {current && <Detail e={current} now={now} />}
      </div>
    </div>
  );
}

function Detail({ e, now }: { e: ActivityEvent; now: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <aside className="card ex-detail" aria-label="Event details">
      <div className="ex-detail-head">
        <span className={`ex-icon big ${e.system}`}>{KIND[e.kind].icon}</span>
        <div>
          <h3>{e.title}</h3>
          <span className={`pill ${e.system === "plain" ? "leak" : "sealed"}`}>{e.system === "plain" ? "Plain ERC-8004 · fully public" : "Veil8004 · private parts sealed"}</span>
        </div>
      </div>
      <p className="ex-detail-sum">{e.summary}</p>
      <dl className="ex-fields">
        <div>
          <dt>Transaction</dt>
          <dd className="mono">
            {short(e.txHash)}{" "}
            <button type="button" className="link-btn" onClick={() => navigator.clipboard?.writeText(e.txHash).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })}>
              {copied ? "copied" : "copy"}
            </button>
          </dd>
        </div>
        <div><dt>Block</dt><dd className="mono">{e.block ?? "—"} <span className="faint">· {age(e.time, now)}</span></dd></div>
      </dl>
      <div className="ex-section-label"><EyeIcon size={13} /> On-chain, readable by anyone</div>
      <dl className="ex-fields">
        {e.fields.map((f) => (
          <div key={f.k}>
            <dt>{f.k}</dt>
            <dd className={`${f.mono ? "mono" : ""} ${f.leak ? "leak" : ""}`}>{f.v}</dd>
          </div>
        ))}
      </dl>
      {e.system === "veil" ? (
        e.sealed.length > 0 && (
          <>
            <div className="ex-section-label sealed-text"><LockIcon size={13} /> Never on-chain</div>
            <ul className="ex-sealed">
              {e.sealed.map((s) => <li key={s}><LockIcon size={12} /> {s}</li>)}
            </ul>
          </>
        )
      ) : (
        <p className="ex-warn"><EyeIcon size={13} /> Nothing in this event is private. Highlighted fields identify a client, a counterparty or a price.</p>
      )}
    </aside>
  );
}

export function AgentDirectory({ agents }: { agents: AgentRow[] }) {
  const Q = { qualified: ["pass", "Qualified"], expired: ["neutral", "Expired"], rejected: ["fail", "Rejected"], pending: ["pending", "Checking"], none: ["neutral", "Not qualified"] } as const;
  return (
    <div className="agent-grid">
      {agents.map((a) => {
        const plainAvg = a.plainRatings.length ? Math.round(a.plainRatings.reduce((s, x) => s + x, 0) / a.plainRatings.length) : null;
        return (
          <div key={a.id} className="card agent-card">
            <div className="agent-top">
              <span className="avatar" style={avatarStyle(a.owner + a.id)} />
              <div>
                <strong>{a.name}</strong>
                <span className="mono faint">#{a.id} · owner {short(a.owner)}</span>
              </div>
              <span className={`pill ${Q[a.qualification][0]}`}>{Q[a.qualification][1]}</span>
            </div>
            <div className="agent-stats">
              <div><b>{a.wins}</b><span>jobs won</span></div>
              <div><b>{a.bids}</b><span>sealed bids</span></div>
              <div><b className="sealed-text">{a.anonAverage ?? "—"}</b><span>anon. rating{a.anonCount ? ` (${a.anonCount})` : ""}</span></div>
              <div><b className={plainAvg !== null ? "leak" : ""}>{plainAvg ?? "—"}</b><span>public rating</span></div>
            </div>
            <div className="agent-foot faint">{a.lastBlock !== null ? `Last activity in block ${a.lastBlock}` : "No activity yet"}</div>
          </div>
        );
      })}
    </div>
  );
}
