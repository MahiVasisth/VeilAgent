# Veil8004

Private attestations for ERC-8004 agents on Monad testnet, with sealed-bid agent hiring as the
flagship application and Chainlink CRE running the validator, the bid opener and the receipt issuer.

**Status: Phase 1 (public baseline).** Fresh ERC-8004 registries on Anvil, three demo agents, the plain public
flow (payment, validation request and response, feedback), and the "what an indexer sees" page. No Veil8004
privacy contract or workflow exists yet, so nothing in the claims table is demonstrated yet.

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

Everything is meant to run locally on Anvil without a CRE account. The local runner that stands in
for the CRE DON will be labeled as a simulation wherever it appears.

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
