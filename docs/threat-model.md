# Veil8004 threat model

Status: Phase 2. This file holds the claims table from docs/SPEC.md and is updated whenever a
Phase 0 answer or a later decision (docs/phase0.md) changes what can be claimed. The README claims only what this
table says.

## Claims and limits

| Property | Claimed? | Notes |
|---|---|---|
| Validation input hidden from chain observers | Yes | Salted commitment only |
| Input bound to the on-chain commitment | Yes | W1 recomputes it and the registry rejects a mismatch |
| Validation input hidden from CRE node operators | Only with a Confidential Workflow | In a standard workflow the nodes decrypt the payload |
| Validator API credentials hidden | Yes | Confidential HTTP |
| Losing bid prices hidden from chain observers | Yes | Never opened on-chain |
| Bids hidden from CRE node operators | Only with a Confidential Workflow | W3 sees every bid |
| Winner and winning price | Not hidden | Public by design |
| Which agents bid | Not hidden | Bidder addresses are visible; a relayer is future work |
| Winner's bid matches its commitment | Yes | Checked on-chain |
| The winner was the lowest valid bid | Trusted to W3 | The chain cannot check it without opening losing bids; losers can only prove inclusion |
| Bidder collusion | No | Out of scope |
| Selective disclosure to an auditor | Yes | One request, when the requester chooses |
| Forced disclosure by a third party | No | Only the requester holds the salt |
| Rater unlinkable to wallet | Yes, within the group's anonymity set | Small groups give weak anonymity; the client's identity commitment is public at postTask |
| Rater actually used the rated agent | Partly | The proof shows a completed job with some agent in that category and epoch, and that the rated agent had one too |
| Individual scores | Not hidden | Only the rater is hidden |
| Linking through the rating transaction | Mitigated by a relayer or fresh wallet | State the residual risk |
| Receipt farming by a colluding agent | Raised in cost, not eliminated | Each receipt needs an awarded, completed job |
| Payment rail privacy | No | Out of scope |
| Gated action visibility | No | The action itself is public |
| Assurance tier enforcement | No | Recorded and displayed; enforcement is specified in the extension draft |
| Simulated clients | Disclosed | The demo's anonymity set is partly simulated |

## Phase 0 effect on claims (2026-10-08)

- Q3 (Confidential HTTP) confirms *Validator API credentials hidden*. No change.
- Q4 (Confidential Workflows) is OPEN. Until access is confirmed and demoed, the two rows marked
  "Only with a Confidential Workflow" are **designed, not demoed**. W1 reports `Tier.Don`.
- C-4 (forwarder swallows receiver reverts) changes no claim. On testnet a rejected report shows as
  `ReportProcessed(..., result=false)`, not as a reverted transaction.
- C-6 (QuickJS runtime): in a standard workflow the sealed-store bearer token is visible to DON nodes,
  like the payload it protects. Already covered by the node-operator rows.

## What Phase 2 demonstrates (locally, 2026-10-09)

`make phase2` runs on Anvil with the local runner, a **simulation** of the DON (no consensus, no report signatures, no
enclave; the screening API key comes from env instead of Confidential HTTP).

| Row | Demonstrated by |
|---|---|
| Validation input hidden from chain observers | `contracts/test/Leak.t.sol` scans every call's calldata, storage write and log of the flow; `scripts/src/phase2.ts` scans Phase 2 calldata and logs plus the full Anvil state for every input, salt and unsalted input hash |
| Input bound to the on-chain commitment | the W1 handler stops on a tampered opening (handler tests, runner log); the registry rejects a mismatched commitment (`CommitmentMismatch`) |
| Gated action visibility: No | `ActionExecuted(requestId)` is public, by design |
| Assurance tier enforcement: No | the tier is recorded (`Don` locally) and displayed, not checked against the policy |

Not demonstrated in Phase 2: Confidential HTTP (the W1 CRE wiring is written and compiles, but has not been simulated or
deployed, docs/phase0.md Q1/C-8), and anything that needs a Confidential Workflow.

## Adversaries, assets and residual risks

To be completed in Phase 6. Recorded so far:

- **Sealed-store griefing (Phase 2, P2-3).** The store's `PUT` is unauthenticated and keys are write-once, and the
  requestId is public in `PrivateValidationRequested`. An observer can upload junk under a fresh requestId before the
  client does. W1 then finds a mismatch and writes no report, so the request stays Pending (it never yields a wrong
  result). The client can re-request with a new salt, but the attacker can repeat this. Future mitigation: accept a `PUT`
  only with a signature from the request's on-chain requester.
- **Who can move an agent's attestation (P2-1).** Only requests by the agent's owner, an ERC-721 operator or its
  verified wallet update `latestRequest`. Third-party requests get a per-request result only.
- **Payload race (P2-12).** A payload uploaded after W1 has fetched leaves the request Pending.
- **Requester and agent are public.** `PrivateValidationRequested` and the transaction sender show who asked for which
  policy on which agent, and the result. Only the input is hidden.
