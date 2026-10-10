"use client";
import { useState } from "react";
import { formatEther } from "viem";
import { BriefcaseIcon, CheckIcon, ClockIcon, GavelIcon, KeyIcon, ShieldIcon, WalletIcon } from "../icons";
import { connectInjected, DEMO_ACCOUNTS, demoSigner, hasInjectedWallet, reason, skipTime } from "../../lib/app/runtime";
import { HireSection } from "./HireSection";
import { ScreeningSection } from "./ScreeningSection";
import { SecretsSection } from "./SecretsSection";
import { avatarStyle, short } from "./ui";
import { useVeil, type Veil } from "./useVeil";
import { WorkSection } from "./WorkSection";

const TABS = [
  { id: "screen", label: "Private screening", icon: <ShieldIcon size={16} /> },
  { id: "hire", label: "Hire an agent", icon: <BriefcaseIcon size={16} /> },
  { id: "work", label: "Bid on work", icon: <GavelIcon size={16} /> },
  { id: "secrets", label: "My secrets", icon: <KeyIcon size={16} /> },
] as const;
type Tab = (typeof TABS)[number]["id"];

const ROLE_HINTS: Record<number, string> = {
  1: "Owns the agent Atlas. Get qualified, then bid.",
  2: "Owns the agent Borealis. Get qualified, then bid.",
  3: "Owns the agent Cirrus. Get qualified, then bid.",
  4: "Posts tasks, completes jobs, rates anonymously.",
  5: "A second client, to grow the anonymity set.",
  7: "Screens counterparties and executes the gated action.",
};

export function VeilApp() {
  const { veil, error } = useVeil();
  const [tab, setTab] = useState<Tab>("screen");
  if (!veil)
    return (
      <div className={`card ${error ? "error" : ""}`} data-testid="app-loading">
        {error ? (
          <>
            <strong>Cannot start the app.</strong> {error}
            <p className="sub">
              Locally, start everything with <code>make app</code>: a fresh chain with the workflows simulated.
            </p>
          </>
        ) : (
          <>
            <span className="spin" /> Connecting to the chain…
          </>
        )}
      </div>
    );

  return (
    <div data-testid="veil-app">
      {veil.config.local && (
        <p className="sim-banner">
          <span>
            <strong>Local demo chain.</strong> Workflow results (W1 screening, W3 bid opening, W2 receipts) come from a{" "}
            <em>simulation</em> of the Chainlink DON, and the screening provider is a mock with a fictional list. Demo
            accounts use Anvil's public keys: never send real funds to them.
          </span>
        </p>
      )}
      {veil.signer ? (
        <>
          <WalletBar veil={veil} />
          {error && <p className="error-text">Chain read failed: {error}</p>}
          {veil.data && <Guide veil={veil} go={setTab} />}
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "tab active" : "tab"} onClick={() => setTab(t.id)}>
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
          {!veil.data ? (
            <div className="card"><span className="spin" /> Reading the chain…</div>
          ) : tab === "screen" ? (
            <ScreeningSection veil={veil} />
          ) : tab === "hire" ? (
            <HireSection veil={veil} />
          ) : tab === "work" ? (
            <WorkSection veil={veil} />
          ) : (
            <SecretsSection veil={veil} />
          )}
        </>
      ) : (
        <Chooser veil={veil} />
      )}
    </div>
  );
}

function Chooser({ veil }: { veil: Veil }) {
  const { config, setSigner } = veil;
  const [err, setErr] = useState<string | null>(null);
  return (
    <section className="card chooser" data-testid="chooser">
      <h2>Who are you?</h2>
      <p className="sub">
        {config.local
          ? "Pick a role to try the full flow, switching roles as you go, or connect your own wallet."
          : "Connect your wallet to start."}
      </p>
      <div className="roles">
        <button className="role wallet" onClick={() => connectInjected(config).then(setSigner, (e) => setErr(reason(e)))} disabled={!hasInjectedWallet()}>
          <span className="avatar" style={{ display: "grid", placeItems: "center", background: "var(--surface-2)" }}>
            <WalletIcon />
          </span>
          <strong>Browser wallet</strong>
          <span>{hasInjectedWallet() ? "MetaMask or similar. The app adds this chain for you." : "No browser wallet found."}</span>
        </button>
        {config.local &&
          DEMO_ACCOUNTS.map((a) => {
            const s = demoSigner(config, a.index, `${a.label} (demo account)`);
            return (
              <button key={a.index} className="role" data-testid={`role-${a.index}`} onClick={() => setSigner(s)}>
                <span className="avatar" style={avatarStyle(s.address)} />
                <strong>{a.label}</strong>
                <span>{ROLE_HINTS[a.index]}</span>
                <span className="mono">{short(s.address)}</span>
              </button>
            );
          })}
      </div>
      {err && <p className="error-text">{err}</p>}
    </section>
  );
}

function WalletBar({ veil }: { veil: Veil }) {
  const { config, signer, setSigner, data, client } = veil;
  const [err, setErr] = useState<string | null>(null);
  const role = signer && data ? describe(veil) : null;
  return (
    <section className="card wallet-bar" data-testid="wallet-bar">
      <div className="wallet-row">
        <div className="who">
          <span className="avatar" style={avatarStyle(signer!.address)} />
          <div>
            <div className="name">
              {signer!.label}
              {role && !signer!.label.toLowerCase().includes(role) && <span className="pill sealed">{role}</span>}
            </div>
            <div className="mono">{signer!.address}</div>
          </div>
        </div>
        <div className="actions" style={{ marginTop: 0 }}>
          {data?.balance != null && (
            <span className="pill neutral">
              {Number(formatEther(data.balance)).toFixed(2)} {config.chainId === 10143 ? "MON" : "ETH"}
            </span>
          )}
          <button onClick={() => setSigner(null)}>Switch account</button>
        </div>
      </div>
      {data && (
        <div className="chain-row sub">
          <ClockIcon size={15} /> Chain {config.chainId} · block time {new Date(Number(data.now) * 1000).toISOString().replace(".000Z", "Z").replace("T", " ")}
          <span className="spacer" />
          {config.local && (
            <>
              Skip ahead (Anvil only):
              {[
                ["10 min", 600],
                ["1 h", 3600],
                ["2 h", 7200],
              ].map(([label, s]) => (
                <button key={label} className="small" onClick={() => skipTime(client, s as number).then(veil.refresh, (e) => setErr(reason(e)))}>
                  +{label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {err && <p className="error-text">{err}</p>}
    </section>
  );
}

/** Where the demo flow stands on this chain, as a clickable checklist. */
function Guide({ veil, go }: { veil: Veil; go: (t: Tab) => void }) {
  const d = veil.data!;
  const tasks = d.auction?.tasks ?? [];
  const steps: { t: string; done: boolean; tab: Tab }[] = [
    { t: "Qualify an agent", done: (d.veil?.rows ?? []).some((r) => r.agentLevel && r.policyName === "QUALIFIED_SCREENER_V1" && r.result === "pass"), tab: "work" },
    { t: "Post a task", done: tasks.length > 0, tab: "hire" },
    { t: "Place sealed bids", done: tasks.some((x) => x.bids.length > 0), tab: "work" },
    { t: "Close & award", done: tasks.some((x) => x.award), tab: "hire" },
    { t: "Complete the job", done: tasks.some((x) => x.status === "completed"), tab: "hire" },
    { t: "Rate anonymously", done: (d.feedback?.ratings.length ?? 0) > 0, tab: "hire" },
  ];
  const next = steps.findIndex((s) => !s.done);
  return (
    <div className="guide" data-testid="guide">
      {steps.map((s, i) => (
        <button key={s.t} className={s.done ? "done" : i === next ? "next" : undefined} onClick={() => go(s.tab)}>
          <span className="n">{s.done ? <CheckIcon size={12} /> : null}Step {i + 1}</span>
          <span className="t">{s.t}</span>
        </button>
      ))}
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
