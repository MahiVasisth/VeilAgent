import { describe, expect, test } from "bun:test";
import { createScreeningApi } from "./screening";

const api = createScreeningApi({ apiKey: "k" });
const screen = (body: unknown, key = "k") =>
  api.handle(
    new Request("http://mock/screen", {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("mock-screening", () => {
  test("hit and miss", async () => {
    expect(await (await screen({ subject: "Kestrel Shipping Co" })).json()).toEqual({ hit: true });
    expect(await (await screen({ subject: "  kestrel   shipping co " })).json()).toEqual({ hit: true });
    expect(await (await screen({ subject: "Northwind Trading LLC" })).json()).toEqual({ hit: false });
  });

  test("requires the API key", async () => {
    expect((await screen({ subject: "x" }, "wrong")).status).toBe(401);
  });

  test("validates the body", async () => {
    expect((await screen("nope")).status).toBe(400);
    expect((await screen({ subject: "" })).status).toBe(400);
    expect((await screen({ subject: 5 })).status).toBe(400);
  });

  test("POST /screen only", async () => {
    expect((await api.handle(new Request("http://mock/screen"))).status).toBe(405);
    expect((await api.handle(new Request("http://mock/other", { method: "POST" }))).status).toBe(404);
  });

  test("qualify (Phase 3): listed credential, unlisted credential, validation, API key", async () => {
    const qualify = (body: unknown, key = "k") =>
      api.handle(new Request("http://mock/qualify", { method: "POST", headers: { "x-api-key": key }, body: JSON.stringify(body) }));
    expect(await (await qualify({ credential: "QS-2026-0417" })).json()).toEqual({ qualified: true });
    expect(await (await qualify({ credential: " qs-2026-0417 " })).json()).toEqual({ qualified: true });
    expect(await (await qualify({ credential: "QS-2025-0099" })).json()).toEqual({ qualified: false });
    expect((await qualify({ subject: "QS-2026-0417" })).status).toBe(400);
    expect((await qualify({ credential: "QS-2026-0417" }, "wrong")).status).toBe(401);
    expect((await api.handle(new Request("http://mock/qualify"))).status).toBe(405);
  });
});
