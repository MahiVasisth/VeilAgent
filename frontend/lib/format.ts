// Display helpers shared by server pages and the client app.

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** "Oct 12, 2026, 14:05 UTC". Fixed locale and zone, so server and browser render the same text. */
export function formatDate(t: bigint): string {
  const d = new Date(Number(t) * 1000);
  return `${d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC", hour12: false })} UTC`;
}

/** Human names for on-chain identifiers; the identifier stays visible where it matters (tables, tooltips). */
const LABELS: Record<string, string> = {
  "sanctions-screening": "Sanctions screening",
  "compliance-screening": "Compliance screening",
  SANCTIONS_SCREEN_V1: "Sanctions check",
  QUALIFIED_SCREENER_V1: "Screener qualification",
};
export const label = (id: string) => LABELS[id] ?? id;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "in 9 min" / "3 h ago", measured against the chain's clock (Anvil time can be skipped ahead). */
export function relative(t: bigint, now: bigint): string {
  const s = Number(t - now);
  const a = Math.abs(s);
  const v = a < 60 ? `${a}s` : a < 3600 ? `${Math.round(a / 60)} min` : a < 172800 ? `${Math.round(a / 3600)} h` : `${Math.round(a / 86400)} d`;
  return s >= 0 ? `in ${v}` : `${v} ago`;
}
/** A deterministic two-colour gradient per address, so accounts are recognisable at a glance. */
export function avatarStyle(address: string): { background: string } {
  const h1 = parseInt(address.slice(2, 6), 16) % 360;
  const h2 = (h1 + 60 + (parseInt(address.slice(6, 8), 16) % 120)) % 360;
  return { background: `linear-gradient(135deg, hsl(${h1} 80% 62%), hsl(${h2} 75% 48%))` };
}

