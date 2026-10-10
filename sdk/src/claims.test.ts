import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claimKind, parseClaimsTable } from "./claims";

const DOCS = join(import.meta.dir, "../../docs");

describe("parseClaimsTable", () => {
  test("reads the table in docs/threat-model.md", () => {
    const claims = parseClaimsTable(readFileSync(join(DOCS, "threat-model.md"), "utf8"));
    expect(claims.length).toBeGreaterThanOrEqual(22);
    expect(claims[0]).toEqual({ property: "Validation input hidden from chain observers", claimed: "Yes", notes: "Salted commitment only" });
    expect(claims.find((c) => c.property === "Simulated clients")?.claimed).toBe("Disclosed");
  });

  test("the README carries the same table as the threat model", () => {
    const readme = parseClaimsTable(readFileSync(join(DOCS, "../README.md"), "utf8"));
    expect(readme).toEqual(parseClaimsTable(readFileSync(join(DOCS, "threat-model.md"), "utf8")));
  });

  test("the threat model makes no claim the spec does not", () => {
    const spec = parseClaimsTable(readFileSync(join(DOCS, "SPEC.md"), "utf8"));
    const model = parseClaimsTable(readFileSync(join(DOCS, "threat-model.md"), "utf8"));
    for (const c of model) {
      const s = spec.find((x) => x.property === c.property);
      expect(s, c.property).toBeDefined();
      expect(c.claimed, c.property).toBe(s!.claimed);
    }
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
