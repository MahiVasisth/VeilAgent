"use client";
import { usePathname } from "next/navigation";
import { LogoMark } from "./icons";

const LINKS = [
  ["/app", "App"],
  ["/indexer", "Indexer view"],
  ["/auction", "Auctions"],
  ["/audit", "Audit"],
  ["/costs", "Costs"],
  ["/claims", "Claims"],
] as const;

export function SiteHeader() {
  const path = usePathname();
  return (
    <header className="site-header">
      <div className="inner">
        <a href="/" className="brand" aria-label="Veil8004 home">
          <span className="brand-mark"><LogoMark /></span>
          Veil8004
        </a>
        <nav className="site-nav" aria-label="Main">
          {LINKS.map(([href, label]) => (
            <a key={href} href={href} className={path === href ? "active" : undefined} aria-current={path === href ? "page" : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <span className="net-chip" title="Workflow results come from the local runner, a simulation of the Chainlink DON">
          <span className="live" /> Local chain · simulated DON
        </span>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="inner">
        <span>Veil8004: private attestations for ERC-8004 agents. Demo data is fictional.</span>
        <span>
          ERC-8004 · Chainlink CRE · Semaphore V4 · Monad · <a href="/claims">what we claim</a>
        </span>
      </div>
    </footer>
  );
}
