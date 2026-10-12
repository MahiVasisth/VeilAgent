"use client";
import { usePathname } from "next/navigation";
import { LogoMark } from "./icons";

const LINKS = [
  ["/app", "Dashboard"],
  ["/auction", "Auctions"],
  ["/indexer", "Explorer"],
  ["/audit", "Verify"],
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
          <span className="live" /> Local network
        </span>
        {path !== "/app" && (
          <a href="/app" className="btn primary">
            Launch app
          </a>
        )}
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="inner">
        <div className="footer-brand">
          <a href="/" className="brand" aria-label="Veil8004 home">
            <span className="brand-mark"><LogoMark /></span>
            Veil8004
          </a>
          <p>Private hiring, screening and ratings for ERC-8004 agents. Demo data is fictional.</p>
        </div>
        <nav aria-label="Product">
          <strong>Product</strong>
          <a href="/app">Dashboard</a>
          <a href="/auction">Auctions</a>
          <a href="/audit">Verify a disclosure</a>
        </nav>
        <nav aria-label="Transparency">
          <strong>Transparency</strong>
          <a href="/indexer">Explorer</a>
          <a href="/costs">Gas costs</a>
          <a href="/claims">Security claims</a>
        </nav>
      </div>
    </footer>
  );
}
