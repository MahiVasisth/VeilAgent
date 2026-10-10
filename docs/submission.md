# Phase 7: submission checklist

Status as of 2026-10-10. "Verified" means a command ran and passed on that date; the command is given.

## Done and verified

| Item | How it was verified |
|---|---|
| All tests pass | `make test`: 146 Foundry tests, 117 Bun tests |
| Every phase's exit criterion | `make phase1` … `make phase5`, each from a clean Anvil |
| Demo end to end | `make demo`: 28/28 checks, then all five pages checked (~70 s) |
| Fresh-clone run | a clone into an empty directory (with this working tree's changes applied, as a commit would), then submodules, `bun install`, `make build`, `make test` (146 Foundry tests; 115 Bun tests pass, and the 2 prover tests skip until the artifacts exist) and `make demo` (fetched the artifacts itself; 28/28 checks; pages checked) |
| Testnet deploy rehearsal | `DRY_RUN=1 make deploy-testnet`: full stack on a local fork of Monad testnet against the live ERC-8004 registries and CRE forwarder; every address has code and is wired |
| No secrets in the repo | `.env` is git-ignored; demo keys are generated per run, and the secret ones are never written to disk (KEEP=1 writes only the two public keys, to a temp dir); `.env.example` holds no values that are secret |
| README claims only the claims table | `sdk/src/claims.test.ts` checks that the README's table equals docs/threat-model.md's, and that each "Claimed?" cell equals the spec's |
| Simulated and mocked parts labeled | README, logs (`[SIMULATED DON]`, `[SIMULATED]`), page banners and per-row tags |
| Repo cleanup | placeholder `.gitkeep` files removed from populated directories; `client.ts` added so the scripts match the spec's list |
| Write-up draft | [docs/writeup.md](writeup.md) |
| Extension draft | [docs/extension-draft.md](extension-draft.md) |
| Final threat model | [docs/threat-model.md](threat-model.md) |

## Needs you (cannot be done from this machine without your accounts or decisions)

| Item | Exact action |
|---|---|
| **Video** | Record `PAUSE=1 KEEP=1 make demo` with the shot list below |
| **Hackathon rules (H3)** and the playbook's section 11 checklist | Neither file is in this repo. Read them and tick each item here |
| **ACTA / Policy Verdicts draft (H4)** | Read them, message the ACTA author, and position the project as interop (docs/SPEC.md Fallbacks) |
| **Confidential Workflows access (H1, Q4)** | Ask the Chainlink mentor and record the answer in docs/phase0.md Q4. Until then the README's "designed, not demoed" stays |
| **CRE simulation evidence (Q9, C-8)** | `cre workflow simulate` for W1, W3 and W2 with a real `--evm-tx-hash`. Keep each log in `docs/` (the spec asks for them as bounty evidence). That closes Q9 and C-8 |
| **Live testnet deployment** | Fill `.env` (funded `DEPLOYER_PRIVATE_KEY`, `TREASURY_OPERATOR`), run `DRY_RUN=1 make deploy-testnet`, then `make deploy-testnet`. Then deploy the workflows, pin their ids, and register agents (the script prints these steps). Commit `contracts/deployments/10143.json` |
| **Q5 decision** | The deploy uses our own Validation Registry (option a) unless `VALIDATION_REGISTRY` is set |
| **Commits** | Phase 5 (4–6/6), Phase 6 and Phase 7 work is in the working tree, not yet committed |

## Video shot list (about 3 minutes)

1. (0:00) One sentence: "ERC-8004 makes agent hiring public. Veil8004 keeps it composable but private." Show `/indexer`
   left column: the plain graph with names, payments and scores.
2. (0:20) Say what is simulated: the DON (local runner and MockForwarder), the mock screening list, and the simulated
   clients.
3. (0:35) Step 2 in the terminal: Drift rejected, three sealed bids, Borealis wins. Cut to `/auction`: losing prices
   "sealed", inclusion "counted".
4. (1:15) Step 3: pass → execute; tampered → nothing; expired → revert. Cut to `/indexer` right column: commitment
   only.
5. (1:45) Step 4: the auditor output, then paste the bundle into `/audit`. Edit one character to show the failure.
6. (2:15) Step 5: "one of 7", the second rating rejected, the anchored average.
7. (2:40) `/costs`, then `/claims`. Close on what is not claimed.
