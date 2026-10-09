# Veil8004

Private attestations for ERC-8004 agents on Monad testnet, with sealed-bid agent hiring as the
flagship application and Chainlink CRE running the validator, the bid opener and the receipt issuer.

**Status: Phase 4 (selective disclosure).** The requester of one private validation can open it to an auditor with a
disclosure bundle (`sdk/src/disclosure.ts`): the request's input and salt, plus where to find it. The auditor
(`scripts/src/auditor.ts`, or the `/audit` page) recomputes the commitment and compares it, the agent, the policy, the
result, the tier and the expiry with the chain. Nothing goes on-chain, and every other request stays sealed.

Phase 3 (sealed-bid hiring) added `SealedBidHiring`, the second `VeilGate` consumer: only agents
that hold `QUALIFIED_SCREENER_V1` can bid, bids are salted commitments, and the W3 bid-opener handler opens them
off-chain and awards the lowest. Only the winner, the winning price and a Merkle root over the counted bids reach the
chain. As in Phase 2, the DON is **simulated** locally.

Phase 2 (private validation and gate), on top of the Phase 1 public baseline: `PolicyRegistry`,
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

### Phase 3: sealed-bid hiring

```bash
make phase3          # clean Anvil -> deploy -> agents -> services + local runner (W1 + W3) -> exit checks -> auction page
KEEP=1 make phase3   # same, but leave everything running: http://127.0.0.1:3000/auction
```

`scripts/src/phase3.ts` registers a fourth agent that fails its qualification, posts a task, and has three agents
pass `QUALIFIED_SCREENER_V1` through W1 (a **mock** `/qualify` endpoint with fictional credentials). The unqualified
agent and a non-controller are rejected. The three bid (each sealed opening is uploaded under `bid:<commitment>` before
the bid transaction). A duplicate bid, an early close and a late bid are rejected, anyone closes bidding, and the local
runner's W3 awards the lowest. A replayed award is rejected, two losers verify Merkle inclusion from public data, and
the client marks the job completed. It then leak-scans calldata, logs and the full Anvil state for the losing prices and
salts. `make phase3` also checks the service logs and the auction page.

```bash
bun scripts/src/bidder.ts bid --task 1 --agent 0 --price 4217350000000000000000   # needs W3_PUBLIC_KEY, a running store
bun scripts/src/bidder.ts inclusion --task 1 --agent 0                            # public data only
```

What this shows, as far as the [claims table](docs/threat-model.md) allows: losing bid prices stay off-chain, and the
winner's price is checked against its commitment on-chain. That the winner was the lowest valid bid is **trusted to
W3**; losers can only prove their bid was counted. Which agents bid, the winner and the winning price are public. The
W3 CRE workflow is written and compiles to WASM, but has not been simulated or deployed, so hiding bids from node
operators is designed, not demoed.

### Phase 4: selective disclosure

```bash
make phase4          # clean Anvil -> deploy -> agents -> services + local runner (W1) -> exit checks -> audit page
KEEP=1 make phase4   # same, but leave everything running: http://127.0.0.1:3000/audit
```

`scripts/src/phase4.ts` records four private validations (a pass, a fail, a client's pass and a pending one) and has the
requester export a bundle for one. The auditor CLI verifies it with `eth_call` only. Bundles with a different input,
salt, agent, policy, chain or registry are rejected, and so is the disclosed opening pointed at any other request. A
dictionary attack using the disclosed salt and every real demo input opens none of the other commitments. The audit
sends no transaction, and no input or salt reaches the chain, including the disclosed one. `make phase4` then checks
the service logs and the `/audit` page and its `/audit/verify` endpoint.

```bash
bun scripts/src/auditor.ts bundle.json            # read-only; exit 0 = verified, 1 = not verified, 2 = malformed
bun scripts/src/auditor.ts bundle.json --json     # machine-readable report
```

The bundle contains the salt. Anyone who holds it can verify the request and pass it on, so hand it only to the auditor.

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
