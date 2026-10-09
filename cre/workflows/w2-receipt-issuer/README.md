# W2 Receipt issuer (CRE workflow)

Trigger: EVM log `JobCompleted` on `SealedBidHiring`.
Steps (all decisions in [`cre/handlers/receiptIssuer.ts`](../../handlers/receiptIssuer.ts)):

1. Decode the task id from the log, then read the task back with `getTask` and `receiptIssued` on `ReceiptGroupManager`.
   The log's commitment is not trusted.
2. Stop, with no report, if a receipt was already issued, the task is not `Completed`, it has no identity commitment
   (docs/phase0.md P5-5) or the commitment is outside the SNARK field. Each of these would revert on-chain.
3. Encode `abi.encode(uint256 taskId)` and `writeReport` it to `ReceiptGroupManager` through the CRE forwarder. The
   manager reads the commitment, category and awarded agent from `SealedBidHiring` itself, so W2 can only name a task.

W2 needs no secrets: everything it reads is public.

## Status

| Check | Result |
|---|---|
| Typecheck against `@chainlink/cre-sdk@1.23.0` | passes: `bunx tsc -p cre/workflows/w2-receipt-issuer` |
| `cre-compile main.ts w2.wasm` (Javy/QuickJS bundle) | passes, 2.6 MB |
| `cre workflow simulate` | **not run**: the CRE CLI is not installed (docs/phase0.md Q1) |
| Deployed on Monad testnet | no |

Locally, the same handler runs in [`cre/local-runner`](../../local-runner), a **simulation** of the DON.

## To run with the CRE CLI (not yet done)

As for W1 (see `../w1-validator/README.md`), with no secrets. Simulate with the `completeJob` transaction hash. After
`cre workflow deploy`, call `setExpectedWorkflowId(<id>)` on `ReceiptGroupManager` (or deploy with `W2_WORKFLOW_ID`).
