# Phase 0: Verify the unknowns

Written 2026-10-08 against the installed packages listed under [Pinned versions](#pinned-versions).
Every answer below says how it was checked: **source** (read in the installed package or repo),
**chain** (read-only `cast` call to Monad testnet, chain 10143), or **OPEN** (needs your CRE
account or a human decision; the exact action is given).

The exit criterion for Phase 0 is a written answer per item and a fallback for each "no".
Items marked OPEN must be closed before the phase that depends on them, not before Phase 1.

## Summary

| # | Question | Answer | Status |
|---|---|---|---|
| Q1 | Can CRE write to Monad testnet? | Yes: SDK, account (2026-10-09) and forwarder confirmed | Confirmed (CLI + chain) |
| Q2 | Can a workflow trigger at a deadline? | Yes, through the EVM Log trigger on `BiddingClosed` | Confirmed (source) |
| Q3 | What does Confidential HTTP hide? | Secrets and, optionally, the response. Not the workflow inputs | Confirmed (source) |
| Q4 | Confidential Workflows access | Unknown | **OPEN** (request) |
| Q5 | ERC-8004 registries on Monad testnet | Identity and Reputation confirmed. A canonical Validation Registry **also exists** | Confirmed (chain); **OPEN** (decision) |
| Q6 | ERC-8004 call rules | Confirmed, with three nuances | Confirmed (source) |
| Q7 | Semaphore on Monad | No deployment; deploy our own. Done (Phase 5): canonical PoseidonT3 via CREATE2 + our Semaphore | Confirmed (source + chain); deployed on Anvil |
| Q8 | Monad testnet settings | Chain ID 10143, RPC `https://testnet-rpc.monad.xyz` | Confirmed (chain) |
| H1–H5 | Hand checklist | — | **OPEN** |
| Q9 | Does sealed-box decryption run inside a workflow? (from H2) | libsodium: probably not. Adopted pure-JS noble sealed boxes (Phase 2); W1 compiles to WASM | **OPEN** (simulate) |

---

## Q1. Can CRE write to Monad testnet?

**Confirmed from source (SDK side).** `@chainlink/cre-sdk@1.23.0` (spec minimum: 1.19.0) ships
`dist/generated/chain-selectors/testnet/evm/monad-testnet.js`:

- chain-name `monad-testnet`, chainId `10143`, selector `2183018362218727504`
- `monad-testnet` is in `EVMClient.SUPPORTED_CHAIN_SELECTORS` (capability `evm@1.0.0`), so
  `logTrigger`, `callContract`, `filterLogs` and `writeReport` all accept it.

**Confirmed for the account (2026-10-09), with CRE CLI v1.37.0 after `cre login`.** `cre workflow supported-chains`
lists `monad-testnet` for our tenant:

| Chain | Selector | Forwarder | Mock forwarder (used by `cre workflow simulate`) |
|---|---|---|---|
| `monad-testnet` | `2183018362218727504` (matches the SDK) | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` | `0xB9F79d863261869B234c481D1f9A7af84AeAd192` |

Both addresses have code on Monad testnet (`cast code`: 8,591 and 4,579 bytes). The forwarder is in `.env.example` as
`CRE_FORWARDER_ADDRESS`. CLI v1.38.0 has since been released; we stay on v1.37.0 until the simulations pass.

The steps used to confirm it (kept for reproducibility):

1. Install the CRE CLI (not installed on this machine). The latest release is v1.37.0
   (2026-10-05); the spec needs v1.30.0 or later. Follow
   <https://docs.chain.link/cre/getting-started/cli-installation>, or download
   `cre_darwin_arm64.zip` from <https://github.com/smartcontractkit/cre-cli/releases/tag/v1.37.0>.
2. `cre version` → confirm ≥ 1.30.0.
3. `cre login`
4. `cre workflow supported-chains` (the command the spec names). If this CLI version has no such
   subcommand, run `cre workflow --help` and record the equivalent here.
5. Open the CRE **Forwarder Directory** docs page, copy the `monad-testnet` forwarder
   address into `.env` as `CRE_FORWARDER_ADDRESS`, and record it here.

**Fallback if no:** run `cre workflow simulate` plus the local runner (Anvil + MockForwarder)
for the demo, and ask the Chainlink mentor to enable Monad testnet.

## Q2. Can a workflow trigger at a deadline?

**Confirmed from source.** SDK 1.23.0 exposes these trigger capabilities: `cron-trigger@1.0.0`,
`http-trigger@1.0.0-alpha`, and the EVM log trigger (`EVMClient.logTrigger`, in `evm@1.0.0`).
There is no "at timestamp T" trigger, so the spec's design stands: anyone calls `closeBidding`
after the deadline, which emits `BiddingClosed`, and W3 triggers on that log.

To simulate a log trigger you need a real transaction hash. The pattern from Chainlink's
`event-reactor` template:

```bash
cre workflow simulate <workflow-dir> --target staging-settings --non-interactive \
  --trigger-index 0 --evm-tx-hash <tx that emitted the event> --evm-event-index 0
```

## Q3. What does Confidential HTTP hide?

**Confirmed from source.** The capability is `confidential-http@1.0.0-alpha` (alpha). Its request type
(`ConfidentialHTTPRequestJson`) has:

- `vaultDonSecrets: [{ key, namespace, owner }]`: secrets injected inside the enclave
- `request: { url, method, bodyString | bodyBytes, multiHeaders, templatePublicValues, timeout, customRootCaCertPem, encryptOutput }`
- `encryptOutput: true` AES-GCM-encrypts the response with the vault secret named
  `san_marino_aes_gcm_encryption_key`

`templatePublicValues` and the request fields are supplied by the workflow, so the nodes see
them. **Claim credential hiding only**, as the spec says. No change to the claims table.

## Q4. Confidential Workflows access

**OPEN.** This can't be checked from packages. `cre-templates` has a
`starter-templates/confidential-workflows/` folder (at commit `d0223f3`), so the feature exists, but access is per account.

- Action: ask the Chainlink mentor for Confidential Workflows access on your account and record the answer here.
- Build without it: W1 reports `Tier.Don`, and the README marks input hiding from node operators as *designed, not demoed*.

## Q5. ERC-8004 registries on Monad testnet

**Confirmed on-chain** (read-only `cast` calls on 2026-10-08):

| Contract | Address | Code | `getVersion()` | Notes |
|---|---|---|---|---|
| IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | proxy | `2.0.0` | impl `0x7274e874ca62410a93bd8bf61c69d8045e399c02`; agent 0 exists |
| ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | proxy | `2.0.0` | `getIdentityRegistry()` = Identity above |
| ValidationRegistry | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` | proxy | `2.0.0` | `getIdentityRegistry()` = Identity above |

**Difference from the spec:** the spec says no Validation Registry is listed. The erc-8004-contracts README
does not list one, but `scripts/addresses.ts` (`TESTNET_ADDRESSES.validationRegistry`) does,
and it is live on Monad testnet. The README warning that the Validation Registry part of the spec "is still under active
update" still applies.

**OPEN: decision.** Pick one:

- **(a) Recommended, and as the spec says:** deploy our own `ValidationRegistryUpgradeable` (same
  source, v2.0.0) on testnet behind the adapter. The canonical one can be upgraded under us, and the README doesn't list it.
- (b) Point the adapter at `0x8004Cb1B…4272`. The mirror then lands in the registry other ERC-8004 indexers
  read, which helps the "interop" story. Only the adapter address changes.

Both run through the same adapter, so this can be decided as late as Phase 2.

## Q6. ERC-8004 call rules

**Confirmed from source** (`lib/erc-8004-contracts/contracts/*.sol` at `b9e466c`, matching
`ERC8004SPEC.md` at the same commit):

| Rule in spec | Source | Match |
|---|---|---|
| `validationRequest` only by the agent's owner or operator | `ValidationRegistryUpgradeable.validationRequest`: `msg.sender == ownerOf` or `isApprovedForAll(owner, sender)` or `getApproved(agentId) == sender` | ✔ |
| `validationResponse` only by the named validator | `require(msg.sender == s.validatorAddress, "not validator")` | ✔ |
| `giveFeedback` rejects the agent's owner and operators | `require(!identity.isAuthorizedOrOwner(msg.sender, agentId))` | ✔ |
| `getSummary` needs non-empty client list | Reputation: `revert("clientAddresses required")` | ✔ (Reputation only; see I-6) |

Nuances that affect our contracts are listed as I-1 to I-7 below.

## Q7. Semaphore on Monad

**Confirmed (source + chain).** `@semaphore-protocol/utils@4.14.3` lists no Monad network. The three V4
canonical addresses it ships (`0x8A1fd199…693D`, `0x4DeC9E37…31f8`, `0xB43122Ec…599a`) have no
code on Monad testnet. Plan as in the spec: deploy `SemaphoreVerifier`, `PoseidonT3` (an external
library, so it must be linked) and `Semaphore` from `@semaphore-protocol/contracts@4.14.3`. All three
compile under solc 0.8.26 with the remappings in `contracts/foundry.toml`.

**Phase 5 (2026-10-09): deployed and checked on Anvil.** PoseidonT3 is not our own build but poseidon-solidity's
published one, at its canonical address `0x3333333C…3B93` through the CREATE2 proxy `0x4e59…956C` (S-8). The proxy also
exists on Monad testnet, but PoseidonT3 is not there yet, so the testnet deploy creates it at the same address.
`scripts/src/semaphore-check.ts` checks a live deployment.

**Fallback if deployment fails:** a minimal membership-proof contract, or an allowlist with nullifiers, labeled as a stand-in.

## Q8. Monad testnet settings

**Confirmed on-chain.** `cast chain-id --rpc-url https://testnet-rpc.monad.xyz` returns `10143`. Both are
in `.env.example`.

## Q9. Does sealed-box decryption run inside a workflow? (hand item H2)

**OPEN, and probably no with libsodium.** Evidence from source:

- `@chainlink/cre-sdk` README, *Runtime Compatibility Constraints*: workflows are compiled to WASM and run
  under **Javy (QuickJS)**. Node built-ins (`node:crypto`, …) and browser globals (`fetch`,
  `setTimeout`, …) are not available.
- `libsodium@0.8.4` (under `libsodium-wrappers@0.8.4`) loads by calling
  `WebAssembly.instantiate`. `dist/modules/` holds only that one file, with no `use asm` build. QuickJS has
  no `WebAssembly` global.

**Action:** once the CLI is installed, compile and simulate a probe workflow that imports `libsodium-wrappers`
and calls `crypto_box_seal_open`. Record the result here.

**Fallback, adopted in Phase 2 (decided 2026-10-09):** pure-JS sealed boxes in `sdk/src/seal.ts`.
X25519 from `@noble/curves@1.9.1`, XSalsa20-Poly1305 and HSalsa20 from `@noble/ciphers@1.3.0`, and the nonce
`blake2b(epk ‖ recipientPk, 24)` from `@noble/hashes@2.2.0`, all pinned as direct `sdk` dependencies. `seal.test.ts`
checks that libsodium opens what noble seals and the other way round, so clients can keep libsodium. `libsodium-wrappers`
moved to `devDependencies` (interop test only).

**Progress:** `bunx cre-compile cre/workflows/w1-validator/main.ts` bundles the handler, including the noble code, and
compiles it to WASM (2.7 MB) with Javy 8.1.0 without errors. The CRE runtime provides `atob`/`btoa` (SDK
`prepareRuntime`) and `TextEncoder`/`TextDecoder` (Javy), which is all that opening a box needs; it needs no randomness.
**Still OPEN:** actually running it under `cre workflow simulate`.

---

## Hand checklist (from the spec)

| # | Item | Status | Exact action |
|---|---|---|---|
| H1 | Request Confidential Workflows access | **OPEN** | Message the Chainlink mentor; record the answer in Q4 |
| H2 | Confirm sealed-box decryption runs inside a workflow | **OPEN** | See Q9 |
| H3 | Read hackathon rules (eligibility, judging, submission format) | **OPEN** | Human; record key constraints here |
| H4 | Read ACTA and the Confidential Agent Policy Verdicts draft; message the ACTA author | **OPEN** | Human |
| H5 | Re-read ERC8004SPEC.md at the installed commit | **Done for interfaces** (`b9e466c`, 2026-08-15) | Human read of non-interface sections still worth doing |

---

## Interface differences: installed source vs. spec

The installed source wins in each case. "Effect" says what changes in our build.

### ERC-8004 (`erc-8004/erc-8004-contracts@b9e466c`)

- **I-1. A Validation Registry exists on Monad testnet.** See Q5. Effect: only a decision, since both options go through the adapter.
- **I-2. `agentId` starts at 0.** `register()` does `agentId = $._lastId++` from 0. Effect: never use
  `agentId == 0` as "unset". Check that an agent exists with `ownerOf`, which reverts with
  `ERC721NonexistentToken`, inside `try/catch`.
- **I-3. The shipped ABI is stale.** `abis/IdentityRegistry.json` lacks `isAuthorizedOrOwner(address,uint256)`,
  but the source has it, the deployed testnet contract answers it, and Reputation depends on it. Effect: copy the
  adapter interfaces from the `.sol` sources, not from `abis/`. (The spec says "copied from the ABIs".)
- **I-4. "Operator" means ERC-721 approval, and `agentWallet` is not an operator.** ERC-8004 operator =
  `isApprovedForAll(owner, x)` or `getApproved(agentId)`. The spec's `VeilGate._controls` = `ownerOf` or
  `getAgentWallet`. So an approved operator can call `validationRequest` but cannot `bid`, and the agent
  wallet can `bid` but cannot `validationRequest`. Also, `getAgentWallet` returns `address(0)` when unset,
  and the wallet is cleared on every NFT transfer. Effect: keep the spec's `_controls` and document the asymmetry.
- **I-5. `validationResponse` can be called repeatedly, and request hashes are unique per registry.**
  `validationRequest` reverts with `"exists"` if the `requestHash` was used. `validationResponse` may be called many times
  ("progressive validation"). Effect: make `mirrorToERC8004` idempotent, or allow repeat calls on purpose.
  `requestId` already includes chain ID, registry address and a nonce, so it can't collide.
- **I-6. The two `getSummary` functions differ.** Validation's `getSummary(agentId, validatorAddresses, tag)` takes an
  optional validator list (empty means all); Reputation's requires a non-empty client list. Reputation's returns
  `(uint64 count, int128 summaryValue, uint8 summaryValueDecimals)` and normalises to the most common
  `valueDecimals`. Effect: none for `anchor` (always 2 decimals). Readers call
  `getSummary(agentId, [AnonymousFeedback], "veil8004", "anon-aggregate")`.
- **I-7. The registries can't be deployed with plain `new`.** They are UUPS implementations with `_disableInitializers()`,
  and `initialize` is `reinitializer(2) onlyOwner`. A fresh Anvil deploy must go
  `ERC1967Proxy(HardhatMinimalUUPS, initialize(identity))` → `upgradeToAndCall(impl, initialize(...))`.
  Identity's `initialize()` takes no arguments; Reputation and Validation take `identityRegistry_`.
  Effect: `Deploy.s.sol` follows this two-step pattern.
- **I-8. OpenZeppelin version.** erc-8004-contracts locks OZ `5.4.0`, and `HardhatMinimalUUPS` calls
  `__UUPSUpgradeable_init()`, which OZ 5.6.x removed. Effect: both OZ submodules are pinned to **v5.4.0**, which still meets the
  spec's "OpenZeppelin 5.x".

### Chainlink CRE

- **C-1. `ReceiverTemplate` is not in any package.** It isn't in `@chainlink/contracts@1.5.0`
  or in `chainlink-evm/contracts/cre/src/v1`. Chainlink copies it into each starter template. Effect: vendored unmodified
  from `cre-templates@d0223f3` into `contracts/lib/chainlink-cre/` (see `VENDORED.md`, which has the sha256 of each file).
- **C-2. Workflow-identity checks are setters, not constructor arguments.** The constructor takes only the forwarder
  (as the spec says) and sets `Ownable(msg.sender)`. Identity checks are turned on afterwards with
  `setExpectedWorkflowId(bytes32)`, `setExpectedAuthor(address)` and `setExpectedWorkflowName(string)`. The name check
  reverts unless an author is also set, and names are truncated to 40 bits. The workflow ID only exists after
  `cre workflow deploy`. Effect: the deploy runs in two steps (deploy consumer, deploy workflow, then call
  `setExpectedWorkflowId` on the consumer). Locally, the MockForwarder supplies a fixed fake workflow ID per workflow.
- **C-3. `onReport` metadata layout.** It is 64 bytes: `abi.encodePacked(bytes32 workflowId, bytes10 workflowName, address workflowOwner, bytes2 reportId)`.
  `workflowName` is the ASCII bytes of the first 10 hex characters of `sha256(name)`. Effect: our MockForwarder must
  build exactly this.
- **C-4. The real forwarder does not bubble up receiver reverts.** `KeystoneForwarder` (and Chainlink's own
  `MockKeystoneForwarder`) call `onReport` with a low-level call, record `success=false`, and emit
  `ReportProcessed(receiver, executionId, reportId, false)`. Effect: on testnet, a rejected report is a *successful*
  forwarder transaction with `result=false`. Our MockForwarder will bubble reverts so Foundry tests can assert
  the specific custom error, and the demo and indexer read `ReportProcessed.result` on testnet.
- **C-5. The forwarder checks ERC-165 first.** It calls `supportsInterface(IReceiver)` before routing. `ReceiverTemplate`
  implements it. Effect: consumers must keep it if they override `supportsInterface`.
- **C-6. Workflow runtime is QuickJS.** There is no `fetch`, no Node crypto and no `setTimeout`, and probably no `WebAssembly`. Effect: sealed-store reads go
  through the `http-actions` capability (DON consensus over the response). The sealed-store bearer token is a
  CRE secret but is visible to nodes in a standard workflow. For the libsodium question see Q9.
- **C-7. Capability maturity.** `confidential-http`, `http-trigger`, `http-actions` and `consensus` are
  `1.0.0-alpha`; `evm` and `cron-trigger` are `1.0.0`.

### Semaphore V4 (`@semaphore-protocol/contracts@4.14.3`)

- **S-1. `createGroup()` fixes `merkleTreeDuration = 1 hours`.** An old Merkle root stops verifying one hour after
  it is replaced. A rater who builds a proof against a root that has since changed, and submits more than an hour later,
  fails with `Semaphore__MerkleTreeRootIsExpired`. Effect: call the overload `createGroup(address(this), merkleTreeDuration)`
  with a duration of at least `epochLength` plus the rating window. (The spec says `semaphore.createGroup()`.)
- **S-2. Nullifiers are stored per group.** That is `groups[groupId].nullifiers`. One identity in two categories in the same
  epoch would produce the same nullifier for the same `(agentId, epoch)` scope in two groups, and Semaphore accepts both.
  Effect: none to the design, but it confirms the spec's `NullifierRegistry` check with context
  `(agentId, epoch)` is load-bearing, not redundant. Keep it.
- **S-3. Message and scope are hashed inside the contract** (`keccak256(abi.encodePacked(x)) >> 8`). `proof.scope` stays
  the raw `uint256`, so the spec's raw equality check against `uint256(keccak256(abi.encode(agentId, epoch)))` is correct.
- **S-4. `PoseidonT3` is an external library.** It has a `public` `hash`, used through `InternalLeanIMT`. Effect: deploy it and link
  it (`forge script --libraries` or deploy-then-link). Forge tests auto-link.
- **S-5. Proof generation fetches artifacts over the network.** `generateProof` downloads `.wasm` and `.zkey` per tree depth unless
  you pass `snarkArtifacts`. Effect: for an offline `make demo`, pre-download the artifacts for the depths used and pass
  their paths.
- **S-6. The proof struct matches.** `SemaphoreProof { merkleTreeDepth, merkleTreeRoot, nullifier, message, scope, uint256[8] points }`
  is as the spec assumes. `validateProof` reverts (it does not return false) on a reused nullifier, an invalid proof, an
  unknown or expired root, or an empty group.

- **S-7. `generateProof` hangs under Bun (Phase 5).** ffjavascript's multi-threaded curve setup never finishes
  under Bun 1.4.2 (single-threaded: 33 ms), and fastfile's FileHandle is closed by GC with `ERR_INVALID_STATE`.
  `@semaphore-protocol/proof`'s `generateProof` cannot pass snarkjs's `singleThread` option. Effect:
  `sdk/src/semaphore.ts` `proveMembership` reproduces `generateProof` (same circuit inputs, same packing) and calls
  `groth16.fullProve` with `{ singleThread: true }` and in-memory artifacts. `contracts/test/Semaphore.t.sol`
  verifies its proofs at depths 1 to 4 against the real `SemaphoreVerifier`. A depth-1 proof takes about 0.4 s.
- **S-8. PoseidonT3 does not fit under via-IR (Phase 5).** With this repo's settings (via-IR, 200 runs) PoseidonT3
  compiles to 29,315 bytes, over EIP-170's 24,576, and `forge script` refuses to deploy it. A per-file
  `compilation_restrictions` without via-IR spreads to everything that imports it, and Semaphore's verifier then fails
  with "stack too deep". Forge's `libraries` setting is ignored for this `../node_modules` source. Effect:
  `script/lib/SemaphoreDeployer.sol` deploys poseidon-solidity's published PoseidonT3 (23,478 bytes) at its canonical
  address through the CREATE2 proxy, then links Semaphore's creation code to that address by hand (it replaces the
  `__$…$__` placeholder) and deploys it. Tests use the same path. The payload is
  `script/lib/PoseidonT3.create2.json`, which `sdk/src/semaphore.test.ts` checks against the npm package and the
  CREATE2 address. Side effect: the canonical build is cheaper (6.30M vs 6.96M gas for the depth 1–4 roots test).
- **S-9. Artifacts are fetched once and pinned (S-5 resolved).** `make artifacts` downloads the depth 1–4 `.wasm`/`.zkey`
  (v4.13.0, the version `@semaphore-protocol/proof@4.14.3` asks for) into the git-ignored `.cache/snark-artifacts`.
  SHA-256 hashes are pinned in `sdk/src/snarkArtifacts.ts`, on first download (trust on first use); each zkey is then
  checked against the verifier by a real proof in `Semaphore.t.sol`. Proving needs no network after that.
- **T-4. `Deploy.s.sol` writes the deployment file even when the broadcast fails.** `vm.writeJson` runs during
  simulation, so a failed broadcast (as with the oversized PoseidonT3) leaves addresses with no code. Check for
  `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL` or for code at the addresses; `semaphore-check.ts` does the latter.

### Tooling

- **T-1.** Bun was not installed. Installed `bun@1.4.2` globally (`npm i -g bun@1.4.2`) because `@chainlink/cre-sdk` declares `engines.bun >=1.2.21`.
- **T-2.** Foundry treats a remapping target ending in `.sol/` as a file. The remapping is `@zk-kit/=../node_modules/@zk-kit/`
  instead of `@zk-kit/lean-imt.sol/=…`.
- **T-3.** `forge init` created a nested git repo in `contracts/`. It was removed, and Solidity dependencies are submodules
  of the top-level repo.

---

## Phase 2 decisions and differences from the spec (2026-10-09)

Decided with the project owner before building:

- **P2-1. `latestRequest` only moves for agent controllers.** The spec lets anyone call `requestPrivate` for any agent,
  and `isAttested` reads `latestRequest[agentId][policyId]`. Taken literally, a stranger could revoke an agent's pass
  with a failing input, or attest an agent with an easy one. Built: anyone may still request (Flow A clients and the
  treasury operator work as written), but `_processReport` updates `latestRequest` only when the request's requester
  controls the agent *when the report lands*: its owner, an ERC-721 operator (ERC-8004's own rule for
  `validationRequest`), or its verified agent wallet. `verifyResult` per request is unchanged. New event:
  `LatestRequestUpdated(agentId, policyId, requestId)`. Note the asymmetry with `VeilGate._controls` (owner or wallet
  only, I-4): an operator can refresh an agent's attestation but cannot use it to `bid`.
- **P2-2. Sealed boxes are pure-JS (noble).** See Q9.
- **P2-3. Sealed-store griefing is documented, not fixed.** `PUT` is unauthenticated and write-once, keyed by the public
  requestId, so an observer can store junk first: W1 then stops (mismatch) and the request stays Pending. The client
  can re-request with a new salt. Mitigation (future work): the store accepts a `PUT` only with a signature from the
  request's on-chain requester. Recorded in docs/threat-model.md.
- **P2-4. Additive edits to Phase 1 files:** `Deploy.s.sol` (Phase 2 contracts, nested `veil` block in the deployment
  JSON), `sdk/src/deployments.ts` (optional `veil` field), `frontend/app/indexer/page.tsx` (split view above the
  unchanged Phase 1 sections), plus `scripts/src/gen-abis.ts` (also writes `sdk/src/abi/veil.ts`), `scripts/src/env.ts`
  (roles 7–9) and `contracts/foundry.toml` (read access to `test/vectors`). `make phase1` still passes.

Choices made where the spec is silent (none changes a claim):

- **P2-5. Input encoding.** The validation input is a UTF-8 string; `keccak256(input)` hashes its raw bytes. For
  `SANCTIONS_SCREEN_V1` the input is the subject sent to the screening API. Vectors generated with `cast` are in
  `contracts/test/vectors/commitments.json` and are checked by both Solidity and TypeScript.
- **P2-6. Extra checks in `_processReport`:** the reported `tier` must be a valid enum value (`InvalidTier`).
- **P2-7. `mirrorToERC8004` is once per request** (`AlreadyMirrored`), only after a result is recorded (`NotRecorded`),
  callable by anyone, and emits `MirroredToERC8004`. This is the I-5 "idempotent" option.
- **P2-8. `TreasuryAction.execute` is callable by anyone.** The spec restricts *whose result* counts (the treasury
  operator's request), not who triggers the public action.
- **P2-9. `MockForwarder` has a transmitter allow-list.** It checks no DON signatures, so the only key that may deliver
  is the local runner's (Anvil account 8). It bubbles receiver reverts (C-4) and checks ERC-165 first (C-5).
- **P2-10. W1 expiry** = `now + validityWindow − min(60 s, window/10)`. The margin absorbs clock skew between the
  deciding clock and the block that includes the report. Locally, "now" is the latest block timestamp.
- **P2-11. W1 evaluates `SANCTIONS_SCREEN_V1` only.** Other policies stop without a report (`QUALIFIED_SCREENER_V1`
  arrives with Phase 3). The demo `SANCTIONS_SCREEN_V1` policy: tier `Don`, validity `POLICY_VALIDITY_SECONDS`
  (default 3600).
- **P2-12. Payload race.** The client uploads after `requestPrivate`, so W1 can trigger before the upload exists. The local
  runner polls the store for up to 15 s; the CRE workflow fetches once, after the log trigger's `SAFE` confidence delay.
  A request whose payload arrives too late stays Pending, and the client re-requests.

Unverified external detail:

- **C-8. Confidential HTTP secret template.** `cre/workflows/w1-validator/main.ts` puts `{{.SCREENING_API_KEY}}` in a header
  and names the secret in `vaultDonSecrets`. The field names come from the SDK types; the `{{.NAME}}` template syntax comes
  from the CRE docs and is not visible in the installed package. Confirm with `cre workflow simulate`.

---

## Phase 3 decisions and differences from the spec (2026-10-09)

Decided with the project owner before building:

- **P3-1. What `QUALIFIED_SCREENER_V1` checks.** The spec names the policy but not its check. Built: the input is the
  agent's screener credential ID (a string). W1 sends it to `POST /qualify {credential}` on the screening provider
  (Confidential HTTP in the CRE wiring, same API key) and passes when the provider lists the credential as qualified.
  The mock provider (`services/mock-screening`) has a fixed, fictional list. The agent's owner makes the request, so the
  result becomes the agent-level result (P2-1). This closes P2-11's "arrives with Phase 3".
- **P3-2. Sealed bids are keyed by `bid:<bidCommitment>` and uploaded before `bid()`.** The spec's `taskId:agentId`
  keys are predictable, and `PUT` is unauthenticated and write-once (P2-3). Anyone, including a rival bidder, could
  store junk under any agent's key first. W3 would then drop that agent's bid, so a bidder could knock out a cheaper
  competitor and break "lowest valid bid wins". Nobody else knows a bid commitment until it is on-chain, so a bidder who
  uploads first cannot be squatted. The store still accepts the spec's `taskId:agentId` pattern (no behaviour change),
  but nothing uses it. W3 looks each bid up by its on-chain commitment. Bids have no payload race either (unlike P2-12).
- **P3-3. Additive edits to Phase 1-2 files**, each forced by a Phase 3 requirement: `Deploy.s.sol` (creates
  `QUALIFIED_SCREENER_V1` and deploys `SealedBidHiring` pinned to W3; adds `sealedBidHiring` and `w3WorkflowId` to the
  `veil` block of the deployment JSON), `sdk/src/deployments.ts` (the same two fields, optional), `scripts/src/gen-abis.ts`
  (`sealedBidHiringAbi`), `cre/handlers/validator.ts` and its CRE wiring (P3-1), `services/mock-screening` (`/qualify`),
  `services/sealed-store` (P3-2 key pattern), `cre/local-runner` (also watches `BiddingClosed` and runs the W3 handler
  when `W3_DECRYPT_KEY` and `SEALED_STORE_W3_TOKEN` are set), `test/Leak.t.sol` (a second contract, `BidLeakTest`;
  `LeakTest` is unchanged), the indexer page (a nav link only), `globals.css` (two rules), and the `Makefile`
  (`phase3`). `make phase1` and `make phase2` still pass.

Choices made where the spec is silent (none changes a claim):

- **P3-4. Deadline boundary.** `bid` is accepted while `block.timestamp < deadline`, and `closeBidding` is allowed from
  `block.timestamp >= deadline`. There is no second in which both are possible.
- **P3-5. Task IDs start at 1** (`taskCount`), so 0 never names a task. A bid on an unknown task reverts `NotAttested`,
  because the `onlyAttested` modifier runs first and an unknown task has no policy.
- **P3-6. Extra contract surface.** Event `NoAward(taskId)` when W3 counts no valid bid (the spec only says the status
  becomes NoAward). Error `ZeroMerkleRoot` rejects an award with a zero root. Views `getTask`, `getBids` (in
  placement order, which W3 needs) and `getAward`, plus the public mapping `bidCommitmentOf`. The winner's salt is
  checked but not stored.
- **P3-7. Price encoding.** A price is a `uint256` in base units (the demo uses an 18-decimal fictional token). The sealed
  opening is JSON `{price: "<decimal string>", salt: "0x…32 bytes"}`, because JSON numbers cannot carry a `uint256`.
- **P3-8. W3 guards.** W3 refuses to decide (no report) if the number of bids it reads differs from `BiddingClosed.bidCount`.
  It drops a bid whose opening is missing, does not open with the W3 key, is malformed, exceeds `uint256`, or does not
  match the commitment. Its logs (and the local runner's) carry only what the report makes public, plus each dropped
  bid's agent and reason, never a counted losing price.
- **P3-9. How a loser gets an inclusion proof.** Only the root goes on-chain. A loser rebuilds W3's tree from public data:
  every on-chain bid, `validBidCount` and the root (`sdk/src/merkle.ts reconstructBidTree`). When W3 dropped bids, it
  searches the subsets of size `validBidCount`, capped at 65,536 combinations. A consequence is that *which* bids were
  dropped can be derived from public data. The claims table never claimed that was hidden.
- **P3-10. `identityCommitment` is not validated in `postTask`.** The demo passes 0 until Phase 5 brings Semaphore identities.
- **P3-11. W3 CRE wiring status.** `cre/workflows/w3-bid-opener/main.ts` typechecks against `@chainlink/cre-sdk` 1.23.0 and
  compiles to WASM (3.5 MB, Javy 8.1.0), including `@openzeppelin/merkle-tree`. Like W1, it has **not** been run under
  `cre workflow simulate` (no CLI, Q1).

---

## Phase 5 decisions and differences from the spec (2026-10-09)

- **P5-1. Rating window (differs from the spec).** The spec lets `anchor` run as soon as the epoch ends. A client
  whose receipt landed late in the epoch could then be shut out by an early anchor. Added `ratingWindow` (constructor,
  `RATING_WINDOW_SECONDS`, default 1 hour): `submit` for epoch E is accepted until
  `ratingClosesAt(E) = (E + 1) * epochLength + ratingWindow`, and `anchor` only from then on. The aggregate is final
  once anchoring is possible.
- **P5-2. Group root duration (resolves S-1).** Every receipt group is created with
  `createGroup(address(this), epochLength + ratingWindow)`. Roots are only replaced by receipts, which land inside the
  epoch, so a root replaced at any point still verifies until ratings close. Tested with a real proof against a
  replaced one-member root (`AnonymousFeedback.t.sol`).
- **P5-3. A client's second job in the same group.** Semaphore reverts on a duplicate leaf, which would make that W2
  report fail. The manager checks `hasMember` and skips the add, but still records the second job's agent. The client
  can then rate both agents, once each, as with any member.
- **P5-4. Group ids start at 0 in Semaphore.** The manager stores `groupId + 1`; `groupId(category, epoch)` reverts
  `NoGroup` before the first receipt, and `hasGroup` is a view.
- **P5-5. No receipt without an identity commitment (resolves P3-10).** A task posted with commitment 0 can be hired
  and completed but gets no receipt (`NoIdentityCommitment`). A commitment outside the SNARK field makes Semaphore revert,
  which blocks only that client's own receipt.
- **P5-6. The receipt's epoch is when the W2 report lands**, not when the job was completed. A W2 report delayed across
  an epoch boundary puts the receipt in the next epoch's group.
- **P5-7. Interfaces.** `IVeilReceipts.sol` holds `IVeilReceipts` (the receipt manager) and `IVeilFeedback`
  (AnonymousFeedback), with full NatSpec.
- **P5-8. The anchored average rounds down.** `sum * 100 / count`, 2 decimals: scores 5, 5, 4 anchor as 466 (4.66).
- **P5-9. NullifierRegistry contexts are shared by all consumers,** so only owner-allow-listed consumer contracts may
  consume. Deploy.s.sol allow-lists AnonymousFeedback only.
- **P5-10. What a receipt reveals.** `MemberAdded` (Semaphore) and `ReceiptIssued(taskId, category, epoch, groupId,
  agentId)` tie the client's commitment to the task. That was already public at `postTask`. A rating reveals the agent,
  epoch, category, score and nullifier; `AnonymousFeedback.t.sol` byte-scans a rating's calldata and logs and finds no
  member's commitment or address. The rater is hidden among the group's members, so the anonymity set is the number of
  clients with a receipt in that category and epoch.

## Pinned versions

| Dependency | Version | How pinned |
|---|---|---|
| Foundry (forge/anvil/cast) | 1.6.0-v1.7.0 (`f83bad9`) | local toolchain |
| solc | 0.8.26 | `foundry.toml` |
| forge-std | v1.17.0 (`f3dae6e`) | submodule + `foundry.lock` |
| OpenZeppelin contracts | v5.4.0 | submodule + `foundry.lock` (see I-8) |
| OpenZeppelin contracts-upgradeable | v5.4.0 | submodule + `foundry.lock` |
| erc-8004-contracts | `b9e466c` (2026-08-15, no tags upstream) | submodule + `foundry.lock` |
| Chainlink CRE ReceiverTemplate | cre-templates `d0223f3` | vendored, sha256 in `VENDORED.md` |
| @semaphore-protocol/contracts | 4.14.3 (→ @zk-kit/lean-imt.sol 2.0.1, poseidon-solidity 0.0.5) | `bun.lock`, exact |
| @semaphore-protocol/core | 4.14.3 | `bun.lock`, exact |
| @chainlink/cre-sdk | 1.23.0 (→ cre-sdk-javy-plugin 1.7.0) | `bun.lock`, exact |
| viem | 2.57.4 | `bun.lock`, exact |
| @openzeppelin/merkle-tree | 1.0.8 | `bun.lock`, exact |
| libsodium-wrappers | 0.8.4 | `bun.lock`, exact; devDependency, interop test only (see Q9) |
| @noble/curves / @noble/ciphers / @noble/hashes | 1.9.1 / 1.3.0 / 2.2.0 | `sdk/package.json` + `bun.lock`, exact (Phase 2, Q9) |
| Javy (fetched by `cre-compile` into `~/.cache/javy`) | 8.1.0 | `@chainlink/cre-sdk-javy-plugin` 1.7.0 |
| next / react / react-dom | 16.4.0 / 19.3.0 / 19.3.0 | `bun.lock`, exact |
| typescript | 5.9.3 | `bun.lock`, exact (7.x skipped: Next.js tooling support unverified) |
| Bun | 1.4.2 | `packageManager` in `package.json` |
| CRE CLI | v1.37.0 (release binary `cre_darwin_arm64.zip`) | local toolchain, `~/.local/bin/cre` |
