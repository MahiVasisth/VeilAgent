// Veil8004 prover worker. Runs snarkjs's browser build off the main thread. It receives the circuit input and the
// artifacts (already checked against their SHA-256 pins by the page) and returns the Groth16 proof. Nothing leaves the
// browser from here.
/* global snarkjs */
importScripts("/api/vendor/snarkjs");

self.onmessage = async (e) => {
  const { id, input, wasm, zkey } = e.data;
  try {
    const parsed = Object.fromEntries(
      Object.entries(input).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => BigInt(x)) : BigInt(v)]),
    );
    const out = await snarkjs.groth16.fullProve(parsed, { type: "mem", data: new Uint8Array(wasm) }, { type: "mem", data: new Uint8Array(zkey) }, undefined, undefined, { singleThread: true });
    self.postMessage({ id, proof: out.proof, publicSignals: out.publicSignals });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
