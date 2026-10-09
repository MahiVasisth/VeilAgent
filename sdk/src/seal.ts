// Sealed boxes (anonymous public-key encryption), byte-compatible with libsodium's crypto_box_seal.
// Pure JavaScript (noble) on purpose: the CRE workflow runtime is QuickJS without WebAssembly, so libsodium's
// WASM build cannot load there (docs/phase0.md Q9). Interop with libsodium is checked in seal.test.ts.
//
//   seal(m, pk):  (epk, esk) = fresh X25519 key pair
//                 nonce      = blake2b(epk || pk, 24 bytes)
//                 k          = HSalsa20(X25519(esk, pk), 0^16)          (crypto_box_beforenm)
//                 output     = epk || XSalsa20-Poly1305(k, nonce, m)     (tag || ciphertext)
import { xsalsa20poly1305, hsalsa } from "@noble/ciphers/salsa";
import { x25519 } from "@noble/curves/ed25519";
import { blake2b } from "@noble/hashes/blake2.js";

const KEY_BYTES = 32;
const OVERHEAD = KEY_BYTES + 16; // ephemeral public key + Poly1305 tag

export type KeyPair = { publicKey: string; secretKey: string }; // base64

export function generateKeyPair(): KeyPair {
  const sk = x25519.utils.randomPrivateKey();
  return { publicKey: toBase64(x25519.getPublicKey(sk)), secretKey: toBase64(sk) };
}

/** Derives the base64 public key for a base64 X25519 secret key. */
export function publicKeyOf(secretKeyB64: string): string {
  return toBase64(x25519.getPublicKey(key32(secretKeyB64, "secret key")));
}

/** Seals `value` (serialised as JSON) to `publicKeyB64`. Returns the base64 sealed box. */
export function sealFor(publicKeyB64: string, value: unknown): string {
  return toBase64(sealBytes(key32(publicKeyB64, "public key"), new TextEncoder().encode(JSON.stringify(value))));
}

/** Opens a base64 sealed box with the recipient's base64 secret key and parses the JSON inside. Throws if the
 *  box was not sealed to this key or was modified. */
export function open<T = unknown>(secretKeyB64: string, ciphertextB64: string): T {
  const sk = key32(secretKeyB64, "secret key");
  return JSON.parse(new TextDecoder().decode(openBytes(sk, x25519.getPublicKey(sk), fromBase64(ciphertextB64)))) as T;
}

export function sealBytes(recipientPk: Uint8Array, message: Uint8Array): Uint8Array {
  const esk = x25519.utils.randomPrivateKey();
  const epk = x25519.getPublicKey(esk);
  const boxed = xsalsa20poly1305(beforenm(esk, recipientPk), sealNonce(epk, recipientPk)).encrypt(message);
  const out = new Uint8Array(KEY_BYTES + boxed.length);
  out.set(epk, 0);
  out.set(boxed, KEY_BYTES);
  return out;
}

export function openBytes(recipientSk: Uint8Array, recipientPk: Uint8Array, sealed: Uint8Array): Uint8Array {
  if (sealed.length < OVERHEAD) throw new Error("sealed box too short");
  const epk = sealed.subarray(0, KEY_BYTES);
  return xsalsa20poly1305(beforenm(recipientSk, epk), sealNonce(epk, recipientPk)).decrypt(sealed.subarray(KEY_BYTES));
}

function sealNonce(epk: Uint8Array, recipientPk: Uint8Array): Uint8Array {
  const input = new Uint8Array(2 * KEY_BYTES);
  input.set(epk, 0);
  input.set(recipientPk, KEY_BYTES);
  return blake2b(input, { dkLen: 24 });
}

/** crypto_box_beforenm: HSalsa20 over the X25519 shared secret with a zero nonce. */
function beforenm(sk: Uint8Array, pk: Uint8Array): Uint8Array {
  const shared = x25519.getSharedSecret(sk, pk);
  const sigma = words(new TextEncoder().encode("expand 32-byte k"));
  const out = new Uint32Array(8);
  hsalsa(sigma, words(shared), new Uint32Array(4), out);
  const k = new Uint8Array(32);
  const view = new DataView(k.buffer);
  out.forEach((w, i) => view.setUint32(4 * i, w, true));
  return k;
}

/** Little-endian 32-bit words, independent of platform endianness and buffer alignment. */
function words(bytes: Uint8Array): Uint32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Uint32Array.from({ length: bytes.length / 4 }, (_, i) => view.getUint32(4 * i, true));
}

function key32(b64: string, what: string): Uint8Array {
  const k = fromBase64(b64);
  if (k.length !== KEY_BYTES) throw new Error(`${what} must be ${KEY_BYTES} bytes, got ${k.length}`);
  return k;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
