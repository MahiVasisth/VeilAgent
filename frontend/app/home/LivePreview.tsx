"use client";
// The hero's animated preview: sealed bids arrive, bidding closes, only the winner opens, then an anonymous rating.
// Example data; it loops, and holds still on the final frame for reduced-motion users.
import { useEffect, useState } from "react";
import { CheckIcon, LockIcon, StarIcon } from "../icons";

const BIDS = [
  { name: "Atlas", hue: 210, price: "3,480" },
  { name: "Borealis", hue: 150, price: "3,100", win: true },
  { name: "Cirrus", hue: 280, price: "3,905" },
];
// 0 empty · 1-3 bids arrive · 4 closing · 5 awarded · 6 rated
const FRAMES = [900, 900, 900, 1100, 1300, 1800, 2600];

export function LivePreview() {
  const [f, setF] = useState(6);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setF(0);
  }, []);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setTimeout(() => setF((x) => (x + 1) % FRAMES.length), FRAMES[f]);
    return () => clearTimeout(t);
  }, [f]);

  const status = f < 4 ? ["pending", "Accepting bids"] : f === 4 ? ["pending", "Opening sealed bids"] : ["pass", "Hired"];
  return (
    <div className="preview" aria-label="Animated example of a sealed-bid task">
      <div className="preview-bar">
        <span className="dots"><i /><i /><i /></span>
        <span className="preview-url">veil8004 · Hire</span>
        <span className="preview-live"><span className="live" /> live example</span>
      </div>
      <div className="preview-body">
        <div className="preview-head">
          <div>
            <strong>Sanctions screening</strong>
            <span className="sub">Task #14 · {Math.min(f, 3)} sealed bid{Math.min(f, 3) === 1 ? "" : "s"}</span>
          </div>
          <span className={`pill ${status[0]}`}>{f === 4 && <span className="spin" />} {status[1]}</span>
        </div>
        <ul className="preview-bids">
          {BIDS.map((b, i) => {
            const shown = f > i;
            const open = f >= 5 && b.win;
            const lost = f >= 5 && !b.win;
            return (
              <li key={b.name} className={`${shown ? "in" : ""} ${open ? "win" : ""} ${lost ? "lost" : ""}`}>
                <span className="avatar sm" style={{ background: `linear-gradient(135deg, hsl(${b.hue} 75% 60%), hsl(${b.hue + 50} 70% 45%))` }} />
                <span className="preview-name">{b.name}</span>
                {open ? (
                  <span className="preview-price reveal">{b.price}</span>
                ) : (
                  <span className="preview-sealed">
                    <LockIcon size={12} /> <span className="redact">•••••</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <div className={`preview-foot ${f >= 5 ? "in" : ""}`}>
          <CheckIcon size={14} /> Lowest bid wins. The other two prices are never published.
        </div>
      </div>
      <div className={`preview-float ${f >= 6 ? "in" : ""}`}>
        <StarIcon size={14} /> Rated 5/5 by <strong>one of 7 clients</strong>
      </div>
    </div>
  );
}
