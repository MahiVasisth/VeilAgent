# Veil8004 threat model

Status: final for Phase 6 (2026-10-10). This file holds the claims table from docs/SPEC.md and is updated whenever a
Phase 0 answer or a later decision (docs/phase0.md) changes what can be claimed. The README, the demo (`make demo`,
step 6) and the frontend's `/claims` page claim only what this table says. The last two read it from this file, and
`sdk/src/claims.test.ts` checks that the README's copy and the spec's table match it.

Everything demonstrated so far runs locally on Anvil, against a **simulated** DON (the local runner and a
MockForwarder). No row below has been demonstrated on a real CRE DON. That includes "Validator API credentials hidden",
which depends on Confidential HTTP: the W1 workflow is written and compiles to WASM, but has not been run under
`cre workflow simulate` (docs/phase0.md Q9, C-8).

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

## What Phase 2 demonstrates (locally, 2026-10-09)

`make phase2` runs on Anvil with the local runner, a **simulation** of the DON (no consensus, no report signatures, no
enclave; the screening API key comes from env instead of Confidential HTTP).

| Row | Demonstrated by |
|---|---|
| Validation input hidden from chain observers | `contracts/test/Leak.t.sol` scans every call's calldata, storage write and log of the flow; `scripts/src/phase2.ts` scans Phase 2 calldata and logs plus the full Anvil state for every input, salt and unsalted input hash |
| Input bound to the on-chain commitment | the W1 handler stops on a tampered opening (handler tests, runner log); the registry rejects a mismatched commitment (`CommitmentMismatch`) |
| Gated action visibility: No | `ActionExecuted(requestId)` is public, by design |
| Assurance tier enforcement: No | the tier is recorded (`Don` locally) and displayed, not checked against the policy |

Not demonstrated in Phase 2: Confidential HTTP (the W1 CRE wiring is written and compiles, but has not been simulated or
deployed, docs/phase0.md Q1/C-8), and anything that needs a Confidential Workflow.

## What Phase 3 demonstrates (locally, 2026-10-09)

`make phase3` runs on Anvil with the local runner (a **simulation** of the DON) delivering W1 qualifications and the W3
award through the MockForwarder.

| Row | Demonstrated by |
|---|---|
| Losing bid prices hidden from chain observers | `contracts/test/Leak.t.sol` (`BidLeakTest`) records a whole auction and byte-scans calldata, storage writes and logs for the losing prices (as words and as decimal strings) and salts; `scripts/src/phase3.ts` scans Phase 3 calldata and logs plus the full Anvil state; `scripts/phase3.sh` checks the service logs and the auction page |
| Winner's bid matches its commitment | `_processReport` reverts `WinnerCommitmentMismatch` unless the reported price and salt open the winner's stored commitment (`SealedBidHiring.t.sol`) |
| The winner was the lowest valid bid: trusted to W3 | the handler picks the lowest valid price (tests in `cre/handlers/bidOpener.test.ts`); on-chain, a loser can only check that its bid was counted (`verifyInclusion`) |
| Winner and winning price: not hidden | `JobAwarded` carries both, and the report carries the winner's salt |
| Which agents bid: not hidden | `BidPlaced(taskId, agentId, commitment)` and the transaction sender; the auction page lists them |
| Bids hidden from CRE node operators: only with a Confidential Workflow | not demonstrated; the W3 CRE wiring compiles but has not been simulated (docs/phase0.md P3-11) |

## What Phase 4 demonstrates (locally, 2026-10-09)

`make phase4` runs on Anvil. W1 results come from the local runner (a **simulation** of the DON). Disclosure itself
needs no DON: the auditor only reads the chain.

| Row | Demonstrated by |
|---|---|
| Selective disclosure to an auditor: one request, when the requester chooses | `scripts/src/phase4.ts`: the auditor CLI verifies one bundle. A bundle with a different input, salt, agent, policy, chain or registry is rejected, and so is the disclosed opening pointed at each other request. A dictionary attack with the disclosed salt opens no other commitment. The audit sends no transaction. Unit tests in `sdk/src/disclosure.test.ts` |
| Validation input hidden from chain observers (unchanged by disclosure) | the Phase 4 leak scan finds no input or salt on-chain, including the disclosed request's |
| Forced disclosure by a third party: No | holds against chain observers and the auditor. The caveats are listed below |

## What Phase 5 demonstrates (locally, 2026-10-09)

`make phase5` runs on Anvil with our own Semaphore V4 deployment. W2 receipts come from the local runner (a
**simulation** of the DON).

| Row | Demonstrated by |
|---|---|
| Rater unlinkable to wallet, within the group's anonymity set | `scripts/src/phase5.ts`: ratings are Semaphore proofs sent from fresh wallets. Byte scans of every rating's calldata and logs find no client address and no member's identity commitment, and no identity secret is anywhere on-chain. `AnonymousFeedback.t.sol` (`test_ratingCarriesNoIdentityCommitment`) |
| Rater actually used the rated agent: partly | `submit` requires `agentInGroup[category][epoch][agentId]`; an agent with no receipt-bearing job in the group cannot be rated (`AgentNotInGroup`) |
| Individual scores: not hidden | `FeedbackSubmitted` carries the score |
| Linking through the rating transaction: mitigated by a relayer or fresh wallet | `scripts/src/rater.ts` sends from a fresh wallet by default; the indexer view flags a rating sent from a client's own address |
| Receipt farming: raised in cost, not eliminated | no receipt without an awarded, completed job with an identity commitment (forged and replayed W2 reports revert) |
| One rating per client, agent and epoch | Semaphore rejects the reused nullifier (`Semaphore__YouAreUsingTheSameNullifierTwice`); the NullifierRegistry records it across groups |

## What the demo demonstrates (Phase 6, locally, 2026-10-10)

`make demo` runs every flow on one fresh chain, prints each statement and checks it (`scripts/src/demo.ts`, 28 checks),
then checks all five pages. The population simulator adds **simulated** clients to the client's receipt group
(6 by default). The `/indexer`, `/auction` and `/costs` pages show a banner and a `simulated` label while simulated
data is on the chain.

| Row | Demonstrated by |
|---|---|
| Simulated clients: disclosed | the demo prints "7 members, 6 of them SIMULATED", every page that shows them carries the banner, and `contracts/deployments/<chainId>-simulated.json` lists each simulated client, task and rater |
| All rows above | one end-to-end leak scan after the plain baseline: no validation input, credential, salt or losing price in calldata, logs or the full Anvil state |

The demo's anonymity set is 7, and 6 of those are simulated. With only real users, the set would be the number of
real clients with a receipt in that category and epoch.

## Adversaries, assets and residual risks

### Assets

| Asset | Where it lives | Who can see it |
|---|---|---|
| Validation input (e.g. a counterparty name, a credential) | the requester; sealed in the store; decrypted inside W1 | requester, DON nodes (standard workflow), an auditor the requester chooses |
| Validation salt | the requester; inside the sealed payload | same as the input |
| Losing bid prices and salts | each bidder; sealed in the store; decrypted inside W3 | that bidder, DON nodes (standard workflow) |
| Rater identity (which receipt holder rated) | the client's Semaphore identity, kept locally | the client only |
| Workflow decryption keys, screening API key | CRE secrets (env for the local runner) | the DON (standard workflow); the enclave (confidential) |
| Sealed-store bearer tokens | CRE secrets | the DON |

### Adversaries

| Adversary | Can | Cannot (as far as the table claims) |
|---|---|---|
| **Chain observer / indexer** | read every event, calldata byte and storage slot; label policies and categories by hashing guesses; see who requested, who bid, who won and at what price, which agents were rated with which scores, and the receipt groups' member commitments | recover a validation input or a losing price (salted commitments, 32-byte salts); link a rating to a member of its group |
| **CRE node operator** (standard workflow) | see every decrypted input and bid inside W1/W3, and the store tokens | forge a result: reports need DON consensus, and the registry re-checks commitment and policy. Rows marked "Only with a Confidential Workflow" do **not** hold against this adversary |
| **Misbehaving DON / W3** | drop a valid bid or award a higher one; withhold any report | award a winner whose price does not open its commitment; record a result for a commitment it was not given |
| **Rival bidder** | see which agents bid and when; bid itself if attested | squat another bidder's sealed-store key (P3-2); learn a losing price |
| **Auditor** | verify the one request disclosed to it and pass the bundle on | open any other request, even with the disclosed salt and a dictionary of every real input (`make phase4`) |
| **Sealed-store griefer** | upload junk under a fresh requestId first, so W1 stops and the request stays Pending | make a request record a wrong result |
| **Colluding agent + client** | farm receipts by completing real (cheap) jobs, then rate | rate without a completed, awarded job; rate twice per agent and epoch with one identity |
| **Stranger** | request validations for any agent (per-request results only); close bidding; anchor; relay ratings | move an agent's attestation (P2-1); unlock TreasuryAction with their own pass (requester check) |

### Residual risks

- **Sealed-store griefing (Phase 2, P2-3).** The store's `PUT` is unauthenticated and keys are write-once, and the
  requestId is public in `PrivateValidationRequested`. An observer can upload junk under a fresh requestId before the
  client does. W1 then finds a mismatch and writes no report, so the request stays Pending (it never yields a wrong
  result). The client can re-request with a new salt, but the attacker can repeat this. Future mitigation: accept a `PUT`
  only with a signature from the request's on-chain requester.
- **Who can move an agent's attestation (P2-1).** Only requests by the agent's owner, an ERC-721 operator or its
  verified wallet update `latestRequest`. Third-party requests get a per-request result only.
- **Payload race (P2-12).** A payload uploaded after W1 has fetched leaves the request Pending.
- **Sealed-bid squatting (Phase 3, P3-2): mitigated by design.** Bids are stored under `bid:<commitment>` and uploaded
  before `bid()`, so nobody can claim a bidder's key first. A bidder who never uploads, or uploads a mismatched opening,
  is dropped. That is the only way to stay out of an auction, and it cannot stall the auction.
- **W3 decides who won (Phase 3).** A W3 that misbehaves (or the DON behind it) could drop a valid bid or pick a higher
  one. The chain only checks that the winner's opening matches its commitment. A loser who finds its bid "not counted"
  can show this publicly, but can prove its bid was valid and lower only by revealing its own price and salt. This is the
  "Trusted to W3" row.
- **What an auction leaks (Phase 3).** The task's client, policy, category and deadline; each bidder's agent, address
  and bid time; the winner, the winning price and how many bids were counted. From public data, which bids were dropped
  (P3-9). Losing prices are low-entropy, but each bid has a 32-byte salt, so the commitment cannot be brute-forced.
- **Bid-list growth (Phase 3).** One bid per agent per task, and only from agents that hold the policy, so a task's bid
  list is bounded by the number of attested agents. W3 reads it with one `getBids` call.
- **Requester and agent are public.** `PrivateValidationRequested` and the transaction sender show who asked for which
  policy on which agent, and the result. Only the input is hidden.
- **A disclosure bundle is transferable (Phase 4).** It proves knowledge of the opening, not who disclosed it. The
  auditor, or anyone the bundle reaches, can verify the request and pass it on. Disclosure cannot be revoked. Designated-
  verifier disclosure is future work.
- **Who else can build a bundle (Phase 4).** Anyone who holds the input and salt: the requester, and in a standard
  workflow the DON nodes that decrypt W1's payload (the node-operator row). With a Confidential Workflow, only the
  requester. So "forced disclosure by a third party: No" holds against chain observers and auditors, and against node
  operators only with a Confidential Workflow.
- **The anonymity set is small, and its edges are public (Phase 5).** A rater hides among the clients with a receipt in
  that category and epoch, and their identity commitments, tasks and agents are all public. If one member rated and only
  one member hired the rated agent, the "Partly" row lets an observer guess well. Timing helps them too: a rating that
  lands right after one client's receipt points at that client. Mitigations: pooled groups (wider categories, longer
  epochs), a relayer that batches submissions, and honesty about the set size (the pages show "one of N").
- **The rating wallet can link.** A rating sent from the client's own address undoes the proof. The rater tool sends
  from a fresh wallet funded by the Anvil deployer. On a real chain, funding that wallet is itself a link unless a
  relayer or a privacy-preserving funding path is used. The indexer view flags ratings sent from a client address.
- **Simulated members inflate the demo's anonymity set.** They are labeled wherever they appear. They show the
  mechanism, not real-world anonymity.
- **Timing and gas metadata.** Transaction timing, gas and the sender's nonce history are public. None of the claims
  covers them.
- **Proving artifacts are trusted on first use (S-9).** The zkey hashes are pinned on first download, and each is then
  checked against the verifier by a real proof. A compromised first download that still verifies would need a
  compromised trusted setup, which is out of scope.
- **Admin keys.** Contract owners can change the expected workflow ids, the policy active flags and the nullifier
  consumers. A malicious owner could pin a workflow that reports anything. Ownership should move to a multisig before
  any non-demo use.
- **The app keeps secrets in browser storage.** Salts, bid openings and Semaphore identities sit in the browser's
  `localStorage` for the app's origin. Anyone with that browser profile, or script running on that origin, can read
  them. Clearing site data loses them, which makes disclosure and rating impossible. The app offers an export. A
  hosted deployment would need a strict CSP and should consider encrypting the vault with a key derived from a wallet
  signature.
- **The app's server.** It forwards sealed boxes to the store (ciphertext only, sealed in the browser), serves the
  pinned proving artifacts (the browser checks their SHA-256 before use), and relays rating proofs. A malicious server
  could serve tampered page code that leaks secrets. That is the usual web-app trust: run it yourself, or serve a
  pinned build.
- **The relayer.** It sees a finished proof (public once on-chain) and the request's network origin. It can refuse or
  delay a rating, but cannot forge, alter or link one. Locally it is Anvil account 9; elsewhere `RELAYER_PRIVATE_KEY`.
  Without a relayer, the app asks before sending a rating from the user's own wallet, because that links it.
- **The auditor must pin the registry (Phase 4).** A bundle names its own registry. Unless the auditor compares it with
  the PrivateValidationRegistry it trusts, a look-alike contract could report any result. The auditor CLI and `/audit`
  compare against the deployment file and reject a mismatch.
