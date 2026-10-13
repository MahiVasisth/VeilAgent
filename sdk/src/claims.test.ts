import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claimKind, parseClaimsTable } from "./claims";

const README = join(import.meta.dir, "../../README.md");

describe("parseClaimsTable", () => {
  test("reads the table in the README", () => {
    const claims = parseClaimsTable(readFileSync(README, "utf8"));
    expect(claims.length).toBeGreaterThanOrEqual(22);
    expect(claims[0]).toEqual({ property: "Validation input hidden from chain observers", claimed: "Yes", notes: "Salted commitment only" });
    expect(claims.find((c) => c.property === "Simulated clients")?.claimed).toBe("Disclosed");
  });

  test("stops at the end of the table and rejects malformed tables", () => {
    const md = "## Claims and limits\n\n| A | B | C |\n|---|---|---|\n| x | Yes | n |\n\nafter\n| not | part | of it |\n";
    expect(parseClaimsTable(md)).toEqual([{ property: "x", claimed: "Yes", notes: "n" }]);
    expect(() => parseClaimsTable("# nothing")).toThrow();
    expect(() => parseClaimsTable("## Claims and limits\n| A | B |\n|---|---|\n")).toThrow();
  });

  test("claimKind", () => {
    expect(["Yes", "No", "Not hidden", "Partly", "Only with a Confidential Workflow", "Trusted to W3", "Disclosed"].map(claimKind)).toEqual([
      "yes", "no", "no", "partial", "partial", "partial", "yes",
    ]);
  });
});
