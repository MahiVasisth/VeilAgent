// Semaphore proving artifacts: names and pinned SHA-256 hashes. No Node imports, so the browser app can check the
// artifacts it downloads against the same pins (snarkArtifacts.ts is the Node side: cache paths and file checks).

/** The artifact version @semaphore-protocol/proof@4.14.3 asks for, and the base URL it downloads from. */
export const SEMAPHORE_ARTIFACT_VERSION = "4.13.0";
export const SEMAPHORE_ARTIFACT_URL = `https://snark-artifacts.pse.dev/semaphore/${SEMAPHORE_ARTIFACT_VERSION}`;

/** Depths fetched by default: groups of up to 2^4 = 16 members. */
export const DEFAULT_DEPTHS = [1, 2, 3, 4] as const;

export const artifactFileNames = (depth: number) => ({ wasm: `semaphore-${depth}.wasm`, zkey: `semaphore-${depth}.zkey` });

/**
 * SHA-256 of each artifact, pinned on first download from SEMAPHORE_ARTIFACT_URL (2026-10-09). Every pinned zkey is
 * also checked against SemaphoreVerifier: contracts/test/Semaphore.t.sol verifies one proof per depth, made with it.
 */
export const PINNED_SHA256: Record<string, string> = {
  "semaphore-1.wasm": "70289ef3bdfa86e97debdb227e76721b392f45b5e73d5e7136d93a04dce0dff9",
  "semaphore-1.zkey": "471a978875f91411b21ba5a2fbea41df30ec45eb23e3ac045edf7f30a2846a08",
  "semaphore-2.wasm": "877a989a8881ff6651866cfa32088f60e4abcb02a26f2e995868dfabd7f9385b",
  "semaphore-2.zkey": "110e2d9de78730aa4f5c78c75017cfe4d769b4b7ce60f58484fb14733d7b0f35",
  "semaphore-3.wasm": "48e15502f710be0a623d573d472edeeaf918fd5eee0b2ca9b407c4e4f20d12f2",
  "semaphore-3.zkey": "c36653c42784df35a01f3d93415af9ad8292a540f8deb134a6a34a01752a89d3",
  "semaphore-4.wasm": "ec0ed0ae7eb0264070b36a247cf4aad8157c5550f0731d3462019526e5e9ae4f",
  "semaphore-4.zkey": "90c94bad7ad97eeb9314750e443d84da783e38a21f55538d72b10d258064f6e6",
};
