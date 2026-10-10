"use client";
// State for the app: config, the public client, the connected signer, the chain data the sections render (rebuilt
// from public events with the same SDK views as the indexer pages), and this browser's vault.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PublicClient } from "viem";
import {
  buildAuctionView,
  buildFeedbackView,
  buildPublicGraph,
  buildVeilView,
  fetchAuctionData,
  fetchFeedbackData,
  fetchPublicData,
  fetchVeilData,
  type AuctionView,
  type Deployment,
  type FeedbackView,
  type PublicGraph,
  type RawFeedbackData,
  type VeilView,
} from "@veil8004/sdk";
import { loadConfig, makePublicClient, type AppConfig, type Signer } from "../../lib/app/runtime";
import { readVault, type Vault } from "../../lib/app/vault";

export type ChainData = {
  now: bigint;
  graph: PublicGraph;
  veil: VeilView | null;
  auction: AuctionView | null;
  feedbackRaw: RawFeedbackData | null;
  feedback: FeedbackView | null;
  balance: bigint | null;
};

export type Veil = {
  config: AppConfig;
  d: Deployment;
  client: PublicClient;
  signer: Signer | null;
  setSigner: (s: Signer | null) => void;
  data: ChainData | null;
  refresh: () => Promise<void>;
  /** Vault scope: chain id + genesis hash. */
  scope: string;
  vault: Vault;
  reloadVault: () => void;
};

export function useVeil(): { veil: Veil | null; error: string | null } {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [data, setData] = useState<ChainData | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  const [vault, setVault] = useState<Vault>({ openings: [], bids: [], identities: [] });
  const client = useMemo(() => (config ? makePublicClient(config) : null), [config]);
  const busy = useRef(false);

  useEffect(() => {
    loadConfig().then(setConfig, (e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!client || !config) return;
    client
      .getBlock({ blockNumber: 0n })
      .then((b) => setScope(`${config.chainId}:${b.hash}`))
      .catch((e: Error) => setError(`cannot reach the chain at ${config.rpcUrl}: ${e.message.split("\n")[0]}`));
  }, [client, config]);

  const reloadVault = useCallback(() => {
    if (scope) setVault(readVault(scope));
  }, [scope]);
  useEffect(reloadVault, [reloadVault]);

  const refresh = useCallback(async () => {
    if (!client || !config || busy.current) return;
    busy.current = true;
    try {
      const d = config.deployment;
      const [rawPublic, rawVeil, rawAuction, rawFeedback, block, balance] = await Promise.all([
        fetchPublicData(client, d),
        fetchVeilData(client, d),
        fetchAuctionData(client, d),
        fetchFeedbackData(client, d),
        client.getBlock({ blockTag: "latest" }),
        signer ? client.getBalance({ address: signer.address }) : Promise.resolve(null),
      ]);
      const anon = d.veil?.anonymousFeedback?.toLowerCase();
      const graph = buildPublicGraph({ ...rawPublic, feedback: rawPublic.feedback.filter((f) => f.client.toLowerCase() !== anon) });
      const names = new Map(graph.agents.map((a) => [a.agentId, a.name]));
      setData({
        now: block.timestamp,
        graph,
        veil: rawVeil ? buildVeilView(rawVeil, names) : null,
        auction: rawAuction ? buildAuctionView(rawAuction, names) : null,
        feedbackRaw: rawFeedback,
        feedback: rawFeedback ? buildFeedbackView(rawFeedback, names) : null,
        balance,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0]! : String(e));
    } finally {
      busy.current = false;
    }
  }, [client, config, signer]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!config || !client || !scope) return { veil: null, error };
  return { veil: { config, d: config.deployment, client, signer, setSigner, data, refresh, scope, vault, reloadVault }, error };
}
