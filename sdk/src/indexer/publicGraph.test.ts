import { describe, expect, test } from "bun:test";
import type { Address, Hash } from "viem";
import { jsonDataUri } from "../dataUri";
import { buildPublicGraph, type RawPublicData } from "./publicGraph";

const owner = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const client = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" as Address;
const validator = "0x976EA74026E726554dB657fA54763abd0C3a0aa9" as Address;
const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hash;

function fixture(): RawPublicData {
  return {
    registered: [{ agentId: 0n, owner, agentURI: "" }],
    uriUpdates: [{ agentId: 0n, newURI: jsonDataUri({ name: "Atlas" }).uri }],
    validationRequests: [
      {
        validator,
        agentId: 0n,
        requestURI: jsonDataUri({ policy: "SANCTIONS_SCREEN_V1", input: { subject: "Northwind Trading LLC" } }).uri,
        requestHash: h(1),
        requester: owner,
        txHash: h(10),
      },
    ],
    validationResponses: [
      // Two responses: ERC-8004 allows progressive updates; the latest one wins.
      { validator, agentId: 0n, requestHash: h(1), response: 50, responseURI: "", tag: "SANCTIONS_SCREEN_V1", txHash: h(11) },
      { validator, agentId: 0n, requestHash: h(1), response: 100, responseURI: "", tag: "SANCTIONS_SCREEN_V1", txHash: h(12) },
    ],
    feedback: [
      {
        agentId: 0n,
        client,
        feedbackIndex: 1n,
        value: 9050n,
        valueDecimals: 2,
        tag1: "starred",
        tag2: "compliance-screening",
        endpoint: "",
        feedbackURI: jsonDataUri({ proofOfPayment: { txHash: h(20) } }).uri,
        txHash: h(13),
      },
    ],
    payments: { [h(20)]: { from: client, to: owner, value: 50_000_000_000_000_000n } },
  };
}

describe("buildPublicGraph", () => {
  test("recovers client, agent, payment, score and validation input from public data", () => {
    const g = buildPublicGraph(fixture());

    expect(g.agents).toEqual([{ agentId: 0n, owner, name: "Atlas" }]);

    expect(g.validations).toHaveLength(1);
    expect(g.validations[0]!.request).toEqual({ policy: "SANCTIONS_SCREEN_V1", input: { subject: "Northwind Trading LLC" } });
    expect(g.validations[0]!.response).toBe(100);
    expect(g.validations[0]!.requester).toBe(owner);

    expect(g.feedback[0]).toMatchObject({ client, agentName: "Atlas", score: "90.5" });
    expect(g.feedback[0]!.payment?.amountEth).toBe("0.05");

    expect(g.nodes.map((n) => n.kind).sort()).toEqual(["agent", "client", "validator"]);
    expect(g.edges.map((e) => e.kind).sort()).toEqual(["feedback", "payment", "validation"]);
    expect(g.edges.find((e) => e.kind === "validation")!.label).toBe("SANCTIONS_SCREEN_V1: pass");
    expect(g.leaks.join("\n")).toContain("Northwind Trading LLC");
  });

  test("keeps unresolved items visible instead of dropping them", () => {
    const raw = fixture();
    raw.validationResponses = [];
    raw.payments = {};
    raw.uriUpdates = [];
    const g = buildPublicGraph(raw);
    expect(g.agents[0]!.name).toBe("agent #0");
    expect(g.validations[0]!.response).toBeNull();
    expect(g.edges.find((e) => e.kind === "validation")!.label).toBe("validation: pending");
    expect(g.feedback[0]!.payment).toBeNull();
    expect(g.edges.some((e) => e.kind === "payment")).toBe(false);
  });

  test("formats negative and fractional scores", () => {
    const raw = fixture();
    raw.feedback[0]!.value = -32n;
    raw.feedback[0]!.valueDecimals = 1;
    expect(buildPublicGraph(raw).feedback[0]!.score).toBe("-3.2");
    raw.feedback[0]!.value = 5n;
    raw.feedback[0]!.valueDecimals = 2;
    expect(buildPublicGraph(raw).feedback[0]!.score).toBe("0.05");
  });
});
