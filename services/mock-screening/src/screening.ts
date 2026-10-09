// MOCK screening API. Fixed, fictional hit list; a real provider can replace it behind the same handler interface.
//   POST /screen   x-api-key: <key>   {"subject": string}  ->  {"hit": boolean}
// Subjects are never logged.

export const MOCK_HIT_LIST: readonly string[] = ["Kestrel Shipping Co", "Blackfin Holdings Ltd", "Orrin Maritime SA"];

const normalise = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const HITS = new Set(MOCK_HIT_LIST.map(normalise));

export function createScreeningApi(config: { apiKey: string }) {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") return json(200, { ok: true, mock: true });
    if (url.pathname !== "/screen") return json(404, { error: "not found" });
    if (req.method !== "POST") return json(405, { error: "method not allowed" });
    if (req.headers.get("x-api-key") !== config.apiKey) return json(401, { error: "bad api key" });
    let subject: unknown;
    try {
      subject = ((await req.json()) as { subject?: unknown }).subject;
    } catch {
      return json(400, { error: "body must be JSON" });
    }
    if (typeof subject !== "string" || subject.length === 0 || subject.length > 512)
      return json(400, { error: "subject must be a non-empty string" });
    return json(200, { hit: HITS.has(normalise(subject)) });
  }

  return { handle };
}
