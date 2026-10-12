"use client";
// One hire, seen through two lenses. Flip the switch and watch what an observer loses. Example data is fictional.
import { useEffect, useState } from "react";
import { EyeIcon, LockIcon } from "../icons";

const ROWS: { k: string; plain: string; veil: string; hidden?: boolean }[] = [
  { k: "Who was screened", plain: "Northwind Trading LLC", veil: "0x7f56…a3c1", hidden: true },
  { k: "Screening result", plain: "pass", veil: "pass" },
  { k: "Who hired", plain: "0x15d3…6A65", veil: "one of 7 clients", hidden: true },
  { k: "Agent hired", plain: "Atlas", veil: "Atlas" },
  { k: "Losing bids", plain: "3,480 · 3,905", veil: "never published", hidden: true },
  { k: "Price paid", plain: "3,100", veil: "3,100" },
  { k: "Rating", plain: "0x15d3… gave 90/100", veil: "5/5 from one of 7", hidden: true },
];

export function ViewToggle() {
  const [veil, setVeil] = useState(true);
  const [touched, setTouched] = useState(false);
  // Flip on its own until the visitor takes over, so the difference is visible without a click.
  useEffect(() => {
    if (touched || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setVeil((v) => !v), 3200);
    return () => clearInterval(t);
  }, [touched]);
  const set = (v: boolean) => { setTouched(true); setVeil(v); };
  const hidden = ROWS.filter((r) => r.hidden).length;

  return (
    <div className={`lens card ${veil ? "is-veil" : "is-plain"}`}>
      <div className="lens-head">
        <div className="segmented" role="tablist" aria-label="Choose a view">
          <button role="tab" aria-selected={!veil} className={!veil ? "on" : ""} onClick={() => set(false)}>
            <EyeIcon size={15} /> Plain ERC-8004
          </button>
          <button role="tab" aria-selected={veil} className={veil ? "on" : ""} onClick={() => set(true)}>
            <LockIcon size={15} /> Veil8004
          </button>
        </div>
        <span className={`pill ${veil ? "sealed" : "leak"}`}>{veil ? `${hidden} of ${ROWS.length} facts hidden` : `${ROWS.length} of ${ROWS.length} facts public`}</span>
      </div>
      <ul className="lens-rows">
        {ROWS.map((r) => (
          <li key={r.k} className={r.hidden ? "changes" : ""}>
            <span className="k">{r.k}</span>
            <span className="v" key={veil ? "v" : "p"}>
              {veil && r.hidden && <LockIcon size={13} />} {veil ? r.veil : r.plain}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
