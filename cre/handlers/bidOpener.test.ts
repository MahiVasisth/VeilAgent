import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { bidCommitment, randomSalt } from "@veil8004/sdk/commitments";
import { buildBid } from "@veil8004/sdk/bids";
import { buildBidTree, verifyBidInclusion, ZERO_ROOT } from "@veil8004/sdk/merkle";
import { generateKeyPair, sealFor } from "@veil8004/sdk/seal";
import { sealedBidHiringAbi } from "@veil8004/sdk/abi/veil";
import {
  decideAward,
  decodeBiddingClosed,
  decodeBidOpenerReport,
  openBid,
  pickWinner,
  runBidOpener,
  type BidOpenerDeps,
  type OnChainBid,
} from "./bidOpener";

const W3 = generateKeyPair();
const TASK = 4n;

/** Bids at these prices by agents 10, 11, 12, ... in order, each sealed correctly. */
function auction(prices: bigint[]) {
  const built = prices.map((price, i) => buildBid({ taskId: TASK, agentId: 10n + BigInt(i), price, w3PublicKey: W3.publicKey }));
  const store = new Map(built.map((b) => [b.storeKey, b.sealed]));
  const onChain: OnChainBid[] = built.map((b) => ({ agentId: b.agentId, commitment: b.commitment }));
  return { built, store, onChain };
}

const deps = (onChain: OnChainBid[], store: Map<string, string>): BidOpenerDeps => ({
  readBids: async () => onChain,
  fetchSealedBid: async (key) => store.get(key) ?? null,
  decryptKey: W3.secretKey,
});
const closed = (bidCount: number) => ({ taskId: TASK, bidCount: BigInt(bidCount) });

describe("W3 bid opener handler", () => {
  test("decodes the trigger log", () => {
    const topics = encodeEventTopics({ abi: sealedBidHiringAbi, eventName: "BiddingClosed", args: { taskId: TASK } }) as Hex[];
    const data = encodeAbiParameters([{ type: "uint256" }], [3n]);
    expect(decodeBiddingClosed({ topics, data })).toEqual({ taskId: TASK, bidCount: 3n });
  });

  test("lowest valid bid wins; report opens the winner's commitment; root covers every counted bid", async () => {
    const { built, store, onChain } = auction([500n, 300n, 400n]);
    const out = await runBidOpener(closed(3), deps(onChain, store));
    const r = decodeBidOpenerReport(out.report);
    expect(r).toEqual(out.decoded);
    expect(r.winnerAgentId).toBe(11n);
    expect(r.winningPrice).toBe(300n);
    expect(r.validBidCount).toBe(3);
    expect(bidCommitment({ taskId: TASK, agentId: r.winnerAgentId, price: r.winningPrice, salt: r.winnerSalt })).toBe(built[1]!.commitment);
    const tree = buildBidTree(TASK, onChain);
    expect(r.merkleRoot).toBe(tree.root as Hex);
    for (const b of onChain) expect(verifyBidInclusion(r.merkleRoot, TASK, b, tree.getProof([TASK, b.agentId, b.commitment]) as Hex[])).toBe(true);
  });

  test("ties go to the earliest bid", () => {
    const { store, onChain } = auction([700n, 200n, 200n, 200n]);
    const keys = [...store.values()];
    const out = decideAward(TASK, onChain.map((b, i) => openBid(TASK, b, i, keys[i]!, W3.secretKey) as never));
    expect(out.decoded.winnerAgentId).toBe(11n);
  });

  test("mismatched bid is dropped, even when it would have been lowest", async () => {
    const { built, store, onChain } = auction([500n, 300n, 400n]);
    // Agent 11 committed to 300 but seals an opening of 100 with its real salt.
    store.set(built[1]!.storeKey, sealFor(W3.publicKey, { price: "100", salt: built[1]!.salt }));
    const out = await runBidOpener(closed(3), deps(onChain, store));
    expect(out.dropped.map((d) => [d.agentId, d.reason])).toEqual([[11n, "commitment mismatch"]]);
    expect(out.decoded.winnerAgentId).toBe(12n);
    expect(out.decoded.winningPrice).toBe(400n);
    expect(out.decoded.validBidCount).toBe(2);
    expect(out.decoded.merkleRoot).toBe(buildBidTree(TASK, [onChain[0]!, onChain[2]!]).root as Hex);
  });

  test("missing, foreign-key, malformed and wrong-salt openings are dropped", async () => {
    const { built, store, onChain } = auction([100n, 200n, 300n, 400n, 500n]);
    store.delete(built[0]!.storeKey); // never uploaded
    store.set(built[1]!.storeKey, sealFor(generateKeyPair().publicKey, { price: "200", salt: built[1]!.salt })); // wrong key
    store.set(built[2]!.storeKey, sealFor(W3.publicKey, { price: 300, salt: built[2]!.salt })); // price not a string
    store.set(built[3]!.storeKey, sealFor(W3.publicKey, { price: "400", salt: randomSalt() })); // right price, wrong salt
    const out = await runBidOpener(closed(5), deps(onChain, store));
    expect(out.dropped.map((d) => d.reason)).toEqual([
      "no sealed bid",
      "does not open with the W3 key",
      "malformed opening: expected {price: decimal string, salt: bytes32}",
      "commitment mismatch",
    ]);
    expect(out.decoded).toMatchObject({ winnerAgentId: 14n, winningPrice: 500n, validBidCount: 1 });
  });

  test("no valid bid -> NoAward report (all zero)", async () => {
    const { store, onChain } = auction([100n, 200n]);
    store.clear();
    const out = await runBidOpener(closed(2), deps(onChain, store));
    expect(out.decoded).toEqual({ taskId: TASK, winnerAgentId: 0n, winningPrice: 0n, winnerSalt: ZERO_ROOT, validBidCount: 0, merkleRoot: ZERO_ROOT });
    expect((await runBidOpener(closed(0), deps([], store))).decoded.validBidCount).toBe(0);
  });

  test("full uint256 price range; out-of-range price dropped", () => {
    const max = (1n << 256n) - 1n;
    const bid = buildBid({ taskId: TASK, agentId: 1n, price: max, w3PublicKey: W3.publicKey });
    expect(openBid(TASK, bid, 0, bid.sealed, W3.secretKey)).toMatchObject({ price: max });
    const salt = randomSalt();
    const over = sealFor(W3.publicKey, { price: (max + 1n).toString(), salt });
    expect(openBid(TASK, { agentId: 1n, commitment: bid.commitment }, 0, over, W3.secretKey)).toMatchObject({ reason: "price exceeds uint256" });
  });

  test("refuses to decide when the chain and the event disagree on the bid count", async () => {
    const { store, onChain } = auction([100n, 200n]);
    await expect(runBidOpener(closed(3), deps(onChain, store))).rejects.toThrow();
  });

  test("pickWinner of nothing is null", () => expect(pickWinner([])).toBeNull());
});
