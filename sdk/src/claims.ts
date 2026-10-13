// The claims table lives in one place, the README ("## Claims and limits"). The frontend's claims page and the
// demo script read it from there, so neither can claim more than the document does.

export type Claim = { property: string; claimed: string; notes: string };

/** Parses the first Markdown table under the "## Claims and limits" heading. Throws if it is missing or malformed. */
export function parseClaimsTable(markdown: string): Claim[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Claims and limits\s*$/.test(l));
  if (start < 0) throw new Error('no "## Claims and limits" section');
  const rows: string[][] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line)) break;
    if (!line.trim().startsWith("|")) {
      if (rows.length) break; // the table ended
      continue;
    }
    rows.push(line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
  }
  const [header, rule, ...body] = rows;
  if (!header || !rule || header.length !== 3 || !rule.every((c) => /^:?-+:?$/.test(c))) throw new Error("claims table is malformed");
  if (body.some((r) => r.length !== 3)) throw new Error("claims table row does not have three cells");
  return body.map(([property, claimed, notes]) => ({ property: property!, claimed: claimed!, notes: notes! }));
}

/** "Yes" → yes; "No" / "Not hidden" → no; anything conditional ("Only with…", "Partly", "Trusted to W3") → partial. */
export function claimKind(claimed: string): "yes" | "no" | "partial" {
  if (/^yes$/i.test(claimed) || /^disclosed$/i.test(claimed)) return "yes";
  if (/^(no|not hidden)$/i.test(claimed)) return "no";
  return "partial";
}
