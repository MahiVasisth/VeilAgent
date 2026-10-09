import { describe, expect, test } from "bun:test";
import { decodeDataUri, jsonDataUri, parseJsonDataUri } from "./dataUri";

describe("dataUri", () => {
  test("round-trips JSON, including non-ASCII text", () => {
    const value = { name: "Ångström Ltd", n: 1 };
    const { uri, payload } = jsonDataUri(value);
    expect(uri.startsWith("data:application/json;base64,")).toBe(true);
    expect(payload).toBe(JSON.stringify(value));
    expect(parseJsonDataUri(uri)).toEqual(value);
  });

  test("decodes the percent-encoded form", () => {
    expect(decodeDataUri("data:application/json,%7B%22a%22%3A1%7D")).toBe('{"a":1}');
    expect(parseJsonDataUri('data:application/json,{"a":1}')).toEqual({ a: 1 });
  });

  test("decodes padded standard base64 (the form OZ Base64 emits in RegisterAgents.s.sol)", () => {
    expect(parseJsonDataUri("data:application/json;base64,eyJuYW1lIjoiQXRsYXMifQ==")).toEqual({ name: "Atlas" });
  });

  test("returns null for non-data URIs and bad JSON", () => {
    expect(decodeDataUri("ipfs://cid")).toBeNull();
    expect(parseJsonDataUri("https://example.com/a.json")).toBeNull();
    expect(parseJsonDataUri("data:application/json,{not json")).toBeNull();
  });
});
