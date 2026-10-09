# W1 Validator (CRE workflow)

Trigger: EVM log `PrivateValidationRequested` on `PrivateValidationRegistry`.
Steps (all decisions in [`cre/handlers/validator.ts`](../../handlers/validator.ts)):

1. Decode the request from the log.
2. GET the sealed payload from the sealed store (HTTP capability, node mode, identical-value consensus).
3. Decrypt `{input, salt}` with `W1_DECRYPT_KEY` (pure-JS sealed box) and recompute the commitment.
   On a mismatch, a missing payload or an unknown policy: stop, no report.
4. Screen the subject through **Confidential HTTP**. `SCREENING_API_KEY` is injected in the enclave from the vault.
5. Read the policy's validity window from `PolicyRegistry`, then encode the report
   `(requestId, commitment, passed, policyId, tier, expiry)` with tier `Don`, or `TeeDon` only when
   `confidentialWorkflow` is true.
6. `writeReport` to `PrivateValidationRegistry` through the CRE forwarder.

## Status

| Check | Result |
|---|---|
| Typecheck against `@chainlink/cre-sdk@1.23.0` (restricted workflow types) | passes: `bunx tsc -p cre/workflows/w1-validator` |
| `cre-compile main.ts w1.wasm` (Javy/QuickJS bundle, unsupported-API check) | passes, 2.7 MB |
| `cre workflow simulate` | **not run**: the CRE CLI is not installed (docs/phase0.md Q1) |
| Confidential HTTP secret template syntax `{{.SCREENING_API_KEY}}` | from the CRE docs, **unverified** until simulate |
| Deployed on Monad testnet | no |

Locally, the same handler runs in [`cre/local-runner`](../../local-runner), a **simulation** of the DON.

## To run with the CRE CLI (not yet done)

`cre init` generates the project files (`project.yaml`, `workflow.yaml`, `secrets.yaml`) that are not committed
here. Point its workflow entry at this `main.ts`, copy `config.example.json` to the config file it names, and set
these secrets: `W1_DECRYPT_KEY`, `SEALED_STORE_W1_TOKEN`, `SCREENING_API_KEY` (vault, for Confidential HTTP). Then:

```bash
cre workflow simulate <this dir> --target staging-settings --non-interactive \
  --trigger-index 0 --evm-tx-hash <requestPrivate tx> --evm-event-index 0
```

After `cre workflow deploy`, pin the workflow on the consumer: `setExpectedWorkflowId(<id>)` on
`PrivateValidationRegistry` (docs/phase0.md C-2). Keep the simulate log in `docs/` as bounty evidence.
