import { describe, expect, test } from "bun:test";
import { createSealedStore, MAX_SEALED_BYTES } from "./store";

const W1 = "w1-token";
const W3 = "w3-token";
const REQ = `0x${"ab".repeat(32)}`;
const box = (n = 64) => btoa(String.fromCharCode(...new Uint8Array(n).fill(7)));

function setup() {
  const store = createSealedStore({ tokens: { validation: W1, bid: W3 } });
  const call = (method: string, key: string, init: { body?: string; token?: string } = {}) =>
    store.handle(
      new Request(`http://store/v1/payload/${encodeURIComponent(key)}`, {
        method,
        body: init.body,
        headers: init.token ? { authorization: `Bearer ${init.token}` } : {},
      }),
    );
  return { store, call };
}

describe("sealed-store", () => {
  test("PUT then GET with the workflow token", async () => {
    const { call } = setup();
    expect((await call("PUT", REQ, { body: box() })).status).toBe(201);
    const res = await call("GET", REQ, { token: W1 });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(box());
  });

  test("keys are write-once", async () => {
    const { call } = setup();
    await call("PUT", REQ, { body: box() });
    expect((await call("PUT", REQ, { body: box(80) })).status).toBe(409);
    expect(await (await call("GET", REQ, { token: W1 })).text()).toBe(box());
  });

  test("GET needs the right workflow's token", async () => {
    const { call } = setup();
    await call("PUT", REQ, { body: box() });
    await call("PUT", "3:1", { body: box() });
    expect((await call("GET", REQ)).status).toBe(401);
    expect((await call("GET", REQ, { token: "nope" })).status).toBe(403);
    expect((await call("GET", REQ, { token: W3 })).status).toBe(403); // W3 cannot read validations
    expect((await call("GET", "3:1", { token: W1 })).status).toBe(403); // W1 cannot read bids
    expect((await call("GET", "3:1", { token: W3 })).status).toBe(200);
  });

  test("missing payload is 404", async () => {
    const { call } = setup();
    expect((await call("GET", REQ, { token: W1 })).status).toBe(404);
  });

  test("rejects bad keys, non-base64, too-short and oversize bodies", async () => {
    const { call } = setup();
    expect((await call("PUT", "hello", { body: box() })).status).toBe(400);
    expect((await call("PUT", REQ, { body: "not base64!!" })).status).toBe(400);
    expect((await call("PUT", REQ, { body: box(10) })).status).toBe(400);
    expect((await call("PUT", REQ, { body: box(MAX_SEALED_BYTES + 1) })).status).toBe(413);
    expect((await call("PUT", REQ, { body: box(MAX_SEALED_BYTES) })).status).toBe(201);
  });

  test("key case is normalised", async () => {
    const { call } = setup();
    await call("PUT", REQ.toUpperCase().replace("0X", "0x"), { body: box() });
    expect((await call("GET", REQ, { token: W1 })).status).toBe(200);
  });
});
