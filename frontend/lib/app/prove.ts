"use client";
// Rating proofs, made in this browser. The Semaphore identity never leaves it: the circuit runs in a Web Worker
// (public/prove-worker.js, snarkjs's browser build), on artifacts checked against the repo's pinned SHA-256 hashes.
import { membershipCircuitInput, toSemaphoreProof, type Group, type Identity, type SemaphoreProof } from "@veil8004/sdk/semaphore-core";
import { artifactFileNames, PINNED_SHA256 } from "@veil8004/sdk/snark-pins";

const cache = new Map<string, ArrayBuffer>();

async function artifact(name: string): Promise<ArrayBuffer> {
  const hit = cache.get(name);
  if (hit) return hit;
  const res = await fetch(`/api/artifacts/${name}`);
  if (!res.ok) throw new Error(`proving artifact ${name}: ${res.status}`);
  const data = await res.arrayBuffer();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), (b) => b.toString(16).padStart(2, "0")).join("");
  if (digest !== PINNED_SHA256[name]) throw new Error(`${name} does not match its pinned SHA-256; refusing to prove with it`);
  cache.set(name, data);
  return data;
}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (v: { proof: never; publicSignals: string[] }) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker("/prove-worker.js");
  worker.onmessage = (e: MessageEvent<{ id: number; error?: string; proof?: never; publicSignals?: string[] }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.error) p.reject(new Error(e.data.error));
    else p.resolve({ proof: e.data.proof!, publicSignals: e.data.publicSignals! });
  };
  return worker;
}

export async function proveMembership(identity: Identity, group: Group, message: bigint, scope: bigint): Promise<SemaphoreProof> {
  const { depth, root, input } = membershipCircuitInput(identity, group, message, scope);
  const names = artifactFileNames(depth);
  const [wasm, zkey] = await Promise.all([artifact(names.wasm), artifact(names.zkey)]);
  const plain = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, Array.isArray(v) ? v.map(String) : String(v)]));
  const id = nextId++;
  const groth = await new Promise<{ proof: never; publicSignals: string[] }>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // Copies, so the cached artifacts stay usable for the next proof.
    getWorker().postMessage({ id, input: plain, wasm: wasm.slice(0), zkey: zkey.slice(0) });
  });
  return toSemaphoreProof({ depth, root, message, scope }, groth);
}
