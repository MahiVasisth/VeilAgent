# W3 Bid opener (CRE workflow)

Trigger: EVM log `BiddingClosed` on `SealedBidHiring`.
Steps (all decisions in [`cre/handlers/bidOpener.ts`](../../handlers/bidOpener.ts)):

1. Decode the task from the log, then read its bids in placement order with `getBids`. Stop if their number differs from
   the event's `bidCount`.
2. GET each sealed opening from the sealed store under `bid:<commitment>` (HTTP capability, node mode, identical-value
   consensus). Bidders upload before they bid (docs/phase0.md P3-2).
3. Decrypt each `{price, salt}` with `W3_DECRYPT_KEY` (pure-JS sealed box) and recompute the commitment. Drop bids that
   are missing, don't decrypt, are malformed, or don't match.
4. Pick the lowest price (ties go to the earliest bid) and build an OpenZeppelin StandardMerkleTree over the counted
   `[taskId, agentId, commitment]` leaves.
5. Encode `(taskId, winnerAgentId, winningPrice, winnerSalt, validBidCount, merkleRoot)`, or all zeros when nothing
   was counted (NoAward), and `writeReport` it to `SealedBidHiring` through the CRE forwarder.

## Status

| Check | Result |
|---|---|
| Typecheck against `@chainlink/cre-sdk@1.23.0` | passes: `bunx tsc -p cre/workflows/w3-bid-opener` |
| `cre-compile main.ts w3.wasm` (Javy/QuickJS bundle, includes `@openzeppelin/merkle-tree`) | passes, 3.5 MB |
| `cre workflow simulate` | **not run**: the CRE CLI is not installed (docs/phase0.md Q1) |
| Deployed on Monad testnet | no |

Locally, the same handler runs in [`cre/local-runner`](../../local-runner), a **simulation** of the DON.

## To run with the CRE CLI (not yet done)

As for W1 (see `../w1-validator/README.md`). The secrets are `W3_DECRYPT_KEY` and `SEALED_STORE_W3_TOKEN`. In a standard
workflow the nodes can read both, and every opened bid (claims table: bids hidden from node operators only with a
Confidential Workflow). Simulate with the `closeBidding` transaction hash. After `cre workflow deploy`, call
`setExpectedWorkflowId(<id>)` on `SealedBidHiring`.
