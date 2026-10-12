"use client";
import { useState } from "react";
import { formatEther } from "viem";
import {
  BriefcaseIcon,
  CheckIcon,
  ChevronIcon,
  FastForwardIcon,
  GavelIcon,
  GridIcon,
  KeyIcon,
  LockIcon,
  LogoutIcon,
  ShieldIcon,
  WalletIcon,
} from "../icons";
import { connectInjected, DEMO_ACCOUNTS, demoSigner, hasInjectedWallet, reason, skipTime } from "../../lib/app/runtime";
import { HireSection } from "./HireSection";
import { ScreeningSection } from "./ScreeningSection";
import { SecretsSection } from "./SecretsSection";
import { avatarStyle, label, Pill, relative, short, when } from "./ui";
import { useVeil, type Veil } from "./useVeil";
import { WorkSection } from "./WorkSection";

const TABS = [
  { id: "overview", label: "Overview", icon: <GridIcon size={17} />, title: "Overview", sub: "Your activity on Veil8004 at a glance." },
  { id: "hire", label: "Hire", icon: <BriefcaseIcon size={17} />, title: "Hire an agent", sub: "Post tasks, hire the best bid, rate anonymously." },
  { id: "work", label: "Find work", icon: <GavelIcon size={17} />, title: "Find work", sub: "Qualify your agents and place sealed bids on open tasks." },
  { id: "screen", label: "Screening", icon: <ShieldIcon size={17} />, title: "Private screening", sub: "Check a counterparty without publishing who." },
  { id: "secrets", label: "Vault", icon: <KeyIcon size={17} />, title: "Vault", sub: "Keys and openings kept only in this browser." },
] as const;
type Tab = (typeof TABS)[number]["id"];

const ROLES: Record<number, { name: string; role: string; hint: string }> = {
  1: { name: "Atlas", role: "Agent owner", hint: "Get Atlas qualified, then bid on tasks." },
  2: { name: "Borealis", role: "Agent owner", hint: "Get Borealis qualified, then bid on tasks." },
  3: { name: "Cirrus", role: "Agent owner", hint: "Get Cirrus qualified, then bid on tasks." },
  4: { name: "Client A", role: "Client", hint: "Post tasks, complete jobs, rate anonymously." },
  5: { name: "Client B", role: "Client", hint: "A second client, which grows the anonymity set." },
  7: { name: "Treasury desk", role: "Operator", hint: "Screen counterparties and run the gated payout." },
};

export function VeilApp() {
  const { veil, error } = useVeil();
  const [tab, setTab] = useState<Tab>("overview");
  if (!veil)
    return (
      <div className="connect-wrap">
        <div className={`card connect ${error ? "error" : ""}`} data-testid="app-loading">
          {error ? (
            <>
              <h2>Can't reach the network</h2>
              <p className="sub">{error}</p>
              <p className="sub">
                Running locally? Start everything with <code>make app</code>.
              </p>
            </>
          ) : (
            <p className="sub">
              <span className="spin" /> Connecting…
            </p>
          )}
        </div>
      </div>
    );

  if (!veil.signer) return <Chooser veil={veil} />;

  const current = TABS.find((t) => t.id === tab)!;
  const d = veil.data;
  const me = veil.signer.address.toLowerCase();
  const badge: Partial<Record<Tab, number>> = d
    ? {
        hire: (d.auction?.tasks ?? []).filter((t) => t.client.toLowerCase() === me && t.status !== "completed").length,
        work: (d.auction?.tasks ?? []).filter((t) => t.status === "open" && d.now < t.deadline).length,
      }
    : {};

  return (
    <div className="app-shell" data-testid="veil-app">
      <aside className="app-side">
        <nav role="tablist" aria-label="App sections">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "side-link active" : "side-link"} onClick={() => setTab(t.id)}>
              {t.icon}
              <span>{t.label}</span>
              {!!badge[t.id] && <span className="count">{badge[t.id]}</span>}
            </button>
          ))}
        </nav>
        {veil.config.local && <DevTools veil={veil} />}
      </aside>

      <div className="app-main">
        <div className="app-topbar">
          <div>
            <h1>{current.title}</h1>
            <p className="sub">{current.sub}</p>
          </div>
          <Account veil={veil} />
        </div>
        {error && <p className="toast error-text inline-alert">Lost connection to the chain: {error}</p>}
        {!d ? (
          <div className="card skeleton">
            <span className="spin" /> Loading your data…
          </div>
        ) : tab === "overview" ? (
          <Overview veil={veil} go={setTab} />
        ) : tab === "screen" ? (
          <ScreeningSection veil={veil} />
        ) : tab === "hire" ? (
          <HireSection veil={veil} />
        ) : tab === "work" ? (
          <WorkSection veil={veil} />
        ) : (
          <SecretsSection veil={veil} />
        )}
      </div>
    </div>
  );
}

/** Sign-in: a browser wallet, or (on a local chain only) one of Anvil's public demo accounts. */
function Chooser({ veil }: { veil: Veil }) {
  const { config, setSigner } = veil;
  const [err, setErr] = useState<string | null>(null);
  const injected = hasInjectedWallet();
  return (
    <div className="connect-wrap">
      <section className="card connect" data-testid="chooser">
        <span className="brand-mark big">
          <LockIcon size={22} />
        </span>
        <h2>Sign in to Veil8004</h2>
        <p className="sub">Hire AI agents, screen counterparties and leave feedback without exposing who you are or what you paid.</p>
        <button className={injected ? "primary wide-btn" : "wide-btn"} onClick={() => connectInjected(config).then(setSigner, (e) => setErr(reason(e)))} disabled={!injected}>
          <WalletIcon size={17} /> {injected ? "Connect wallet" : "No browser wallet detected"}
        </button>
        {err && <p className="error-text">{err}</p>}
        {config.local && (
          <>
            <div className="divider">
              <span>or continue with a demo account</span>
            </div>
            <div className="account-list">
              {DEMO_ACCOUNTS.map((a) => {
                const r = ROLES[a.index]!;
                const s = demoSigner(config, a.index, r.name);
                return (
                  <button key={a.index} className="account-row" data-testid={`role-${a.index}`} onClick={() => setSigner(s)}>
                    <span className="avatar" style={avatarStyle(s.address)} />
                    <span className="account-text">
                      <strong>
                        {r.name} <span className="pill neutral">{r.role}</span>
                      </strong>
                      <span className="sub">{r.hint}</span>
                    </span>
                    <span className="mono faint">{short(s.address)}</span>
                    <ChevronIcon size={16} />
                  </button>
                );
              })}
            </div>
            <p className="fine">Demo accounts use Anvil's public test keys on a local chain. Never send real funds to them.</p>
          </>
        )}
      </section>
    </div>
  );
}

function Account({ veil }: { veil: Veil }) {
  const { config, signer, setSigner, data } = veil;
  const role = data ? describe(veil) : null;
  return (
    <div className="account" data-testid="wallet-bar">
      {data?.balance != null && (
        <span className="balance">
          {Number(formatEther(data.balance)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {config.chainId === 10143 ? "MON" : "ETH"}
        </span>
      )}
      <div className="account-chip" title={signer!.address}>
        <span className="avatar" style={avatarStyle(signer!.address)} />
        <span className="account-text">
          <strong>{signer!.label}</strong>
          <span className="mono faint">{role || short(signer!.address)}</span>
        </span>
      </div>
      <button className="icon-btn" onClick={() => setSigner(null)} title="Switch account" aria-label="Switch account">
        <LogoutIcon size={17} />
      </button>
    </div>
  );
}

/** Local-chain helpers, kept out of the main UI: the network notice and Anvil time travel. */
function DevTools({ veil }: { veil: Veil }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="devtools">
      <div className="devtools-head">
        <span className="live" /> Local demo network
      </div>
      <p>
        Screening, bid opening and receipts come from a <em>simulated</em> Chainlink DON; the screening provider is a mock. <a href="/claims">Details</a>
      </p>
      {veil.data && <p className="mono faint">Chain clock {when(veil.data.now)}</p>}
      <div className="devtools-row">
        <FastForwardIcon size={14} />
        {(
          [
            ["10m", 600],
            ["1h", 3600],
            ["2h", 7200],
          ] as const
        ).map(([l, s]) => (
          <button key={l} className="small" onClick={() => skipTime(veil.client, s).then(veil.refresh, (e) => setErr(reason(e)))}>
            +{l}
          </button>
        ))}
      </div>
      {err && <p className="error-text">{err}</p>}
    </div>
  );
}

function Overview({ veil, go }: { veil: Veil; go: (t: Tab) => void }) {
  const d = veil.data!;
  const me = veil.signer!.address.toLowerCase();
  const tasks = [...(d.auction?.tasks ?? [])].sort((a, b) => Number(b.taskId - a.taskId));
  const myAgents = d.graph.agents.filter((a) => a.owner.toLowerCase() === me);
  const qualified = myAgents.filter((a) =>
    (d.veil?.rows ?? []).some((r) => r.agentId === a.agentId && r.agentLevel && r.policyName === "QUALIFIED_SCREENER_V1" && r.result === "pass" && !r.expired),
  );
  const open = tasks.filter((t) => t.status === "open" && d.now < t.deadline);
  const stats = [
    { n: tasks.filter((t) => t.client.toLowerCase() === me).length, l: "Tasks you posted", tab: "hire" as Tab },
    { n: open.length, l: "Open for bids", tab: "work" as Tab },
    { n: myAgents.length ? `${qualified.length}/${myAgents.length}` : "0", l: "Your agents qualified", tab: "work" as Tab },
    { n: d.feedback?.ratings.length ?? 0, l: "Anonymous ratings", tab: "hire" as Tab },
  ];

  const steps: { t: string; s: string; done: boolean; tab: Tab }[] = [
    { t: "Qualify an agent", s: "An agent owner proves a screener credential privately.", done: (d.veil?.rows ?? []).some((r) => r.agentLevel && r.policyName === "QUALIFIED_SCREENER_V1" && r.result === "pass"), tab: "work" },
    { t: "Post a task", s: "A client opens a task for sealed bids.", done: tasks.length > 0, tab: "hire" },
    { t: "Place sealed bids", s: "Qualified agents bid; prices stay hidden.", done: tasks.some((x) => x.bids.length > 0), tab: "work" },
    { t: "Close bidding", s: "After the deadline the lowest bid wins.", done: tasks.some((x) => x.award), tab: "hire" },
    { t: "Complete the job", s: "The client confirms and receives a receipt.", done: tasks.some((x) => x.status === "completed"), tab: "hire" },
    { t: "Rate anonymously", s: "Rate as one of many receipt holders.", done: (d.feedback?.ratings.length ?? 0) > 0, tab: "hire" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.findIndex((s) => !s.done);

  return (
    <div className="stack">
      <div className="kpis">
        {stats.map((s) => (
          <button key={s.l} className="card kpi" onClick={() => go(s.tab)}>
            <span className="n">{s.n}</span>
            <span className="l">{s.l}</span>
          </button>
        ))}
      </div>

      <div className="two-col">
        <section className="card" data-testid="guide">
          <div className="card-head">
            <div>
              <h2>Getting started</h2>
              <p className="sub">
                {doneCount === steps.length ? "You've run the whole flow." : `${doneCount} of ${steps.length} done. Switch accounts as you go.`}
              </p>
            </div>
          </div>
          <div className="progress">
            <span style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          <ol className="checklist">
            {steps.map((s, i) => (
              <li key={s.t} className={s.done ? "done" : i === next ? "next" : undefined}>
                <span className="check">{s.done ? <CheckIcon size={13} /> : i + 1}</span>
                <span className="checklist-text">
                  <strong>{s.t}</strong>
                  <span className="sub">{s.s}</span>
                </span>
                {!s.done && (
                  <button className="small" onClick={() => go(s.tab)}>
                    {i === next ? "Start" : "Open"}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>Recent tasks</h2>
              <p className="sub">Across all clients on this network.</p>
            </div>
            <button className="small" onClick={() => go("hire")}>
              View all
            </button>
          </div>
          {tasks.length === 0 ? (
            <div className="empty">
              No tasks yet.
              <br />
              <button className="small primary" style={{ marginTop: 10 }} onClick={() => go("hire")}>
                Post the first task
              </button>
            </div>
          ) : (
            <ul className="rows">
              {tasks.slice(0, 6).map((t) => (
                <li key={t.taskId.toString()}>
                  <span className="row-main">
                    <strong>{label(t.categoryName ?? short(t.category))}</strong>
                    <span className="sub">
                      Task #{t.taskId.toString()} · {t.bids.length} sealed bid{t.bids.length === 1 ? "" : "s"}
                      {t.status === "open" ? ` · closes ${relative(t.deadline, d.now)}` : t.award ? ` · ${t.award.winnerName}` : ""}
                    </span>
                  </span>
                  {t.client.toLowerCase() === me && <span className="tag">yours</span>}
                  <Pill value={t.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function describe(veil: Veil): string {
  const me = veil.signer!.address.toLowerCase();
  const parts: string[] = [];
  const agents = veil.data!.graph.agents.filter((a) => a.owner.toLowerCase() === me);
  if (agents.length) parts.push(`owns ${agents.map((a) => a.name).join(", ")}`);
  if (veil.d.veil?.treasuryOperator.toLowerCase() === me) parts.push("treasury operator");
  return parts.join(" · ");
}
