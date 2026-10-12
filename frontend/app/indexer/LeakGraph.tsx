import type { GraphEdge, GraphNode } from "@veil8004/sdk";

const COLUMN_X = { client: 170, agent: 450, validator: 730 } as const;
const ROW = 92;
const TOP = 64;
const BEND = { payment: -24, feedback: 24, validation: 0 } as const;
const EDGE_COLOR = { payment: "var(--client)", feedback: "var(--leak)", validation: "var(--validator)" } as const;

/** Plain-language edge text; the indexer's own label stays as the hover title (and in the page for the checks). */
function friendly(e: GraphEdge): string {
  if (e.kind === "feedback") return e.label.replace(/^score /, "rated ");
  if (e.kind === "validation") return `screened · ${e.label.split(": ").pop()}`;
  return e.label;
}

/** Client / agent / validator graph rebuilt from public data. Pure SVG, rendered on the server. Only nodes that take
 *  part in an interaction are drawn; idle agents are listed underneath. */
export function LeakGraph({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const active = nodes.filter((n) => linked.has(n.id));
  const idle = nodes.filter((n) => !linked.has(n.id));
  const columns = { client: [] as GraphNode[], agent: [] as GraphNode[], validator: [] as GraphNode[] };
  for (const n of active) columns[n.kind].push(n);
  const rows = Math.max(1, ...Object.values(columns).map((c) => c.length));
  const pos = new Map<string, { x: number; y: number }>();
  for (const [kind, list] of Object.entries(columns) as [keyof typeof columns, GraphNode[]][]) {
    const offset = ((rows - list.length) * ROW) / 2; // centre short columns
    list.forEach((n, i) => pos.set(n.id, { x: COLUMN_X[kind], y: TOP + offset + i * ROW }));
  }
  const height = TOP + rows * ROW - 30;

  return (
    <>
      <svg viewBox={`0 0 900 ${height}`} role="img" aria-label="Graph of clients, agents and validators">
        {(["client", "agent", "validator"] as const).map((kind) => (
          <text key={kind} x={COLUMN_X[kind]} y={22} textAnchor="middle" style={{ fill: "var(--faint)", fontSize: 12, letterSpacing: "0.08em" }}>
            {kind === "client" ? "CLIENTS" : kind === "agent" ? "AGENTS" : "VALIDATORS"}
          </text>
        ))}
        {edges.map((e, i) => {
          const a = pos.get(e.from)!;
          const b = pos.get(e.to)!;
          const cx = (a.x + b.x) / 2;
          const cy = (a.y + b.y) / 2 + BEND[e.kind];
          const lx = (a.x + 2 * cx + b.x) / 4;
          const ly = (a.y + 2 * cy + b.y) / 4 + (e.kind === "feedback" ? 14 : -6);
          return (
            <g key={i}>
              <title>{e.label}</title>
              <path d={`M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`} style={{ fill: "none", stroke: EDGE_COLOR[e.kind], strokeWidth: 2, opacity: 0.75 }} />
              <text x={lx} y={ly} textAnchor="middle" style={{ fill: EDGE_COLOR[e.kind], fontSize: 12, fontWeight: 600, paintOrder: "stroke", stroke: "var(--surface-solid)", strokeWidth: 4 }}>
                {friendly(e)}
              </text>
            </g>
          );
        })}
        {active.map((n) => {
          const p = pos.get(n.id)!;
          // Clients label to the left, validators to the right, agents underneath: no label crosses an edge.
          const side = n.kind === "client" ? { x: p.x - 16, y: p.y + 4, a: "end" } : n.kind === "validator" ? { x: p.x + 16, y: p.y + 4, a: "start" } : { x: p.x, y: p.y + 28, a: "middle" };
          return (
            <g key={n.id}>
              <circle cx={p.x} cy={p.y} r={9} style={{ fill: `var(--${n.kind})`, stroke: "var(--surface-solid)", strokeWidth: 3 }} />
              <text x={side.x} y={side.y} textAnchor={side.a as "end" | "start" | "middle"} style={{ fill: "var(--text)", fontSize: 12.5, fontWeight: 560 }}>
                {n.label}
              </text>
            </g>
          );
        })}
      </svg>
      {idle.length > 0 && <p className="sub graph-idle">No public activity yet: {idle.map((n) => n.label).join(", ")}</p>}
    </>
  );
}
