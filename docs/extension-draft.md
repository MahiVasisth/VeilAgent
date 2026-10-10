# ERC-8004 extension draft: private attestations, gates and anonymous receipts

Draft, 2026-10-10 · @mahi · Status: discussion draft, not submitted.

This draft specifies the four interfaces Veil8004 adds next to ERC-8004 (`IVeilValidation`, `IVeilGate`,
`IVeilReceipts` / `IVeilFeedback`, `IAssuranceTier`), and how assurance tiers would be **enforced**. The reference
implementation in this repository records and displays the tier but does not enforce it. The claims table
(docs/threat-model.md) says so ("Assurance tier enforcement: No"). The enforcement section below is design only.

The Solidity sources, with full NatSpec, are the normative text for everything already built:
`contracts/src/interfaces/{IAssuranceTier,IVeilValidation,IVeilGate,IVeilReceipts}.sol`.

## Abstract

ERC-8004 validation is public: the request file carries the input, and the response is tied to the requester and
the agent. This extension adds a private validation path. The requester commits on-chain to a salted hash of the
input and sends the opening, sealed, to an off-chain validator (here a Chainlink CRE workflow). The validator writes
back only pass or fail, at a declared assurance tier. Consumer contracts gate on those results with two modifiers. A
requester can later open one result to an auditor without touching any other. Clients who completed a job get an
anonymous receipt (a Semaphore group membership), and can rate the agent without revealing which client they are.
Per-epoch averages are written back into the ERC-8004 Reputation Registry, so existing readers see them.

## Motivation

An indexer that reads ERC-8004 today can rebuild who hired which agent, what they paid, what was screened and how
they rated it (`make phase1` shows this graph). For compliance screening, hiring and reputation, that graph is often
the sensitive part. The goal is to keep ERC-8004's composability, so that any contract can check "this agent passed
policy P", while hiding the input, the losing bids and the rater.

## Specification

The key words MUST, SHOULD and MAY are used as in RFC 2119.

### 1. Assurance tiers (`IAssuranceTier`)

```solidity
enum Tier { PublicReputation, Don, TeeDon, Zk }
enum Status { None, Pending, Passed, Failed }
```

A tier names what a verifier is trusting. `Don` is a standard CRE workflow: DON consensus, and node operators see the
inputs. `TeeDon` is a Confidential Workflow, where consensus runs over an enclave execution. `Zk` is a proof checked
on-chain. `PublicReputation` means no private computation at all. The tiers are not totally ordered (`Zk` and `TeeDon`
trust different things), so policies accept a **set** of tiers (section 5), not a minimum.

### 2. Private validation (`IVeilValidation`)

**Commitment.** Off-chain tooling MUST match this byte for byte:

```
commitment = keccak256(abi.encode(uint256 agentId, bytes32 policyId, bytes32 keccak256(input), bytes32 salt))
```

`salt` MUST be 32 uniformly random bytes. `input` is the raw UTF-8 bytes of the policy's input string.
`policyId = keccak256(bytes(policyName))`.

**Request.** `requestPrivate(agentId, policyId, commitment)` MUST revert if the policy is inactive, the agent does not
exist in the ERC-8004 Identity Registry, the commitment is zero, or the commitment was used before. It returns
`requestId = keccak256(abi.encode(block.chainid, address(this), nonce))` and emits
`PrivateValidationRequested(requestId, agentId, policyId, commitment)`.

**Report.** The validator's report payload is
`abi.encode(bytes32 requestId, bytes32 commitment, bool passed, bytes32 policyId, uint8 tier, uint64 expiry)`.
The registry MUST accept it only from its pinned workflow through the CRE forwarder, and MUST revert unless the request
is Pending (this is also the replay guard), the commitment and the policy equal the stored ones, the tier is a valid
enum value, and `block.timestamp < expiry <= block.timestamp + validityWindow`. The validator MUST NOT report when the
opening it received does not reproduce the commitment.

**Reads.** `verifyResult(requestId, policyId)` is true for an unexpired pass under that policy.
`isAttested(agentId, policyId) = verifyResult(latestRequest(agentId, policyId), policyId)`, so a later fail revokes an
earlier pass. `latestRequest` MUST move only for requests made by someone who controls the agent when the report lands
(owner, ERC-721 operator or verified agent wallet). Otherwise a stranger could attest or revoke any agent with an input
of their choosing.

**Mirror.** `mirrorToERC8004(requestId)` writes `validationResponse(requestId, passed ? 100 : 0, "", 0,
"veil8004-private")` to the ERC-8004 Validation Registry, once per request. It needs the agent's owner to have called
`validationRequest` naming the registry. It MUST stay separate from report processing, so that a missing standard
request never blocks a result.

### 3. Gates (`IVeilGate`)

Consumers inherit two modifiers:

| Modifier | For | Checks |
|---|---|---|
| `onlyAttested(agentId, policyId)` | agent-level policies (who may bid) | caller is the agent's owner or verified wallet, and `isAttested` |
| `onlyAttestedRequest(requestId, policyId)` | per-request policies (this payment) | `verifyResult`; the consumer MUST also check whose request it is |

The second row's MUST matters. Without it, anyone's passing result under the same policy unlocks the action.
`TreasuryAction` checks that the requester is its operator, and uses each requestId once.

### 4. Receipts and anonymous feedback (`IVeilReceipts`, `IVeilFeedback`)

* A client passes a Semaphore identity commitment when it posts a task. When the job is Completed, a receipt workflow
  reports the task. The manager reads the task back from the hiring contract, and MUST refuse a task that is not
  Completed, that already has a receipt, or that has no commitment. It then adds the commitment to the group for
  `(category, epoch)` and marks the agent as having had a job in that group.
* `submit(agentId, category, epoch, proof)` MUST check that the agent had a job in the group, that `message` is a
  score from 1 to 5, that `scope == uint256(keccak256(abi.encode(agentId, epoch)))`, that the rating window is open,
  that the Semaphore proof verifies against the group, and that a shared nullifier registry has not seen
  `(keccak256(abi.encode("feedback", agentId, epoch)), nullifier)`. The registry check is load-bearing: Semaphore's
  own nullifiers are per group, and one identity can sit in two groups (phase0.md S-2).
* Groups MUST be created with a Merkle-root duration of at least `epochLength + ratingWindow`, so a proof built
  against a root that has since been replaced still verifies until ratings close.
* `anchor(agentId, epoch)` is open to anyone after the rating window closes, once per agent and epoch, and needs at
  least one rating. It writes `giveFeedback(agentId, int128(sum * 100 / count), 2, "veil8004", "anon-aggregate", "",
  "", 0)`. Readers call `getSummary(agentId, [feedbackContract], "veil8004", "anon-aggregate")`.

### 5. Tier enforcement (design only, not implemented)

The reported tier is a claim made by the workflow about itself. Checking that `tier` is in an accepted set is
worthless unless the chain can also tell which kind of workflow sent the report. The design therefore binds tiers to
workflow identities:

```solidity
interface IVeilTierPolicy {
    /// Bit i set = Tier(i) accepted for results under this policy.
    function acceptedTiers(bytes32 policyId) external view returns (uint8 mask);
    /// The workflow ids allowed to report results at `tier`. Owner-managed, set after `cre workflow deploy`.
    function isTierWorkflow(IAssuranceTier.Tier tier, bytes32 workflowId) external view returns (bool);
}
```

* The registry reads `workflowId` from the report metadata (the first 32 bytes of the CRE metadata) and MUST revert
  `TierNotAccepted` unless `acceptedTiers(policyId)` has the reported tier's bit set and
  `isTierWorkflow(tier, workflowId)`.
* A `Zk` result has no workflow. It arrives through a separate entry point that verifies a proof on-chain.
* Gates MAY add `onlyAttestedAtTier(agentId, policyId, mask)`, so a consumer can demand more than the policy requires.
* What this still trusts: whoever pins `isTierWorkflow`, and Chainlink's attestation that a workflow id really runs as
  a Confidential Workflow. It moves the trust from "the workflow says so" to "the registered workflow is
  confidential". It does not remove that trust.

Why the reference implementation stops short: we have no Confidential Workflows access (phase0.md Q4), so `TeeDon` can
never be reported honestly here, and enforcing a set that only contains `Don` would demonstrate nothing.

## Rationale

* **Commit, then seal off-chain.** Only the commitment is public, and the salt defeats dictionary attacks on
  low-entropy inputs such as company names. The validator re-derives the commitment, so it cannot be fed one input
  while the chain records another.
* **Two gates.** Agent-level and per-request policies fail differently when misused. One modifier for both would
  either let strangers' results unlock actions or require one validation per bid.
* **Selective disclosure needs no contract.** The opening (input, salt) is itself the disclosure. Auditors verify it
  with `eth_call` only (`sdk/src/disclosure.ts`).
* **Anchor aggregates, not ratings.** Writing each anonymous score into the Reputation Registry would need a
  per-rating client address. One aggregate per epoch, from the feedback contract, keeps `getSummary` meaningful.

## Backwards compatibility

The extension adds contracts and calls existing ERC-8004 registries only through their public functions:
`ownerOf`, `getAgentWallet` and `isAuthorizedOrOwner` (Identity), `validationResponse` (Validation) and
`giveFeedback` (Reputation). ERC-8004 readers see mirrored results (tag `veil8004-private`) and anchored averages
(tags `veil8004` / `anon-aggregate`) without knowing about this extension.

## Security considerations

See docs/threat-model.md for the full list. The main ones:

* A standard CRE workflow decrypts payloads on every node: input and bid hiding from node operators need a
  Confidential Workflow.
* The bid opener decides who won. The chain checks only that the winner's opening matches its commitment.
* A disclosure bundle can be passed on, and disclosure cannot be revoked.
* Anonymity sets are as small as the number of clients with a receipt in a category and epoch.
* Unauthenticated sealed-store writes allow griefing that delays a validation, though it cannot falsify one.

## Reference implementation

This repository: `contracts/src` (Solidity 0.8.26), `cre/handlers` (pure workflow handlers), `cre/workflows` (CRE
wiring), `sdk` (TypeScript tooling). `make demo` runs the whole flow locally against a simulated DON.
