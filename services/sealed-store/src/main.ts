// Run: bun services/sealed-store/src/main.ts  (port from SEALED_STORE_URL, tokens from SEALED_STORE_W1_TOKEN / _W3_TOKEN)
import { createSealedStore } from "./store";

const url = new URL(process.env.SEALED_STORE_URL ?? "http://127.0.0.1:8787");
const w1 = process.env.SEALED_STORE_W1_TOKEN;
if (!w1) throw new Error("SEALED_STORE_W1_TOKEN is required");
const store = createSealedStore({ tokens: { validation: w1, bid: process.env.SEALED_STORE_W3_TOKEN || undefined } });

const server = Bun.serve({ hostname: url.hostname, port: Number(url.port), fetch: store.handle });
console.log(`sealed-store listening on ${server.url} (ciphertext only, in memory)`);
