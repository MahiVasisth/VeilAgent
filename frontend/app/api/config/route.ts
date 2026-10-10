import { appConfig } from "../../../lib/server";

export const dynamic = "force-dynamic";

/** Public settings for the browser app: addresses, chain, the workflows' public keys. */
export function GET() {
  try {
    return Response.json(appConfig());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message.split("\n")[0] : String(e) }, { status: 503 });
  }
}
