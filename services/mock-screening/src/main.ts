// Run: bun services/mock-screening/src/main.ts  (port from MOCK_SCREENING_URL, key from SCREENING_API_KEY)
import { createScreeningApi } from "./screening";

const url = new URL(process.env.MOCK_SCREENING_URL ?? "http://127.0.0.1:8788");
const apiKey = process.env.SCREENING_API_KEY;
if (!apiKey) throw new Error("SCREENING_API_KEY is required");

const server = Bun.serve({ hostname: url.hostname, port: Number(url.port), fetch: createScreeningApi({ apiKey }).handle });
console.log(`mock-screening (MOCK, fixed fictional list) listening on ${server.url}`);
