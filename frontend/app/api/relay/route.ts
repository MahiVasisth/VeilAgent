import { BaseError, ContractFunctionRevertedError, createWalletClient, http, type Abi, type Hex } from "viem";
import { anvil } from "viem/chains";
import { anonymousFeedbackAbi, nullifierRegistryAbi, receiptGroupManagerAbi, semaphoreAbi } from "@veil8004/sdk";
import { deployment, publicClient } from "../../../lib/chain";
import { BROWSER_RPC_URL, relayerAccount } from "../../../lib/server";

// Relayer for anonymous ratings: sends AnonymousFeedback.submit from its own key, so the rating transaction is not
// signed by the rater's wallet (claims table: "Linking through the rating transaction: mitigated by a relayer"). It
// relays this one call only. Everything it receives (agent, category, epoch, proof) goes on-chain anyway.
const errorsAbi = [...anonymousFeedbackAbi, ...semaphoreAbi, ...nullifierRegistryAbi, ...receiptGroupManagerAbi] as Abi;

type Body = {
  agentId: string;
  category: Hex;
  epoch: string;
  proof: { merkleTreeDepth: string; merkleTreeRoot: string; nullifier: string; message: string; scope: string; points: string[] };
};

export async function POST(req: Request) {
  const d = deployment();
  const feedback = d.veil?.anonymousFeedback;
  const account = relayerAccount(d.chainId);
  if (!feedback || !account) return Response.json({ error: "no relayer on this chain" }, { status: 503 });
  let b: Body;
  try {
    b = (await req.json()) as Body;
    if (!/^0x[0-9a-fA-F]{64}$/.test(b.category) || b.proof.points.length !== 8) throw new Error("bad body");
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const proof = {
    merkleTreeDepth: BigInt(b.proof.merkleTreeDepth),
    merkleTreeRoot: BigInt(b.proof.merkleTreeRoot),
    nullifier: BigInt(b.proof.nullifier),
    message: BigInt(b.proof.message),
    scope: BigInt(b.proof.scope),
    points: b.proof.points.map(BigInt) as unknown as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint],
  };
  const call = { address: feedback, abi: errorsAbi, functionName: "submit", args: [BigInt(b.agentId), b.category, BigInt(b.epoch), proof] } as const;
  try {
    const { request } = await publicClient.simulateContract({ ...call, account } as never);
    const wallet = createWalletClient({ account, chain: { ...anvil, id: d.chainId }, transport: http(process.env.ANVIL_RPC_URL ?? BROWSER_RPC_URL) });
    const hash = await wallet.writeContract(request as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") return Response.json({ error: "reverted", hash }, { status: 409 });
    return Response.json({ hash, relayer: account.address });
  } catch (e) {
    const revert = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    const name = revert instanceof ContractFunctionRevertedError ? (revert.data?.errorName ?? revert.reason) : null;
    return Response.json({ error: name ?? (e instanceof BaseError ? e.shortMessage : String(e)) }, { status: 409 });
  }
}
