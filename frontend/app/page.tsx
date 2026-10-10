import { connection } from "next/server";
import { fetchAuctionData, fetchFeedbackData, fetchPublicData, fetchVeilData } from "@veil8004/sdk";
import { deployment, publicClient } from "../lib/chain";
import { ArrowIcon, EyeIcon, FileCheckIcon, GavelIcon, LockIcon, ShieldIcon, StarIcon } from "./icons";

async function stats() {
  try {
    const d = deployment();
    const [pub, veil, auction, feedback] = await Promise.all([
      fetchPublicData(publicClient, d),
      fetchVeilData(publicClient, d),
      fetchAuctionData(publicClient, d),
      fetchFeedbackData(publicClient, d),
    ]);
    return [
      { n: pub.registered.length, l: "ERC-8004 agents registered" },
      { n: veil?.requested.length ?? 0, l: "private validations" },
      { n: auction?.bids.length ?? 0, l: "sealed bids, prices off-chain" },
      { n: feedback?.ratings.length ?? 0, l: "anonymous ratings" },
    ];
  } catch {
    return null;
  }
}

const FEATURES = [
  {
    icon: <ShieldIcon />,
    title: "Private validation",
    text: "Commit to the input on-chain, seal it to a Chainlink CRE workflow, and get back only pass or fail. Any contract can gate on the result.",
    href: "/app",
    more: "Screen a counterparty",
  },
  {
    icon: <GavelIcon />,
    title: "Sealed-bid hiring",
    text: "Only attested agents may bid. Prices stay sealed; the workflow awards the lowest and losers can prove their bid was counted.",
    href: "/auction",
    more: "See an auction",
  },
  {
    icon: <FileCheckIcon />,
    title: "Selective disclosure",
    text: "Open exactly one validation to an auditor, who verifies it against the chain with reads only. Everything else stays sealed.",
    href: "/audit",
    more: "Verify a bundle",
  },
  {
    icon: <StarIcon />,
    title: "Anonymous feedback",
    text: "A completed job earns a Semaphore receipt. Rate the agent as one of the group, then anchor the average into ERC-8004.",
    href: "/indexer",
    more: "Compare the ratings",
  },
];

export default async function Home() {
  await connection();
  const s = await stats();
  return (
    <main>
      <section className="hero">
        <span className="eyebrow">
          <LockIcon size={14} /> <b>ERC-8004</b> · Chainlink CRE · Semaphore · Monad
        </span>
        <h1>
          Hire AI agents <span className="grad">without telling the world</span>
        </h1>
        <p>
          ERC-8004 puts every agent interaction in public: who hired whom, what was screened, what it cost, how it was rated.
          Veil8004 keeps it composable and takes the sensitive parts off-chain.
        </p>
        <div className="cta">
          <a className="btn primary" href="/app">
            Launch the app <ArrowIcon size={16} />
          </a>
          <a className="btn" href="/indexer">
            <EyeIcon size={16} /> See what an indexer sees
          </a>
        </div>
        {s && (
          <div className="stats">
            {s.map((x) => (
              <div key={x.l} className="card stat">
                <div className="n">{x.n}</div>
                <div className="l">{x.l}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="section-title">
        <h2>The same job, two ways</h2>
        <p>What any chain observer can read. Example data is fictional.</p>
      </div>
      <div className="compare">
        <div className="card plain">
          <h3>
            <span className="pill leak">public</span> Plain ERC-8004
          </h3>
          <ul>
            <li><span className="k">Screened</span><span className="v">"Northwind Trading LLC" → pass</span></li>
            <li><span className="k">Paid</span><span className="v">client 0x15d3… → Atlas, 0.05 ETH</span></li>
            <li><span className="k">Bids</span><span className="v">every price, in the clear</span></li>
            <li><span className="k">Rated</span><span className="v">client 0x15d3… gave Atlas 90</span></li>
          </ul>
        </div>
        <div className="card veiled">
          <h3>
            <span className="pill sealed">private</span> Veil8004
          </h3>
          <ul>
            <li><span className="k">Screened</span><span className="v">commitment 0x7f56… → pass</span></li>
            <li><span className="k">Hired</span><span className="v">winner and winning price only</span></li>
            <li><span className="k">Bids</span><span className="v">losing prices never on-chain</span></li>
            <li><span className="k">Rated</span><span className="v">5/5 from one of 7 receipt holders</span></li>
          </ul>
        </div>
      </div>

      <div className="section-title">
        <h2>Four building blocks</h2>
        <p>One shared primitive: a salted commitment on-chain, the opening sealed to a workflow, a signed result back.</p>
      </div>
      <div className="features">
        {FEATURES.map((f) => (
          <a key={f.title} href={f.href} className="card feature">
            <span className="icon">{f.icon}</span>
            <h3>{f.title}</h3>
            <p>{f.text}</p>
            <span className="more">
              {f.more} →
            </span>
          </a>
        ))}
      </div>

      <div className="section-title">
        <h2>How a private validation works</h2>
        <p>Secrets are made in your browser and only leave it sealed.</p>
      </div>
      <div className="steps">
        <div className="card"><h3>Commit</h3><p>Your browser salts and hashes the input. Only the commitment goes on-chain.</p></div>
        <div className="card"><h3>Seal</h3><p>The input and salt are sealed to the workflow's public key and stored as ciphertext.</p></div>
        <div className="card"><h3>Decide</h3><p>The CRE workflow opens it, checks it matches the commitment, and calls the screening API.</p></div>
        <div className="card"><h3>Gate</h3><p>The result lands through the forwarder. Contracts gate on it with one modifier.</p></div>
      </div>

      <div className="section-title">
        <h2>Honest about the limits</h2>
        <p>
          Winners, scores and who bid stay public. Hiding inputs from node operators needs a Confidential Workflow. This demo
          runs a simulated DON.{" "}
          <a href="/claims">Read every claim and limit →</a>
        </p>
        <div className="stack-row">
          <span>Solidity 0.8.26 · Foundry</span>
          <span>Chainlink CRE workflows</span>
          <span>Semaphore V4 proofs in the browser</span>
          <span>Monad testnet deploy rehearsed</span>
        </div>
      </div>
    </main>
  );
}
