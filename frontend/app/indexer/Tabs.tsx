"use client";
// Tabs over server-rendered panels. Every panel stays in the HTML (hidden, not removed), so the page reads the same to
// a crawler or a curl check; the URL hash remembers the open tab.
import { Children, useEffect, useState } from "react";

export function Tabs({ tabs, children }: { tabs: { id: string; label: string; count?: number }[]; children: React.ReactNode }) {
  const [active, setActive] = useState(tabs[0]!.id);
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1);
      if (tabs.some((t) => t.id === h)) setActive(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [tabs]);
  const panels = Children.toArray(children);
  return (
    <>
      <nav className="filter-tabs page-tabs" role="tablist" aria-label="Explorer views">
        {tabs.map((t) => (
          <a
            key={t.id}
            href={`#${t.id}`}
            role="tab"
            aria-selected={active === t.id}
            className={active === t.id ? "on" : undefined}
            onClick={(e) => {
              e.preventDefault();
              setActive(t.id);
              history.replaceState(null, "", `#${t.id}`);
            }}
          >
            {t.label} {t.count != null && <span className="count">{t.count}</span>}
          </a>
        ))}
      </nav>
      {panels.map((p, i) => (
        <div key={tabs[i]!.id} role="tabpanel" hidden={active !== tabs[i]!.id}>
          {p}
        </div>
      ))}
    </>
  );
}
