// Live check of our Semaphore V4 deployment (Phase 5, docs/phase0.md Q7 and S-4): a group is created, two fresh
// identities join, one proves membership with the SDK (pinned local artifacts, no network), and the deployed contract
// accepts the proof once and rejects the replay. Needs a deployment file with `veil.semaphore` and the artifacts
// (bun scripts/src/fetch-artifacts.ts).
//
//   bun scripts/src/semaphore-check.ts
import { parseEventLogs, type Abi } from "viem";
import { semaphoreAbi } from "@veil8004/sdk";
import { feedbackScope, Group, Identity, proveMembership, toSolidityProof } from "@veil8004/sdk/semaphore";
import { check, expectRevert, finish, send } from "./checks";
import { local, publicClient, roles } from "./env";

const semaphore = local().deployment.veil?.semaphore;
if (!semaphore) throw new Error("no Semaphore in the deployment file; re-run Deploy.s.sol");
const call = (functionName: string, args: readonly unknown[]) => ({ address: semaphore, abi: semaphoreAbi as Abi, functionName, args });
const admin = roles.deployer;

check((await publicClient.getCode({ address: semaphore }))?.length! > 2, `Semaphore has code at ${semaphore} (PoseidonT3 linked)`);

const created = await send(admin, call("createGroup", [admin.address, 7200n]));
const [event] = parseEventLogs({ abi: semaphoreAbi, eventName: "GroupCreated", logs: created.logs });
const groupId = event!.args.groupId;
const members = [new Identity(), new Identity()];
await send(admin, call("addMembers", [groupId, members.map((m) => m.commitment)]));
const group = new Group(members.map((m) => m.commitment));
const onChainRoot = await publicClient.readContract({ address: semaphore, abi: semaphoreAbi, functionName: "getMerkleTreeRoot", args: [groupId] });
check(onChainRoot === group.root, "on-chain LeanIMT root equals the SDK group's root (PoseidonT3 works)");

const started = Date.now();
const proof = toSolidityProof(await proveMembership(members[1]!, group, 4n, feedbackScope(1n, 1n)));
check(true, `SDK proved membership offline in ${Date.now() - started} ms (depth ${proof.merkleTreeDepth})`);
check(
  await publicClient.readContract({ address: semaphore, abi: semaphoreAbi, functionName: "verifyProof", args: [groupId, proof] }),
  "verifyProof accepts it",
);
await send(roles.stranger, call("validateProof", [groupId, proof]));
check(true, "validateProof from an unrelated account (a relayer) succeeds");
await expectRevert("the same proof again", roles.stranger.address, call("validateProof", [groupId, proof]), "Semaphore__YouAreUsingTheSameNullifierTwice");

finish("SEMAPHORE", "our Semaphore V4 deployment accepts an SDK proof once and rejects its replay.");
process.exit(0); // snarkjs may leave handles open
