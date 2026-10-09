// MOCK screening API. Fixed, fictional hit list; a real provider can replace it behind the same handler interface.
//   POST /screen    x-api-key: <key>   {"subject": string}     ->  {"hit": boolean}
//   POST /qualify   x-api-key: <key>   {"credential": string}  ->  {"qualified": boolean}   (Phase 3, QUALIFIED_SCREENER_V1)
// Subjects and credentials are never logged.

export const MOCK_HIT_LIST: readonly string[] = ["Kestrel Shipping Co", "Blackfin Holdings Ltd", "Orrin Maritime SA"];

/** Fictional screener credentials the mock provider lists as qualified (QUALIFIED_SCREENER_V1). */
export const MOCK_QUALIFIED_CREDENTIALS: readonly string[] = ["QS-2026-0417", "QS-2026-0582", "QS-2026-0733", "QS-2026-0901"];

const normalise = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const HITS = new Set(MOCK_HIT_LIST.map(normalise));
const QUALIFIED = new Set(MOCK_QUALIFIED_CREDENTIALS.map(normalise));
const ROUTES = {
  "/screen": { field: "subject", answer: (v: string) => ({ hit: HITS.has(normalise(v)) }) },
  "/qualify": { field: "credential", answer: (v: string) => ({ qualified: QUALIFIED.has(normalise(v)) }) },
} as const;

export function createScreeningApi(config: { apiKey: string }) {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") return json(200, { ok: true, mock: true });
    const route = ROUTES[url.pathname as keyof typeof ROUTES];
    if (!route) return json(404, { error: "not found" });
    if (req.method !== "POST") return json(405, { error: "method not allowed" });
    if (req.headers.get("x-api-key") !== config.apiKey) return json(401, { error: "bad api key" });
    let value: unknown;
    try {
      value = ((await req.json()) as Record<string, unknown>)[route.field];
    } catch {
      return json(400, { error: "body must be JSON" });
    }
    if (typeof value !== "string" || value.length === 0 || value.length > 512)
      return json(400, { error: `${route.field} must be a non-empty string` });
    return json(200, route.answer(value));
  }

  return { handle };
}
