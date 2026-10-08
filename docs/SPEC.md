# Veil8004 Build Plan

Oct 8, 2026 · @mahi

This is the complete, self-contained build spec for Veil8004: private attestations for ERC-8004 agents on Monad testnet, with sealed-bid agent hiring as the flagship application and Chainlink CRE running the validator, the bid opener and the receipt issuer. It is written to be handed to a coding agent, which builds it phase by phase. External facts were checked against public docs on 8 October 2026 and are listed under Sources.

## Rules that apply throughout

- Move to the next phase only when the exit criterion is met.
- Write the tests for each contract in the same phase as the contract, not at the end.
- Keep the threat model's claims table (playbook section 8) open from Phase 0, and update it whenever a Phase 0 answer changes what you can claim.
- Grow one thin frontend page per phase, rather than building the frontend at the end.

## Instructions for the coding agent

- Build one phase at a time, in the order given. A phase is done when its tests pass and its exit criterion is demonstrated by a script.
- Never invent an external interface. Take ERC-8004, CRE and Semaphore interfaces from the installed packages or repos. If a signature in this spec disagrees with the installed source, the source wins; record the difference in docs/phase0.md.
- Everything must run locally without a CRE account: Anvil, a MockForwarder, and a local runner that executes the same workflow handler code. `make demo` runs the whole demo script end to end.
- Write each workflow as a pure handler (inputs in, report bytes out) plus thin CRE wiring, so the handler is unit-tested and shared by the local runner and the deployed workflow.
- No plaintext input, salt or losing bid price may appear in calldata, storage, events or logs. Add a test that scans emitted events and stored state for the known secret values.
- Label anything simulated or mocked in the UI and the README.
- No secrets in the repo. Provide .env.example.
- The README claims only what the Claims and limits table says.

## Phase 0: Verify the unknowns

The exit is a written answer per item in docs/phase0.md and a fallback for each "no". The table records what public docs said on 8 October 2026; confirm each against your own account before relying on it.

| Question | Finding | Action |
|---|---|---|
| Can CRE write to Monad testnet? | Yes. Monad Testnet is listed, needing CLI v1.30.0+ and TypeScript SDK v1.19.0+. | Run `cre workflow supported-chains` to confirm for your account, and take the forwarder address from the Forwarder Directory. |
| Can a workflow trigger at a deadline? | CRE offers Cron, EVM Log and HTTP triggers. | Use an EVM Log trigger on a BiddingClosed event, emitted by a permissionless closeBidding call after the deadline. |
| What does Confidential HTTP hide? | It runs one request in an enclave with secrets injected by template and an optional encrypted response. Request parameters are supplied by the Workflow DON nodes, so workflow inputs are visible to them. | Claim credential hiding only. Input hiding from node operators needs Confidential Workflows. |
| Confidential Workflows access | Private beta, by request. | Request it now and build without depending on it. |
| ERC-8004 registries on Monad testnet | Identity Registry `0x8004A818BFB912233c491871b3d84c89A494BD9e` and Reputation Registry `0x8004B663056A597Dffe9eCcC1965A193B7388713` are listed. No Validation Registry is listed, and the repo says that part of the spec is still being revised. | Use the two deployed registries. Deploy the Validation Registry yourself from erc-8004-contracts, behind an adapter. |
| ERC-8004 call rules | validationRequest can only be called by the agent's owner or operator. validationResponse can only be called by the validator named in the request. giveFeedback rejects the agent's owner and operators. getSummary needs a non-empty list of client addresses. | These shape the ERC-8004 mirror and the feedback anchor (see Contracts). |
| Semaphore on Monad | Semaphore V4 lists no Monad deployment. | Deploy SemaphoreVerifier, PoseidonT3 and Semaphore from @semaphore-protocol/contracts. |
| Monad testnet settings | Chain ID 10143, RPC https://testnet-rpc.monad.xyz. | Put both in .env.example. |

Still to do by hand:

- [ ] Request Confidential Workflows access through the Chainlink mentor.
- [ ] Confirm in `cre workflow simulate` that sealed-box decryption runs inside a workflow.
- [ ] Read the hackathon rules: eligibility, judging criteria, submission format.
- [ ] Read ACTA and the Confidential Agent Policy Verdicts draft, and message the ACTA author.
- [ ] Re-read ERC8004SPEC.md at the commit you install.

## Gate design decision

The two consumers need different checks, so build two modifiers. The registry then stores a latest-result pointer per agent and policy, alongside the per-request records.

| Modifier | Used by | Checks |
|---|---|---|
| `onlyAttested(agentId, policyId)` | SealedBidHiring.bid | Caller controls agentId in the Identity Registry, and the agent's latest result for that policy is a pass and unexpired |
| `onlyAttestedRequest(requestId, policyId)` | Treasury action | That specific validation passed, matches the policy, and is unexpired |

## Architecture

The system is four flows over one shared primitive: a salted commitment on-chain, the opening sent sealed to a CRE workflow, and a signed report written back through the CRE forwarder.

The demo uses two policies. QUALIFIED_SCREENER_V1 is an agent-level policy that an agent must hold to bid. SANCTIONS_SCREEN_V1 is a per-request policy that gates the treasury action.

### Flow A: private validation

1. The client picks a random 32-byte salt and computes `commitment = keccak256(abi.encode(agentId, policyId, keccak256(input), salt))`.
2. The client calls `requestPrivate(agentId, policyId, commitment)` and gets a requestId.
3. The client seals (input, salt) to W1's public key and uploads the ciphertext to the sealed store under requestId.
4. W1 triggers on the request event, fetches and decrypts the payload, and recomputes the commitment. On a mismatch it stops and writes no report.
5. W1 calls the screening API through Confidential HTTP and computes pass or fail.
6. W1 writes a report. The forwarder calls onReport on the registry, which re-checks the commitment and policy and stores the result.
7. Any contract gates on the result through VeilGate.

### Flow B: sealed-bid hiring

1. The client calls `postTask(policyId, category, deadline, identityCommitment)`.
2. An agent computes `bidCommitment = keccak256(abi.encode(taskId, agentId, price, salt))` and calls `bid(taskId, agentId, bidCommitment)`. The call reverts unless the agent holds the task's policy.
3. The agent seals (price, salt) to W3's public key and uploads it under `taskId:agentId`.
4. After the deadline anyone calls `closeBidding(taskId)`, which emits BiddingClosed.
5. W3 triggers on that event, reads the on-chain bids, fetches each sealed bid, and drops any that is missing or does not match its commitment.
6. W3 picks the lowest price (ties go to the earliest bid), builds a Merkle tree over the counted bids, and reports the winner, the winning price, the winner's salt, the valid-bid count and the root.
7. onReport checks that the winner's price and salt open the winner's on-chain commitment, then awards the job.
8. The winner does the work, which is validated through Flow A. The client then calls `markCompleted(taskId)`.

### Flow C: selective disclosure

1. The requester exports a bundle: `{chainId, registry, requestId, agentId, policyId, input, salt}`.
2. The auditor recomputes the commitment, reads the request from the registry, and compares commitment, policy, result, tier and expiry.
3. Nothing goes on-chain, and no other request is opened.

### Flow D: receipts and anonymous feedback

1. The client creates a Semaphore identity locally and passes its commitment in postTask.
2. W2 triggers on JobCompleted and reports the task. ReceiptGroupManager checks the task against SealedBidHiring and adds the commitment to the group for that category and epoch.
3. The client generates a proof with message = score and scope = `keccak256(abi.encode(agentId, epoch))`.
4. Anyone can relay `AnonymousFeedback.submit`. Semaphore rejects a reused nullifier, so a second rating for the same agent and epoch fails.
5. After the epoch ends, `anchor(agentId, epoch)` writes the average to the ERC-8004 Reputation Registry.

## Stack and repo layout

| Layer | Choice |
|---|---|
| Contracts | Solidity 0.8.26, Foundry, OpenZeppelin 5.x, ReceiverTemplate from Chainlink's CRE contracts, @semaphore-protocol/contracts V4 |
| Workflows | TypeScript, @chainlink/cre-sdk v1.19.0 or later, CRE CLI v1.30.0 or later, Bun |
| SDK and scripts | TypeScript, viem, @semaphore-protocol/core, @openzeppelin/merkle-tree, libsodium sealed boxes |
| Services | Two small HTTP servers: the sealed store and a mock screening API |
| Frontend | Next.js and viem, reading public chain data only |
| Chain | Monad testnet (chain ID 10143) and Anvil for local runs |

```
veil8004/
  contracts/
    src/
      interfaces/      IVeilValidation, IVeilGate, IVeilReceipts, IAssuranceTier, ERC-8004 adapters
      core/            PolicyRegistry, PrivateValidationRegistry, VeilGate
      consumers/       TreasuryAction, SealedBidHiring
      receipts/        ReceiptGroupManager, AnonymousFeedback, NullifierRegistry
      mocks/           MockForwarder
    test/              one file per contract, plus Leak.t.sol and an end-to-end test
    script/            Deploy.s.sol, RegisterAgents.s.sol
  cre/
    handlers/          validator.ts, bidOpener.ts, receiptIssuer.ts (pure functions)
    workflows/         w1-validator/, w3-bid-opener/, w2-receipt-issuer/ (CRE wiring)
    local-runner/      watches Anvil, runs handlers, calls MockForwarder
  services/
    sealed-store/
    mock-screening/
  sdk/                 commitments, seal, bids, merkle, disclosure, semaphore
  scripts/             client, bidder, auditor, demo, simulator
  frontend/            indexer split view, auction view, cost panel
  docs/                phase0.md, threat-model.md, extension-draft.md
  Makefile             build, test, demo, deploy-testnet
  .env.example
  README.md
```

## Contracts: core

Every contract that receives a CRE report extends ReceiverTemplate, takes the forwarder address in its constructor, and decodes the report in `_processReport`. Turn on the template's workflow-identity checks so each consumer accepts reports from its own workflow only. Use custom errors throughout.

### Shared types

```solidity
// IAssuranceTier: what the verifier is trusting
enum Tier { PublicReputation, Don, TeeDon, Zk }
enum Status { None, Pending, Passed, Failed }
```

### PolicyRegistry

```solidity
struct Policy {
    address owner;
    bytes32 descriptionHash;
    Tier tier;
    uint64 validityWindow;   // seconds a result stays valid
    uint256 validatorFee;    // recorded, not collected (payments are out of scope)
    bool active;
}

function createPolicy(bytes32 policyId, bytes32 descriptionHash, Tier tier,
                      uint64 validityWindow, uint256 validatorFee) external;
function setActive(bytes32 policyId, bool active) external;   // policy owner only
function getPolicy(bytes32 policyId) external view returns (Policy memory);
```

- policyId is unique and validityWindow is greater than zero.
- policyId is keccak256 of the policy name, for example `keccak256("SANCTIONS_SCREEN_V1")`.

### PrivateValidationRegistry

```solidity
struct Request {
    uint256 agentId;
    bytes32 policyId;
    bytes32 commitment;
    address requester;
    uint64 requestedAt;
    uint64 expiry;
    Tier tier;
    Status status;
}

function requestPrivate(uint256 agentId, bytes32 policyId, bytes32 commitment)
    external returns (bytes32 requestId);
function verifyResult(bytes32 requestId, bytes32 policyId) external view returns (bool);
function isAttested(uint256 agentId, bytes32 policyId) external view returns (bool);
function latestRequest(uint256 agentId, bytes32 policyId) external view returns (bytes32);
function getRequest(bytes32 requestId) external view returns (Request memory);
function mirrorToERC8004(bytes32 requestId) external;

event PrivateValidationRequested(bytes32 indexed requestId, uint256 indexed agentId,
                                 bytes32 indexed policyId, bytes32 commitment);
event PrivateValidationRecorded(bytes32 indexed requestId, uint256 indexed agentId,
                                bytes32 indexed policyId, bool passed, Tier tier, uint64 expiry);
```

requestPrivate:

- Reverts if the policy is inactive, the agent does not exist in the Identity Registry, the commitment is zero, or the commitment was used before.
- `requestId = keccak256(abi.encode(block.chainid, address(this), nonce++))`. Status becomes Pending.

W1 report payload: `abi.encode(bytes32 requestId, bytes32 commitment, bool passed, bytes32 policyId, uint8 tier, uint64 expiry)`.

`_processReport` reverts unless all of these hold:

- The request is Pending. This is also the replay guard.
- The reported commitment equals the stored commitment.
- The reported policy equals the stored policy.
- expiry is in the future and no later than `block.timestamp + validityWindow`.

It then stores status, tier and expiry, sets `latestRequest[agentId][policyId] = requestId`, and emits PrivateValidationRecorded. The reported tier is recorded and shown, not enforced.

Views:

- verifyResult is true when the request is Passed, the policy matches, and `block.timestamp < expiry`.
- isAttested is `verifyResult(latestRequest[agentId][policyId], policyId)`. A later failed result therefore revokes an earlier pass.

ERC-8004 mirror:

- mirrorToERC8004 calls `validationResponse(requestHash, response, "", bytes32(0), "veil8004-private")` on the Validation Registry through an adapter, with requestHash = requestId and response 100 for a pass or 0 for a fail.
- It only succeeds if the agent's owner first called validationRequest naming this registry as validator with the same requestHash. That is an ERC-8004 rule, so the demo script makes that call.
- Keep it a separate function, outside `_processReport`, so a missing standard request can never block a report.

### VeilGate

An abstract contract that consumers inherit. It holds immutable references to the validation registry and the ERC-8004 Identity Registry.

```solidity
modifier onlyAttested(uint256 agentId, bytes32 policyId) {
    if (!_controls(msg.sender, agentId)) revert NotAgentController();
    if (!veilRegistry.isAttested(agentId, policyId)) revert NotAttested();
    _;
}

modifier onlyAttestedRequest(bytes32 requestId, bytes32 policyId) {
    if (!veilRegistry.verifyResult(requestId, policyId)) revert NotAttested();
    _;
}
```

- `_controls` is true when the caller is `ownerOf(agentId)` or the agent's verified wallet (`getAgentWallet(agentId)`) in the Identity Registry.

### TreasuryAction (first consumer)

```solidity
function execute(bytes32 requestId) external onlyAttestedRequest(requestId, SANCTIONS_SCREEN_V1);
```

- Reverts unless the request's requester is the treasury operator. Without this, anyone's passing result for the same policy would unlock the action.
- Each requestId can be used once.
- The action itself is public: it emits ActionExecuted(requestId) and bumps a counter.

## Contracts: hiring, receipts and feedback

### SealedBidHiring (second consumer)

Inherits VeilGate and ReceiverTemplate.

```solidity
enum TaskStatus { None, Open, Closed, Awarded, NoAward, Completed }

function postTask(bytes32 policyId, bytes32 category, uint64 deadline,
                  uint256 identityCommitment) external returns (uint256 taskId);
function bid(uint256 taskId, uint256 agentId, bytes32 bidCommitment)
    external onlyAttested(agentId, tasks[taskId].policyId);
function closeBidding(uint256 taskId) external;
function markCompleted(uint256 taskId) external;
function verifyInclusion(uint256 taskId, uint256 agentId, bytes32[] calldata proof)
    external view returns (bool);

event TaskPosted(uint256 indexed taskId, address indexed client, bytes32 indexed policyId,
                 bytes32 category, uint64 deadline, uint256 identityCommitment);
event BidPlaced(uint256 indexed taskId, uint256 indexed agentId, bytes32 bidCommitment);
event BiddingClosed(uint256 indexed taskId, uint256 bidCount);
event JobAwarded(uint256 indexed taskId, uint256 indexed winnerAgentId, uint256 winningPrice,
                 uint32 validBidCount, bytes32 merkleRoot);
event JobCompleted(uint256 indexed taskId, uint256 indexed agentId, bytes32 category,
                   uint256 identityCommitment);
```

- postTask: the policy is active and the deadline is in the future.
- bid: the task is Open, the deadline has not passed, the agent has not bid on this task, and the commitment is non-zero. Bids are stored in order.
- closeBidding: callable by anyone once the deadline has passed. Status becomes Closed.
- markCompleted: client only, and only from Awarded. Emits JobCompleted.

W3 report payload: `abi.encode(uint256 taskId, uint256 winnerAgentId, uint256 winningPrice, bytes32 winnerSalt, uint32 validBidCount, bytes32 merkleRoot)`.

`_processReport`:

- Reverts unless the task is Closed and validBidCount is no more than the number of bids.
- If validBidCount is zero, the status becomes NoAward.
- Otherwise it reverts unless `keccak256(abi.encode(taskId, winnerAgentId, winningPrice, winnerSalt))` equals the winner's stored commitment. Revealing the winner's salt is harmless because the winning price is public.
- It stores the result, sets Awarded, and emits JobAwarded. An award is final.

Merkle tree: OpenZeppelin StandardMerkleTree over `[taskId, agentId, bidCommitment]` with types `["uint256", "uint256", "bytes32"]`, one leaf per counted bid. verifyInclusion rebuilds the leaf from the stored commitment and checks it with MerkleProof.verify.

### ReceiptGroupManager

Inherits ReceiverTemplate. It is the admin of every Semaphore group it creates.

- epochLength is a constructor parameter (one hour in the demo). `epoch = block.timestamp / epochLength`.
- `groupId(category, epoch)` returns the Semaphore group, created on first use with `semaphore.createGroup()`.
- W2 report payload: `abi.encode(uint256 taskId)`.
- `_processReport` reads the task from SealedBidHiring and reverts unless it is Completed and has no receipt yet. It then adds the task's identity commitment to the group for the task's category and the current epoch, and records `agentInGroup[category][epoch][winnerAgentId] = true`.

### AnonymousFeedback

```solidity
function submit(uint256 agentId, bytes32 category, uint64 epoch,
                ISemaphore.SemaphoreProof calldata proof) external;
function anchor(uint256 agentId, uint64 epoch) external;
function aggregate(uint256 agentId, uint64 epoch) external view returns (uint256 sum, uint256 count);
```

submit reverts unless all of these hold:

- `agentInGroup[category][epoch][agentId]` is true, so only agents with a completed job in that group can be rated.
- proof.message is a score from 1 to 5.
- `proof.scope == uint256(keccak256(abi.encode(agentId, epoch)))`.
- The aggregate for this agent and epoch is not yet anchored.
- `semaphore.validateProof(groupId(category, epoch), proof)` succeeds. Semaphore itself rejects a reused nullifier.
- `NullifierRegistry.consume(context, proof.nullifier)` succeeds, with `context = keccak256(abi.encode("feedback", agentId, epoch))`.

It then adds the score to the aggregate. Individual scores are public; the rater is not.

anchor is callable by anyone after the epoch ends, once per agent and epoch, when at least one rating exists. It calls `giveFeedback(agentId, int128(sum * 100 / count), 2, "veil8004", "anon-aggregate", "", "", bytes32(0))` on the Reputation Registry. Readers fetch it with getSummary, passing this contract as the client address.

### NullifierRegistry

- `consume(bytes32 context, uint256 nullifier)` reverts if the pair was used. Only authorised consumer contracts can call it.
- `isUsed(bytes32 context, uint256 nullifier)` is a view.

### Interfaces and mocks

- interfaces/ holds IVeilValidation, IVeilGate, IVeilReceipts and IAssuranceTier. These are the spec contribution, so give them full NatSpec.
- ERC-8004 calls go through thin adapter interfaces copied from the installed erc-8004-contracts ABIs.
- MockForwarder calls `onReport(metadata, report)` on a consumer, for tests and the local runner.

## CRE workflows and services

Three workflows, each an EVM Log trigger, a pure handler, and one report written to one consumer.

| Workflow | Trigger event | Handler steps | Consumer |
|---|---|---|---|
| W1 Validator | PrivateValidationRequested | Fetch and decrypt the payload; recompute the commitment and stop on mismatch; call the screening API through Confidential HTTP; encode the report with the tier it ran at | PrivateValidationRegistry |
| W3 Bid opener | BiddingClosed | Read the task's bids from chain; fetch and decrypt each sealed bid; drop missing or mismatched bids; pick the lowest price, ties to the earliest bid; build the Merkle tree; encode the report | SealedBidHiring |
| W2 Receipt issuer | JobCompleted | Read the task from chain and confirm it is Completed; encode the report | ReceiptGroupManager |

- Tier reporting: W1 reports TeeDon only when it runs as a Confidential Workflow. In a standard workflow it reports Don (DON consensus, no enclave), and the README says input hiding from node operators is designed, not demoed.
- Secrets: W1_DECRYPT_KEY, W3_DECRYPT_KEY and SCREENING_API_KEY are CRE secrets. The screening key is injected by Confidential HTTP template and never appears in handler code.
- Evidence for the bounty: keep a `cre workflow simulate` log for each workflow in docs/, plus the on-chain report transaction for each.

### Local runner

cre/local-runner subscribes to the same three events on Anvil, runs the same handlers with keys from .env, and delivers each report through MockForwarder. It exists so the demo and the end-to-end tests run without a CRE account. Label it as a simulation of the DON.

### Sealed store

A small HTTP service that holds ciphertext only.

- `PUT /v1/payload/:key` stores a base64 sealed box of at most 4 KB. Keys are write-once. The key is requestId for validations and `taskId:agentId` for bids.
- `GET /v1/payload/:key` requires the workflow's bearer token.
- Payloads are libsodium sealed boxes to the workflow's public key. The plaintext is JSON: `{input, salt}` for W1 and `{price, salt}` for W3.
- A bidder who never uploads is simply dropped, so nobody can stall an auction.

### Mock screening API

`POST /screen` takes `{subject}` and returns `{hit: boolean}` from a fixed list, behind an API key. A real provider can replace it behind the same handler interface.

## Off-chain tooling and frontend

### SDK modules

| Module | Exports |
|---|---|
| commitments | randomSalt, inputCommitment, bidCommitment, matching the Solidity encodings byte for byte |
| seal | sealFor(publicKey, json), open(secretKey, ciphertext), sealed-store client |
| bids | Build a bid, submit the commitment, upload the sealed bid |
| merkle | Build the counted-bids tree, produce and verify an inclusion proof |
| disclosure | Export a bundle for one requestId, verify a bundle against the registry |
| semaphore | Create an identity, fetch group members from events, generate a feedback proof |

Add a cross-language test that computes each commitment in TypeScript and in Solidity and compares them.

### Scripts

- client: request a validation, post a task, mark it completed, submit a rating.
- bidder: place a bid, and after the award check Merkle inclusion.
- auditor: verify one disclosure bundle and print what was learned.
- demo: run the demo script below from a clean Anvil.
- simulator: N simulated clients across M agents to fill the anonymity set. Everything it creates is tagged as simulated.

### Demo script (`make demo`, about 3 minutes)

1. Public baseline: one plain ERC-8004 interaction, shown in the indexer view.
2. Sealed auction: a task is posted, an unattested agent is rejected, three attested agents bid, and W3 awards the lowest.
3. Private validation: the winner's screen is recorded as passed, the treasury action executes, then fails on an expired result and on a tampered input.
4. Audit: the auditor opens one validation and the others stay sealed.
5. Feedback: the client rates the winner, and a second attempt is rejected.
6. Side by side: the indexer view before and after, then the claims table.

### Frontend

- Indexer split view: the same interaction under plain ERC-8004 and under Veil8004, built only from public events and storage. This is the key demo asset.
- Auction view: a task, its bids as commitments, then the award and an inclusion check.
- Cost panel: measured gas per attestation, bid, award and rating, read from transaction receipts.
- Show a simulated-data banner whenever simulator output is on screen, and include the claims table as a page.

## Phases

### Phase 1: Public baseline

- Build: the ERC-8004 registries (the deployed Identity and Reputation registries on testnet plus your own Validation Registry; all three deployed fresh on Anvil), 2 to 3 agents registered, a plain public flow of request, validation, and feedback. Add the first frontend page: the "what an indexer sees" view.
- Exit: the view shows the leaked graph (client, agent, score, validation).

### Phase 2: Private validation and gate

- Build: PolicyRegistry, PrivateValidationRegistry, W1 with the commitment check, VeilGate, the treasury consumer, the sealed store, the mock screening API, the mock forwarder and the local workflow runner. Add the "after" side of the split view.
- Tests: valid pass; missing, expired, wrong-policy, and mismatched-commitment results all revert; replayed report and non-forwarder caller rejected.
- Exit: the gate passes and fails as above, and the chain shows only commitment, policy, and result.

### Phase 3: Sealed-bid hiring

- Build: SealedBidHiring, W3, the bidder script, the auction view.
- Tests: unattested agent cannot bid; deadline enforced; duplicate bid rejected; mismatched bid dropped; lowest valid bid wins; award is final.
- Exit: three attested agents bid, W3 awards the lowest, a loser verifies Merkle inclusion, and no losing price appears on-chain.
- Fallback: if this overruns, use the agent allowlist as the second consumer.

### Phase 4: Selective disclosure

- Build: SDK bundle export and the auditor script.
- Exit: an auditor verifies one validation and learns nothing about any other.

### Phase 5: Receipts and anonymous feedback

- Build: W2, ReceiptGroupManager, AnonymousFeedback, NullifierRegistry, client proof tooling, and your own Semaphore V4 deployment.
- Exit: a rating is accepted, a second one in the same epoch is rejected, no receipt is issued without a completed awarded job, and the aggregate is readable through the Reputation Registry.

### Phase 6: Demo and documents

- Build: population simulator (labeled as simulated), cost panel, final threat model, extension draft.
- Exit: someone outside the team can follow the demo script cold.

### Phase 7: Submission

Fresh-clone test, video, write-up, repo cleanup, and the playbook's section 11 checklist.

## If time runs short

Drop in this order:

1. Feedback UI (keep the contract and a script).
2. Simulator polish.
3. Pooled groups.
4. Merkle inclusion proofs.
5. The auction (use the allowlist instead).
6. All of Phase 5.

Never cut the baseline, private validation with the commitment check, the gate with two consumers, selective disclosure, the split view, or the threat model.

## Claims and limits

Keep this table in docs/threat-model.md and the README. Do not claim anything it does not list.

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

## Fallbacks

| Risk | Fallback |
|---|---|
| No Confidential Workflows access | Standard workflow plus Confidential HTTP. Claim credential hiding, and mark input hiding as designed, not demoed. |
| Monad testnet not enabled for your CRE account | Demo with `cre workflow simulate` and the local runner, and ask the mentor to enable it. |
| Sealed-box decryption does not run inside a workflow | Swap libsodium for a pure-JavaScript X25519 and XSalsa20-Poly1305 library behind the same seal interface. |
| Validation Registry spec changes | Only the adapter and mirrorToERC8004 change. |
| Semaphore deployment fails | A minimal membership-proof contract, or an allowlist with nullifiers, labeled as a stand-in. |
| Anonymity set too small | Pooled groups, the simulator, and honest disclosure. |
| Too few bidders | Simulated bidding agents, labeled. |
| Auction build overruns | The agent allowlist becomes the second consumer. |
| Another team builds ZK reputation | Lead with the gate, the auction and disclosure. |
| Overlap with ACTA or the Policy Verdicts draft | Position as interop and credit PSE. |

## Sources

Pages opened on 8 October 2026:

- CRE supported networks: Monad Testnet support and minimum versions.
- CRE: building consumer contracts: IReceiver, ReceiverTemplate, the forwarder.
- CRE privacy and Confidential HTTP: what each feature keeps confidential.
- erc-8004-contracts: Monad testnet addresses, call rules, the Validation Registry warning.
- Semaphore V4 deployed contracts: networks with an existing deployment.
- Monad docs: testnet setup: chain ID and RPC URL.
