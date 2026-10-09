import { describe, expect, test } from "bun:test";
import { keccak256, stringToBytes, type Address, type Hex } from "viem";
import { policyId } from "../commitments";
import { buildAuctionView, type RawAuctionData } from "./auctionView";

const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

const raw: RawAuctionData = {
  tasks: [
    { taskId: 1n, client: A(1), policyId: policyId("QUALIFIED_SCREENER_V1"), category: keccak256(stringToBytes("sanctions-screening")), deadline: 100n, identityCommitment: 0n, txHash: H(1) },
    { taskId: 2n, client: A(1), policyId: H(9), category: H(8), deadline: 100n, identityCommitment: 0n, txHash: H(2) },
  ],
  bids: [
    { taskId: 1n, agentId: 3n, commitment: H(31), bidder: A(3), txHash: H(3) },
    { taskId: 1n, agentId: 4n, commitment: H(41), bidder: A(4), txHash: H(4) },
    { taskId: 1n, agentId: 5n, commitment: H(51), bidder: A(5), txHash: H(5) },
    { taskId: 2n, agentId: 3n, commitment: H(32), bidder: A(3), txHash: H(6) },
  ],
  closed: [{ taskId: 1n, bidCount: 3n, closer: A(9) }],
  awards: [{ taskId: 1n, winnerAgentId: 4n, winningPrice: 3100n, validBidCount: 2, merkleRoot: H(77), txHash: H(7) }],
  noAwards: [],
  completed: [],
  inclusion: { "1:3": true, "1:4": true, "1:5": false },
  now: 200n,
};

describe("auction view", () => {
  const view = buildAuctionView(raw, new Map([[3n, "Atlas"], [4n, "Borealis"]]));

  test("tasks, statuses, names and award", () => {
    const [t1, t2] = view.tasks;
    expect(t1!.status).toBe("awarded");
    expect(t1!.policyName).toBe("QUALIFIED_SCREENER_V1");
    expect(t1!.categoryName).toBe("sanctions-screening");
    expect(t1!.award).toMatchObject({ winnerName: "Borealis", winningPrice: 3100n, validBidCount: 2 });
    expect(t1!.bids.map((b) => [b.agentName, b.inclusion, b.winner])).toEqual([
      ["Atlas", "counted", false],
      ["Borealis", "counted", true],
      ["agent #5", "not counted", false],
    ]);
    expect(t2!.status).toBe("open");
    expect(t2!.policyName).toBeNull();
    expect(t2!.bids[0]!.inclusion).toBe("unknown");
  });

  test("leaks: who bid and the award, never a losing price", () => {
    expect(view.leaks).toContain("task 1: awarded to Borealis at 3100; 2 of 3 bids counted");
    expect(view.leaks.filter((l) => l.includes(" bid from "))).toHaveLength(4);
    expect(view.hidden[0]).toContain("losing bid price");
  });
});
