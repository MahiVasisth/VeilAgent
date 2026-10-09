import { beforeAll, describe, expect, test } from "bun:test";
import sodium from "libsodium-wrappers";
import { fromBase64, generateKeyPair, open, openBytes, publicKeyOf, sealBytes, sealFor, toBase64 } from "./seal";

describe("seal (noble, crypto_box_seal compatible)", () => {
  beforeAll(async () => {
    await sodium.ready;
  });

  test("round trip", () => {
    const kp = generateKeyPair();
    const payload = { input: "Northwind Trading LLC", salt: `0x${"11".repeat(32)}` };
    expect(open<typeof payload>(kp.secretKey, sealFor(kp.publicKey, payload))).toEqual(payload);
    expect(publicKeyOf(kp.secretKey)).toBe(kp.publicKey);
  });

  test("libsodium opens what noble seals", () => {
    const kp = sodium.crypto_box_keypair();
    const msg = new TextEncoder().encode("hello from noble");
    const sealed = sealBytes(kp.publicKey, msg);
    expect(sealed.length).toBe(msg.length + sodium.crypto_box_SEALBYTES);
    expect(sodium.crypto_box_seal_open(sealed, kp.publicKey, kp.privateKey)).toEqual(msg);
  });

  test("noble opens what libsodium seals", () => {
    const kp = generateKeyPair();
    const sealed = sodium.crypto_box_seal(JSON.stringify({ price: "100", salt: "0x01" }), fromBase64(kp.publicKey));
    expect(open<Record<string, string>>(kp.secretKey, toBase64(sealed))).toEqual({ price: "100", salt: "0x01" });
  });

  test("wrong key or tampered box fails", () => {
    const kp = generateKeyPair();
    const other = generateKeyPair();
    const box = sealFor(kp.publicKey, { a: 1 });
    expect(() => open(other.secretKey, box)).toThrow();
    const bytes = fromBase64(box);
    bytes[bytes.length - 1]! ^= 1;
    expect(() => open(kp.secretKey, toBase64(bytes))).toThrow();
    expect(() => openBytes(fromBase64(kp.secretKey), fromBase64(kp.publicKey), new Uint8Array(10))).toThrow(/too short/);
  });

  test("each seal is fresh (ephemeral key)", () => {
    const kp = generateKeyPair();
    expect(sealFor(kp.publicKey, { a: 1 })).not.toBe(sealFor(kp.publicKey, { a: 1 }));
  });
});
