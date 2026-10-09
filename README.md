# Veil8004

Private attestations for ERC-8004 agents on Monad testnet, with sealed-bid agent hiring as the
flagship application and Chainlink CRE running the validator, the bid opener and the receipt issuer.

**Status: Phase 2 (private validation and gate).** On top of the Phase 1 public baseline: `PolicyRegistry`,
`PrivateValidationRegistry` (salted input commitments, results written back through a CRE forwarder), `VeilGate` and
its first consumer `TreasuryAction`, the W1 validator handler, the sealed store, a **mock** screening API, a
**MockForwarder**, and a **local runner that simulates the CRE DON**. The indexer page now shows the split view.

What Phase 2 demonstrates, all locally on Anvil, and only as far as the [claims table](docs/threat-model.md) allows:
the validation input stays off-chain (only a salted commitment is published), and it is bound to that commitment
(a tampered input yields no result). The gated treasury action itself is public.
Not demonstrated yet: anything on a real CRE DON. The W1 CRE workflow is written and compiles to WASM, but has not been
simulated or deployed (no CRE CLI yet), so Confidential HTTP credential hiding is designed, not demoed. Input hiding
from node operators needs a Confidential Workflow and is designed, not demoed.

- Build spec: [docs/SPEC.md](docs/SPEC.md)
- Phase 0 findings and open items: [docs/phase0.md](docs/phase0.md)
- What this project claims and does not claim: [docs/threat-model.md](docs/threat-model.md).
  This README makes no claim beyond that table.

## Setup

Requirements: Foundry, Bun ≥ 1.4.2, and (for testnet only) the CRE CLI ≥ 1.30.0.

```bash
git clone --recurse-submodules https://github.com/MahiVasisth/VeilAgent.git
cd VeilAgent
make install
cp .env.example .env
make build
make test
```

### Phase 1: the public baseline

```bash
make phase1          # clean Anvil -> deploy -> register agents -> public flow -> indexer checks (CLI and page)
KEEP=1 make phase1   # same, but leave Anvil and the page running: http://127.0.0.1:3000/indexer
```

The page and `bun scripts/src/indexer.ts` rebuild the client, agent, payment, score and validation graph from
public events and transactions only. That graph is what Veil8004 sets out to hide. The entity names and the
"sanctions list" used by the baseline validator are fictional demo data, and the validator is a plain Anvil account.

### Phase 2: private validation and the gate

```bash
make phase2          # clean Anvil -> deploy -> baseline -> sealed store + mock screening + local runner -> exit checks
KEEP=1 make phase2   # same, but leave everything running: http://127.0.0.1:3000/indexer
```

`scripts/src/phase2.ts` shows the treasury action passing on a valid result and failing on missing, failed, expired,
wrong-policy, tampered-input and someone else's results. It also checks that replayed reports and non-forwarder callers
are rejected, and leak-scans the chain for every input and salt it used. `make phase2` then checks the page: plain
inputs on the left, only commitment, policy and result on the right.

Simulated or mocked here, and labeled as such in logs and on the page:
- **Local runner** (`cre/local-runner`): a simulation of the CRE DON. It runs the same W1 handler as the CRE workflow,
  but has no consensus and no report signatures, and reads the screening API key from env (no Confidential HTTP).
- **MockForwarder**: delivers reports from one allow-listed key and checks no DON signatures.
- **Mock screening API**: a fixed, fictional hit list.

Secrets for a run (W1 key pair, store token, API key) are generated fresh by `scripts/phase2.sh` and never written to disk.

Everything runs locally on Anvil without a CRE account.

## Layout

```
contracts/   Foundry project (src/{interfaces,core,consumers,receipts,mocks}, test/, script/)
cre/         handlers/ (pure), workflows/ (CRE wiring), local-runner/ (DON simulation)
services/    sealed-store/, mock-screening/ (MOCK)
sdk/         commitments, seal, bids, merkle, disclosure, semaphore
scripts/     client, bidder, auditor, demo, simulator
frontend/    indexer split view, auction view, cost panel
docs/        SPEC.md, phase0.md, threat-model.md, extension-draft.md
```
