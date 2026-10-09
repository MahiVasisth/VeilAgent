// Phase 1 public baseline: the plain ERC-8004 flow, with everything on-chain in the clear.
// For each interaction: the client pays the agent, the agent's owner asks a public validator to screen the client's
// counterparty, the validator answers, and the client rates the agent with a feedback file that links the payment.
// Entity names and the "sanctions list" below are fictional demo data.
// Prereq: Anvil running, Deploy.s.sol and RegisterAgents.s.sol broadcast. Run: bun scripts/src/baseline.ts
import { keccak256, parseEther, toBytes, type Account, type Hash } from "viem";
import { identityRegistryAbi, jsonDataUri, reputationRegistryAbi, validationRegistryAbi } from "@veil8004/sdk";
import { CHAIN, local, publicClient, roles, walletFor } from "./env";

const POLICY = "SANCTIONS_SCREEN_V1";
const CATEGORY = "compliance-screening";
const DEMO_SANCTIONS_LIST = new Set(["Kestrel Shipping Co"]); // fictional

type Interaction = { client: Account; agentIndex: number; priceEth: string; subject: string; score: number };
const interactions: Interaction[] = [
  { client: roles.clients[0]!, agentIndex: 0, priceEth: "0.05", subject: "Northwind Trading LLC", score: 90 },
  { client: roles.clients[1]!, agentIndex: 1, priceEth: "0.08", subject: "Kestrel Shipping Co", score: 60 },
];

const { deployment: d, agents } = local();
const caip10 = (address: string) => `eip155:${CHAIN.id}:${address}`;

async function send(label: string, hash: Hash) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`  ${label.padEnd(20)} ${hash}`);
  return hash;
}

for (const it of interactions) {
  const agentId = BigInt(agents.agentIds[it.agentIndex]!);
  const owner = roles.agentOwners[it.agentIndex]!;
  if (owner.address.toLowerCase() !== agents.owners[it.agentIndex]!.toLowerCase())
    throw new Error(`agent ${agentId}: owner in deployments file does not match the demo account`);
  const client = walletFor(it.client);
  console.log(`\nclient ${it.client.address} hires agent ${agentId} for ${it.priceEth} ETH`);

  // 1. Payment, as a plain transfer to the agent's verified wallet.
  const agentWallet = await publicClient.readContract({
    address: d.identityRegistry,
    abi: identityRegistryAbi,
    functionName: "getAgentWallet",
    args: [agentId],
  });
  const paymentTx = await send("payment", await client.sendTransaction({ to: agentWallet, value: parseEther(it.priceEth) }));

  // 2. Validation request: ERC-8004 lets only the agent's owner or operator call it. The request file carries
  //    the input the validator needs, so the input is public.
  const request = jsonDataUri({
    policy: POLICY,
    agentId: Number(agentId),
    client: caip10(it.client.address),
    input: { subject: it.subject },
    createdAt: new Date().toISOString(),
  });
  const requestHash = keccak256(toBytes(request.payload));
  await send(
    "validationRequest",
    await walletFor(owner).writeContract({
      address: d.validationRegistry,
      abi: validationRegistryAbi,
      functionName: "validationRequest",
      args: [roles.publicValidator.address, agentId, request.uri, requestHash],
    }),
  );

  // 3. The named validator screens the subject and answers publicly (100 = pass, 0 = fail).
  const hit = DEMO_SANCTIONS_LIST.has(it.subject);
  const response = jsonDataUri({ requestHash, result: hit ? "fail" : "pass", hits: hit ? [it.subject] : [] });
  await send(
    "validationResponse",
    await walletFor(roles.publicValidator).writeContract({
      address: d.validationRegistry,
      abi: validationRegistryAbi,
      functionName: "validationResponse",
      args: [requestHash, hit ? 0 : 100, response.uri, keccak256(toBytes(response.payload)), POLICY],
    }),
  );

  // 4. Feedback from the client's own wallet, with the ERC-8004 feedback file and its proofOfPayment.
  const feedback = jsonDataUri({
    agentRegistry: caip10(d.identityRegistry),
    agentId: Number(agentId),
    clientAddress: caip10(it.client.address),
    createdAt: new Date().toISOString(),
    value: it.score,
    valueDecimals: 0,
    tag1: "starred",
    tag2: CATEGORY,
    proofOfPayment: { fromAddress: it.client.address, toAddress: agentWallet, chainId: String(CHAIN.id), txHash: paymentTx },
  });
  await send(
    "giveFeedback",
    await client.writeContract({
      address: d.reputationRegistry,
      abi: reputationRegistryAbi,
      functionName: "giveFeedback",
      args: [agentId, BigInt(it.score), 0, "starred", CATEGORY, "", feedback.uri, keccak256(toBytes(feedback.payload))],
    }),
  );
}
console.log("\nbaseline flow done");
