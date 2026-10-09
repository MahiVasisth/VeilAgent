// `data:` URIs, used by ERC-8004 for fully on-chain registration, request and feedback files.

const JSON_B64_PREFIX = "data:application/json;base64,";

function toBase64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(b64: string): string {
  const binary = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** Serialises `value` as JSON and wraps it in a base64 `data:` URI. `payload` is the exact JSON text. */
export function jsonDataUri(value: unknown): { uri: string; payload: string } {
  const payload = JSON.stringify(value);
  return { uri: JSON_B64_PREFIX + toBase64(payload), payload };
}

/** Returns the body of a `data:` URI as text, or null if `uri` is not a well-formed `data:` URI. */
export function decodeDataUri(uri: string): string | null {
  const match = /^data:([^,]*),(.*)$/s.exec(uri);
  if (!match) return null;
  const [, meta = "", body = ""] = match;
  try {
    return meta.split(";").includes("base64") ? fromBase64(body) : decodeURIComponent(body);
  } catch {
    return null;
  }
}

/** Parses a JSON `data:` URI. Returns null for other URI schemes or invalid JSON. */
export function parseJsonDataUri(uri: string): unknown {
  const text = decodeDataUri(uri);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
