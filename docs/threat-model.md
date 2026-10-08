# Veil8004 threat model

Status: Phase 0. This file holds the claims table from docs/SPEC.md and is updated whenever a
Phase 0 answer (docs/phase0.md) changes what can be claimed. The README claims only what this
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

## Adversaries, assets and residual risks

To be completed in Phase 6.
