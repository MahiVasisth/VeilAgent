# Veil8004

Private attestations for ERC-8004 agents on Monad testnet, with sealed-bid agent hiring as the
flagship application and Chainlink CRE running the validator, the bid opener and the receipt issuer.

**Status: Phase 6 (demo and documents).** All flows are built and run end to end on a local Anvil with one command:

```bash
make demo            # fresh Anvil -> deploy -> the six-step demo, every statement checked -> five pages checked
KEEP=1 make demo     # same, and leave everything running: http://127.0.0.1:3000/indexer
```

The walkthrough for someone seeing it cold is [docs/demo.md](docs/demo.md).

## Quick start: run the frontend and check it

Everything runs on your own machine: a local test chain, two small services, the workflow runner and the website.
No crypto wallet, no testnet funds and no accounts are needed. Tested on macOS and Linux.

### 1. Install the tools (once)

| Tool | Version | Install |
|---|---|---|
| Git | any | usually preinstalled (`git --version`) |
| Foundry (`forge`, `anvil`, `cast`) | recent | `curl -L https://foundry.paradigm.xyz \| bash`, then open a new terminal and run `foundryup` |
| Bun | ≥ 1.4.2 | `curl -fsSL https://bun.sh/install \| bash`, then open a new terminal |
| Node.js | ≥ 22 | [nodejs.org](https://nodejs.org) or `nvm install 22` |
| `curl`, `openssl`, `make`, `python3` | any | preinstalled on macOS and most Linux distributions |

Check them:

```bash
forge --version && anvil --version && bun --version && node --version
```

### 2. Get the code (once)

```bash
git clone --recurse-submodules https://github.com/MahiVasisth/VeilAgent.git
cd VeilAgent
make install          # git submodules + JavaScript packages
```

If you cloned without `--recurse-submodules`, `make install` fetches the submodules for you.

### 3. Start it

Pick one. Both build everything themselves the first time (a few minutes, and the first run downloads the pinned
Semaphore proving files, so it needs internet once).

**A. Filled with demo data (best for checking the UI):**

```bash
KEEP=1 make demo
```

It runs the scripted demo on a fresh chain (about 70 seconds), checks 28 statements and every page, and then **leaves
everything running**. When it prints `Demo complete.`, open **http://localhost:3000**. The last lines print the
process ids to stop it (`Stop with: kill …`) and the path of an audit bundle you can try on the Verify page.

**B. Empty, to click through the whole flow yourself:**

```bash
make app
```

When it prints `Veil8004 is running`, open **http://localhost:3000/app**. Press `Ctrl-C` in that terminal to stop
everything.

### 4. What to check

| Page | URL | What you should see |
|---|---|---|
| Home | `/` | Animated hero; a **Try it** box (type a company name, click *Screen privately*, watch the 4 steps); a **Flip the lens** public/private toggle |
| Dashboard | `/app` | Sign-in with a demo account (Atlas, Borealis, Cirrus, Client A, Client B, Treasury desk); Overview, Hire, Find work, Screening, Vault |
| Auctions | `/auction` | Filter tabs; task cards with 🔒 sealed bids and the winner in green; *On-chain proof* folds open |
| Explorer | `/indexer` | Scoreboard; tabs *What plain ERC-8004 exposes*, *Screenings*, *Ratings* (public on the left, private on the right) |
| Verify | `/audit` | Drop an audit bundle (option A prints its path) and see **Verified**; edit one character and see it fail |
| Gas costs | `/costs` | Gas per operation, ERC-8004 vs Veil8004 |
| Security claims | `/claims` | Everything the project claims, and doesn't |

The small **Demo network** chip on each page explains what is simulated on this local chain.

### 5. Try the full flow in the app (with option B, or on top of A)

You play several people. Switch accounts with the icon at the top right of the dashboard.

| # | Sign in as | Tab | Do |
|---|---|---|---|
| 1 | **Atlas** | Find work | Credential `QS-2026-0417` → **Get qualified** |
| 2 | **Borealis** | Find work | Credential `QS-2026-0582` → **Get qualified** |
| 3 | **Client A** | Hire | **Post task** (Sanctions screening, 10 min) |
| 4 | **Atlas**, then **Borealis** | Find work | Type a price on the open task → **Place sealed bid** |
| 5 | anyone | sidebar | Click **+10m** to pass the deadline, then **Close bidding** (Hire tab); the lowest bid wins |
| 6 | **Client A** | Hire | **Mark job completed**, wait a few seconds, then **Rate anonymously** |
| 7 | **Treasury desk** | Screening | Screen `Northwind Trading LLC` → **Export for audit**, then drop the file on **Verify** |

After each step, open **Auctions** or **Explorer** to see what the public sees. Fictional test data: the sanctions list
flags *Kestrel Shipping Co*, *Blackfin Holdings Ltd* and *Orrin Maritime SA*; valid credentials are
`QS-2026-0417`, `-0582`, `-0733` and `-0901`.

### 6. Editing the frontend (optional)

With option A running, stop its production web server and start the dev server, which reloads on every save:

```bash
pkill -f next-server                                  # stops only the website; the chain and services keep running
set -a; source <the public-keys.env path the demo printed>; set +a
cd frontend && bun run dev                            # http://localhost:3000
```

Without the `source` line everything works except sealing to the real workflow keys, so posting screenings and bids
from the app fails, and the home page's *Try it* box seals to a throwaway key instead.

Run `bun run build` in `frontend/` before committing to catch type errors, and `make demo` to re-run every page check.

### Troubleshooting

| Problem | Fix |
|---|---|
| `something is already listening on http://127.0.0.1:8545` or `… is in use` | An earlier run is still going. Stop it with the `kill …` line it printed, or `pkill anvil; pkill -f next-server; pkill -f sealed-store; pkill -f mock-screening; pkill -f local-runner` |
| Page says **We couldn't reach the network** | The chain isn't running. Start it again with step 3 |
| `missing anvil` / `missing bun` | Install the tool from step 1 and open a new terminal |
| Demo accounts don't appear on the sign-in screen | They only show on the local chain (31337). Make sure you started it with step 3 |
| The data is gone after a restart | Expected: every run starts a fresh chain. Use option A again for demo data |
| Proving files fail to download | Check your internet connection and run `make artifacts` once |

## What the app does, and what is simulated

```bash
make app             # fresh local chain + everything running; open http://127.0.0.1:3000/app (Ctrl-C stops)
```

The app at `/app` lets you act as an agent owner, a client or the treasury, with a browser wallet (MetaMask on
`http://127.0.0.1:8545`, chain 31337) or one of the labeled local demo accounts. You can get an agent qualified,
post a task, place sealed bids, close bidding, mark a job completed, rate anonymously, screen a counterparty privately,
execute the gated treasury action, and download an audit bundle. Salts, bid prices and rating identities are created
in your browser and kept in its local storage (exportable under "Vault"). Rating proofs are generated in your
browser. The app's server only forwards ciphertext to the sealed store and relays finished rating proofs.

**What is simulated or mocked, everywhere in this repo:**
- **The CRE DON.** A local runner (`cre/local-runner`) runs the same W1, W3 and W2 handler code as the CRE workflows
  and delivers reports through a **MockForwarder**. It has no consensus, no report signatures and no enclave, and it
  reads the screening API key from env, not through Confidential HTTP. The three CRE workflows are written and compile
  to WASM, but have not been run under `cre workflow simulate` or deployed.
- **The screening provider.** A mock API with a fictional hit list and a fictional credential list.
- **Part of the anonymity set.** The population simulator (`scripts/src/simulator.ts`) adds simulated clients so
  that a receipt group is not one person. Pages note it under the **Demo network** chip and label its rows `simulated` while its data is on the chain.
- **All names, counterparties, credentials and prices** are fictional demo data.

Input hiding from CRE node operators needs a Confidential Workflow, and is **designed, not demoed**. So is the hiding
of validator API credentials through Confidential HTTP.

- Build spec: [docs/SPEC.md](docs/SPEC.md)
- Phase 0 findings and open items: [docs/phase0.md](docs/phase0.md)
- What this project claims and does not claim: [docs/threat-model.md](docs/threat-model.md), copied below.
  This README makes no claim beyond that table.
- The ERC-8004 extension these contracts propose: [docs/extension-draft.md](docs/extension-draft.md)
- Demo walkthrough: [docs/demo.md](docs/demo.md)

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

### Phase 5: receipts and anonymous feedback

```bash
make artifacts       # once: fetch the Semaphore proving artifacts (pinned hashes; proving is offline after this)
make phase5          # clean Anvil -> deploy (incl. our own Semaphore V4) -> hiring -> W2 receipts -> ratings -> anchor
KEEP=1 make phase5   # same, but leave everything running: http://127.0.0.1:3000/indexer
```

`scripts/src/phase5.ts` has three clients post tasks with Semaphore identity commitments and hire through sealed bids.
When a client marks its job completed, W2 (the local runner) adds the client's commitment to the receipt group for
that category and epoch. Each client then proves membership offline and rates the agent from a fresh wallet. A second
rating for the same agent and epoch is rejected. So are ratings from non-members, out-of-range scores, mismatched
scopes, ratings for agents with no job in the group, and late ratings. No receipt is issued without a completed,
awarded job with an identity commitment. After the rating window, anyone anchors the average into the ERC-8004
Reputation Registry. It is read back with `getSummary(agent, [AnonymousFeedback], "veil8004", "anon-aggregate")`.

```bash
bun scripts/src/rater.ts identity --out me.identity                  # commitment to pass to postTask
bun scripts/src/rater.ts rate --task 1 --score 5 --identity me.identity # proves offline, sends from a fresh wallet
```

As far as the claims table allows: the rater is hidden within the group's anonymity set, and the score is not hidden.
The set is small (3 in `make phase5`), and the client's identity commitment is public from `postTask` onwards.

### Phase 6: the demo, the simulator and the cost panel

`make demo` runs the spec's demo script (docs/demo.md walks through it). It also adds:

- **`/costs`**: gas per operation, measured from transaction receipts. Plain ERC-8004 next to Veil8004, with the MockForwarder overhead labeled.
- **`/claims`**: the claims table, read from docs/threat-model.md.
- **The population simulator**: `make simulate CLIENTS=6 [RATE=1]` against a running `KEEP=1 make demo` chain
  (first `source` the `public-keys.env` file that the demo prints). Agent attestations that lapsed are renewed through W1.
  Everything it creates is listed in `contracts/deployments/31337-simulated.json` and labeled on the pages.

Everything runs locally on Anvil without a CRE account.

### Monad testnet

```bash
DRY_RUN=1 make deploy-testnet   # rehearse on a local fork of Monad testnet (live ERC-8004 registries + CRE forwarder); spends nothing
make deploy-testnet             # the real deployment; needs a funded DEPLOYER_PRIVATE_KEY and TREASURY_OPERATOR in .env
```

Not deployed yet; the remaining hand-run steps are in [docs/submission.md](docs/submission.md).

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

## Layout

```
contracts/   Foundry project (src/{interfaces,core,consumers,receipts,mocks}, test/, script/)
cre/         handlers/ (pure), workflows/ (CRE wiring), local-runner/ (DON simulation)
services/    sealed-store/, mock-screening/ (MOCK)
sdk/         commitments, seal, bids, merkle, disclosure, semaphore, claims, indexer views
scripts/     client, bidder, auditor, rater, demo, simulator, deploy-testnet, phase exit checks
frontend/    home (live demos), app dashboard, auctions, explorer (indexer view), verify (audit), costs, claims
docs/        SPEC.md, phase0.md, threat-model.md, extension-draft.md, demo.md, writeup.md, submission.md
```
