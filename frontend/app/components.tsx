// Page furniture shared by the server-rendered pages: header, notices, empty and error states.

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: string; title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <span className="page-eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {children && <p className="lede">{children}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/** A one-line notice that expands to the full explanation. The details stay in the HTML, so they are never hidden from
 *  readers who look. */
export function Notice({ title, children, testid, tone = "warn" }: { title: React.ReactNode; children: React.ReactNode; testid?: string; tone?: "warn" | "info" }) {
  return (
    <details className={`notice ${tone}`} data-testid={testid}>
      <summary>
        <span className="notice-dot" />
        <span className="notice-title">{title}</span>
        <span className="notice-more">Details</span>
      </summary>
      <div className="notice-body">{children}</div>
    </details>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card empty-state">
      <strong>{title}</strong>
      {children && <p className="sub">{children}</p>}
    </div>
  );
}

/** The chain could not be read. The developer hint (which make target to run) is tucked away under the message. */
export function ErrorState({ error, hint }: { error: string; hint: React.ReactNode }) {
  return (
    <div className="card error empty-state" role="alert">
      <strong>We couldn't reach the network</strong>
      <p className="sub">The page reads everything live from the chain, and the chain didn't answer.</p>
      <details className="error-details">
        <summary>Technical details</summary>
        <p className="mono">{error}</p>
        <p className="sub">Running locally? {hint}</p>
      </details>
    </div>
  );
}

/** The raw indexer output, one line per fact, kept for anyone who wants the evidence but collapsed by default. */
export function RawFacts({ facts, testid, what = "public facts" }: { facts: string[]; testid: string; what?: string }) {
  return (
    <details className="raw-facts">
      <summary>Show all {facts.length} {what} (raw indexer output)</summary>
      <ul className="leaks" data-testid={testid}>
        {facts.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </details>
  );
}

/** What is still public vs. what never reaches the chain: a short summary on each side, the raw facts underneath. */
export function PrivacyReport({ title, visible, leaks, hidden, leaksTestid }: { title: string; visible: { k: string; v: string }[]; leaks: string[]; hidden: string[]; leaksTestid: string }) {
  return (
    <section className="privacy-report">
      <h2>{title}</h2>
      <div className="split-lists">
        <div className="card">
          <h3>
            <span className="pill leak">Public</span> Anyone can see
          </h3>
          <ul className="fact-list">
            {visible.map((x) => (
              <li key={x.k}>
                <span>{x.k}</span>
                <strong>{x.v}</strong>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h3>
            <span className="pill sealed">Private</span> Never on-chain
          </h3>
          <ul className="sealed-list">
            {hidden.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </div>
      </div>
      <RawFacts facts={leaks} testid={leaksTestid} />
    </section>
  );
}
