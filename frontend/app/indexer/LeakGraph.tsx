import type { GraphEdge, GraphNode } from "@veil8004/sdk";

const COLUMN_X = { client: 130, agent: 450, validator: 770 } as const;
const ROW = 96;
const TOP = 56;
const BEND = { payment: -26, feedback: 26, validation: 0 } as const;
const EDGE_COLOR = { payment: "var(--client)", feedback: "var(--leak)", validation: "var(--validator)" } as const;

/** Client / agent / validator graph rebuilt from public data. Pure SVG, rendered on the server. */
export function LeakGraph({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const columns = { client: [] as GraphNode[], agent: [] as GraphNode[], validator: [] as GraphNode[] };
  for (const n of nodes) columns[n.kind].push(n);
  const pos = new Map<string, { x: number; y: number }>();
  for (const [kind, list] of Object.entries(columns) as [keyof typeof columns, GraphNode[]][])
    list.forEach((n, i) => pos.set(n.id, { x: COLUMN_X[kind], y: TOP + i * ROW }));
  const height = TOP + Math.max(1, ...Object.values(columns).map((c) => c.length)) * ROW - 20;

  return (
    <svg viewBox={`0 0 900 ${height}`} role="img" aria-label="Graph of clients, agents and validators">
      {(["client", "agent", "validator"] as const).map((kind) => (
        <text key={kind} x={COLUMN_X[kind]} y={20} textAnchor="middle" style={{ fill: "var(--muted)", fontSize: 13 }}>
          {kind === "client" ? "Clients" : kind === "agent" ? "Agents" : "Validators"}
        </text>
      ))}
      {edges.map((e, i) => {
        const a = pos.get(e.from)!;
        const b = pos.get(e.to)!;
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2 + BEND[e.kind];
        const lx = (a.x + 2 * cx + b.x) / 4;
        const ly = (a.y + 2 * cy + b.y) / 4;
        return (
          <g key={i}>
            <path
              d={`M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`}
              style={{ fill: "none", stroke: EDGE_COLOR[e.kind], strokeWidth: 2, opacity: 0.8 }}
            />
            <text x={lx} y={ly - 4} textAnchor="middle" style={{ fill: EDGE_COLOR[e.kind], fontSize: 12, fontWeight: 600 }}>
              {e.label}
            </text>
          </g>
        );
      })}
      {nodes.map((n) => {
        const p = pos.get(n.id)!;
        return (
          <g key={n.id}>
            <circle cx={p.x} cy={p.y} r={9} style={{ fill: `var(--${n.kind})` }} />
            <text x={p.x} y={p.y + 26} textAnchor="middle" style={{ fill: "var(--text)", fontSize: 12 }}>
              {n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
