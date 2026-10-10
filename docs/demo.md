# Veil8004 demo walkthrough

This page is written for someone who has never seen the project. It takes about 3 minutes to run and 10 to present. It
follows the demo script in docs/SPEC.md. Every sentence the demo prints is also a check, so a run that finishes with
`DEMO EXIT CHECK PASSED` has shown everything below.

## What you are about to see, in one paragraph

ERC-8004 gives AI agents an on-chain identity, reputation and validation, all in public. Anyone can rebuild who hired
whom, what they paid, what was screened and how they rated it. Veil8004 keeps the composable parts (contracts can still
check "this agent passed policy P") and hides the sensitive parts. Validation inputs become salted commitments, bids
become sealed commitments, and ratings come from anonymous members of a "completed a job" group. Chainlink CRE
workflows do the private work off-chain: W1 validates, W3 opens bids, W2 issues receipts.

## Before you start

You need macOS or Linux with:

| Tool | Version | Check |
|---|---|---|
| Foundry (`forge`, `anvil`, `cast`) | 1.6+ | `forge --version` |
| Bun | 1.4.2+ | `bun --version` |
| `git`, `curl`, `openssl` | any | |

```bash
git clone --recurse-submodules https://github.com/MahiVasisth/VeilAgent.git
cd VeilAgent
make install     # submodules + JS workspaces
make build       # contracts + generated ABIs
```

No CRE account, no testnet funds and no `.env` are needed. The demo makes throwaway keys for each run and never
writes them to disk. The first run downloads the Semaphore proving artifacts once (about 14 MB, hashes pinned in
`sdk/src/snarkArtifacts.ts`). After that the demo works offline.

Ports 8545 (Anvil), 8787 (sealed store), 8788 (mock screening) and 3000 (pages) must be free.

## Run it

```bash
make demo                    # run and check everything, then stop (~70 s)
KEEP=1 make demo             # same, but leave the chain, services and pages running (for presenting)
PAUSE=1 KEEP=1 make demo     # also wait for Enter between steps (for presenting live)
```

With `KEEP=1`, open <http://127.0.0.1:3000/indexer> when it finishes. The last lines print the process ids to stop,
and where the step-4 audit bundle was saved.

## Try it hands-on instead

`make app` starts the same stack with nothing scripted, and serves the app at <http://127.0.0.1:3000/app>. Pick a demo
account and follow the five steps it prints. Agent owners get qualified and bid, clients post, close, complete and
rate, and the treasury screens privately. Use "+10 min" to move past a bidding deadline.

## What is real and what is simulated

Say this up front when presenting. It is also printed at the start of the run and shown as banners on the pages.

- **Real:** every contract (Solidity, on a local Anvil chain), the ERC-8004 registries (deployed from the official
  sources), our own Semaphore V4 deployment, the Groth16 proofs, the sealed-box encryption, and the workflow handler
  code.
- **Simulated:** the Chainlink DON. A *local runner* runs the same handler code as the CRE workflows and delivers
  reports through a *MockForwarder*, with no consensus, no signatures and no enclave.
- **Mocked:** the screening provider (a fixed, fictional list).
- **Simulated population:** six simulated clients join the anonymity set, labeled `simulated` everywhere.
- **Fictional:** all agent names (Atlas, Borealis, Cirrus, Drift), counterparties, credentials and prices.

## The six steps

### Step 1. Public baseline (plain ERC-8004)

*What happens.* Two clients pay two agents, ask a public validator to screen a counterparty, and leave feedback,
using ERC-8004 as deployed today.

*What to point at.* The printed list of "what any indexer reconstructs": client → agent → payment → score, and the
counterparty name in the validation request. On the page, `/indexer` → **Plain ERC-8004** column and the leak graph
at the bottom.

### Step 2. Sealed auction

*What happens.*
1. A client posts a task that only agents holding `QUALIFIED_SCREENER_V1` may bid on. Its Semaphore identity
   commitment rides along, for the receipt later.
2. A fourth agent, Drift, tries to get that attestation. W1 records a **fail**, and Drift's bid reverts `NotAttested`.
3. Atlas, Borealis and Cirrus get the attestation privately: each commits to its credential on-chain and seals the
   credential to W1.
4. They bid. On-chain each bid is a commitment, and the price is sealed to W3.
5. After the deadline anyone closes bidding. W3 opens the bids off-chain and awards **Borealis**, the lowest. The
   winning price is public by design.
6. Atlas, a loser, proves from public data that its bid was counted (a Merkle inclusion proof).
7. A scan of every calldata byte, log and storage slot finds **no losing price or salt**.
8. The client marks the job completed, and W2 gives the client a **receipt** (membership in the group for this
   category and epoch).
9. **Simulated:** six simulated clients do the same, so the receipt group has 7 members.

*What to point at.* `/auction`: bids are shown as commitments, the losing prices read "sealed", and the inclusion check
column reads "counted". The simulated tasks carry a `simulated client` tag.

### Step 3. Private validation and the gate

*What happens.*
1. Before paying Borealis, the treasury screens a counterparty privately (`SANCTIONS_SCREEN_V1`). Only a salted
   commitment goes on-chain. W1 decrypts the opening, checks that it matches the commitment, calls the (mock) provider
   and records **pass**.
2. `TreasuryAction.execute(requestId)` succeeds. The action itself is public.
3. **Tampered input:** commit to one counterparty, seal another. W1 sees the mismatch and writes nothing, so `execute`
   reverts.
4. **Expired result:** a fresh pass would unlock the action, but an hour later `execute` reverts.

*What to point at.* `/indexer` → **Veil8004** column: agent, policy, requester, commitment and result. There is no
input, because the chain has none.

### Step 4. Selective disclosure to an auditor

*What happens.* The treasury gives its auditor a bundle for the first screen: that request's input and salt. The
auditor CLI checks it against the chain with reads only and prints what it learned: the counterparty, the pass, the
tier and the expiry. The same opening pointed at any other request opens nothing. The audit sends no transaction.

*What to point at.* `/audit`: paste the bundle from the path printed at the end (with `KEEP=1`) and press Verify. Any
edit to the input or salt makes verification fail.

### Step 5. Anonymous feedback

*What happens.* The client rates Borealis 5/5 with a Semaphore proof that says "I hold a receipt in this group",
scoped to (Borealis, this epoch). It is sent from a fresh wallet, a stand-in for a relayer. The chain learns the score
and that **one of 7** receipt holders gave it. A second rating by the same client is rejected (same nullifier). When
the rating window closes, anyone anchors the average into the ERC-8004 Reputation Registry, where standard readers see
it through `getSummary`.

*What to point at.* `/indexer` → **Ratings, two ways**. On the plain side, the client's address sits next to the
score. On the Veil8004 side, the rater column reads "one of 7".

### Step 6. Side by side

*What happens.* The script prints both indexer views, then runs a final leak scan (20 secrets, none found), the
measured gas, and the claims table.

*What to point at.*
- `/costs`: gas per operation, plain ERC-8004 next to Veil8004. One private attestation costs about 301k gas in all
  (request plus W1 result). An anonymous rating costs about 361k, most of it the on-chain proof check.
- `/claims`: the claims table. Close on it. Read out what is **not** claimed: hiding from node operators needs a
  Confidential Workflow, the bid opener is trusted to pick the lowest bid, scores and bidders are public, and the
  anonymity set here is mostly simulated.

## If something goes wrong

| Symptom | Fix |
|---|---|
| `something is already listening on http://127.0.0.1:8545` | an earlier `KEEP=1` run is still up: stop the process ids it printed (`kill <pids>`) |
| `missing forge` / `missing bun` | install the tools listed above |
| Hangs at "check the pinned Semaphore proving artifacts" | the first run downloads them; check network access, then run `make artifacts` |
| `timed out: grep -q JobCompleted` | the local runner did not start; the log path is printed after "start a clean Anvil" |
| A `FAIL` line | the run exits non-zero and prints the failed statements; the service logs are in the printed log directory |

## Where each part lives

| Step | Contracts | Off-chain |
|---|---|---|
| 1 | ERC-8004 registries (`contracts/lib/erc-8004-contracts`) | `scripts/src/baseline.ts` |
| 2 | `SealedBidHiring`, `PrivateValidationRegistry`, `VeilGate` | `cre/handlers/bidOpener.ts` (W3), `validator.ts` (W1), `receiptIssuer.ts` (W2), `scripts/src/bidder.ts`, `simulator.ts` |
| 3 | `PrivateValidationRegistry`, `TreasuryAction` | `cre/handlers/validator.ts` |
| 4 | none (reads only) | `sdk/src/disclosure.ts`, `scripts/src/auditor.ts` |
| 5 | `ReceiptGroupManager`, `AnonymousFeedback`, `NullifierRegistry`, Semaphore V4 | `sdk/src/semaphore.ts`, `scripts/src/rater.ts` |
| 6 | none | `sdk/src/indexer/*`, `frontend/app/*` |
