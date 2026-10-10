# Veil8004: private attestations for ERC-8004 agents

*Submission write-up draft. It claims only what [the claims table](threat-model.md#claims-and-limits) claims.*

## The problem

ERC-8004 gives AI agents on-chain identity, reputation and validation. All of it is public. From events alone, an
indexer can rebuild who hired which agent, what they paid, which counterparty was screened (with the name in the
request file) and how the client rated the agent. For the jobs agents are being hired for, such as compliance
screening, procurement and treasury operations, that graph is the confidential part.

## What we built

Veil8004 keeps ERC-8004's composability, so a contract can still ask "has this agent passed policy P?", and takes the
sensitive data off-chain:

1. **Private validation.** The requester commits on-chain to `keccak256(agentId, policyId, keccak256(input), salt)`
   and seals the opening to a Chainlink CRE workflow (W1). W1 decrypts it and recomputes the commitment. It stops on a
   mismatch, calls the screening provider (through Confidential HTTP in the CRE wiring), and writes back only pass or
   fail through the CRE forwarder. The registry checks the commitment and the policy again.
2. **Gates.** `VeilGate` gives consumers two modifiers: agent-level (`onlyAttested`) and per-request
   (`onlyAttestedRequest`). There are two consumers: a treasury action and a sealed-bid hiring market.
3. **Sealed-bid hiring.** Only attested agents can bid, and each bid is a salted commitment. After the deadline, W3
   opens the bids off-chain and awards the lowest. The chain checks the winner's opening. Losers can prove that their
   bid was counted (Merkle inclusion), and their prices never go on-chain.
4. **Selective disclosure.** A requester can open exactly one validation to an auditor, who verifies it with reads only.
5. **Anonymous feedback.** A completed job earns the client a Semaphore receipt (W2). Ratings are proofs of
   membership in the receipt group, one per agent and epoch. Per-epoch averages are anchored into the ERC-8004
   Reputation Registry, so standard readers see them.

Everything runs with one command, `make demo`: a fresh chain, six narrated steps, 28 checked statements and five pages
(split indexer view, auction, audit, cost panel, claims), in about 70 seconds.

## What is and is not claimed

| Claimed | Not claimed |
|---|---|
| Validation inputs and losing bid prices are hidden from chain observers (leak-scanned: calldata, logs, full state) | Hiding from CRE node operators: needs a Confidential Workflow, designed, not demoed |
| Inputs are bound to their commitments (tampering yields no result) | That W3 picked the lowest bid: trusted to W3 |
| Disclosure of one request, by the requester's choice | Hidden scores, bidders, winner or winning price: all public |
| Rater hidden within the receipt group | Strong anonymity: the demo's group is 7, and 6 of those are simulated |

## How it was checked

* 146 Foundry tests, among them leak tests that byte-scan every calldata, storage write and log for the known secrets.
  117 TypeScript tests, among them cross-language commitment vectors, libsodium/noble sealed-box interop and Semaphore
  proofs verified by the real verifier.
* Exit scripts for each phase (`make phase1` … `make phase5`) and `make demo` run against a clean Anvil and check pages
  as well as chain state.
* `DRY_RUN=1 make deploy-testnet` deploys the full stack onto a local fork of Monad testnet. It uses the live ERC-8004
  registries and CRE forwarder, and checks every address and wire.

## Honest status

* **Simulated:** the CRE DON. A local runner runs the same handler code and delivers reports through a MockForwarder.
  The three CRE workflows compile to WASM, but have not yet run under `cre workflow simulate`.
* **Mocked:** the screening provider.
* **Open:** Confidential Workflows access (requested), a live Monad testnet deployment, and CRE simulation logs. See
  [docs/submission.md](submission.md).

## Measured cost (gas, Anvil, medians)

| Operation | Gas |
|---|---|
| Private attestation (request + W1 result) | 301,040 (plain ERC-8004 request + response: 320,653) |
| Sealed bid | 121,640 |
| W3 award | 143,260 |
| W2 receipt | 212,835 |
| Anonymous rating | 360,607 (plain `giveFeedback`: 229,132) |

## Links

* Spec: [docs/SPEC.md](SPEC.md) · Threat model: [docs/threat-model.md](threat-model.md) · ERC extension draft:
  [docs/extension-draft.md](extension-draft.md) · Demo walkthrough: [docs/demo.md](demo.md) · Decisions and deviations
  from the spec: [docs/phase0.md](phase0.md)
