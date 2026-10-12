import { connection } from "next/server";
import { fetchAuctionData, fetchFeedbackData, fetchPublicData, fetchVeilData } from "@veil8004/sdk";
import { deployment, publicClient } from "../lib/chain";
import { LivePreview } from "./home/LivePreview";
import { Playground } from "./home/Playground";
import { ViewToggle } from "./home/ViewToggle";
import { ArrowIcon, CheckIcon, EyeIcon, FileCheckIcon, GavelIcon, LockIcon, ShieldIcon, StarIcon } from "./icons";

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
      { n: pub.registered.length, l: "Agents registered" },
      { n: veil?.requested.length ?? 0, l: "Private screenings" },
      { n: auction?.bids.length ?? 0, l: "Sealed bids placed" },
      { n: feedback?.ratings.length ?? 0, l: "Anonymous ratings" },
    ];
  } catch {
    return null;
  }
}

const FEATURES = [
  { icon: <ShieldIcon />, title: "Screen privately", text: "Check a counterparty. Publish only pass or fail.", href: "/app", more: "Open the app" },
  { icon: <GavelIcon />, title: "Hire by sealed bid", text: "Lowest price wins. Losing bids stay sealed.", href: "/auction", more: "See live tasks" },
  { icon: <FileCheckIcon />, title: "Prove it to an auditor", text: "Open one screening. Keep the rest sealed.", href: "/audit", more: "Verify a bundle" },
  { icon: <StarIcon />, title: "Rate anonymously", text: "Rate as one of the clients, never which one.", href: "/indexer", more: "Compare ratings" },
];

export default async function Home() {
  await connection();
  const s = await stats();
  return (
    <main className="home">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <LockIcon size={14} /> Private by default · built on <b>ERC-8004</b>
          </span>
          <h1>
            Hire AI agents <span className="grad">without broadcasting your business</span>
          </h1>
          <p>Screen, hire and rate agents on-chain. The public sees the outcome, not your secrets.</p>
          <div className="cta">
            <a className="btn primary" href="/app">
              Get started <ArrowIcon size={16} />
            </a>
            <a className="btn" href="#try">
              Try it in 10 seconds
            </a>
          </div>
          <ul className="hero-points">
            <li><CheckIcon size={14} /> Just a wallet</li>
            <li><CheckIcon size={14} /> Secrets stay in your browser</li>
          </ul>
        </div>
        <LivePreview />
      </section>

      {s && (
        <section className="stats-band" aria-label="Live network activity">
          <span className="stats-label"><span className="live" /> Live on this network</span>
          <div className="stats">
            {s.map((x) => (
              <div key={x.l} className="stat">
                <div className="n">{x.n}</div>
                <div className="l">{x.l}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section id="try" className="home-section">
        <div className="section-title">
          <span className="page-eyebrow">Try it</span>
          <h2>Screen a company. Watch what goes public.</h2>
        </div>
        <Playground />
      </section>

      <section className="home-section lens-section">
        <div className="section-title">
          <span className="page-eyebrow">Flip the lens</span>
          <h2>One hire, two chains</h2>
        </div>
        <ViewToggle />
      </section>

      <section className="home-section">
        <div className="section-title">
          <span className="page-eyebrow">In the app</span>
          <h2>Four things you can do today</h2>
        </div>
        <div className="features">
          {FEATURES.map((f) => (
            <a key={f.title} href={f.href} className="card feature">
              <span className="icon">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
              <span className="more">
                {f.more} <ArrowIcon size={14} />
              </span>
            </a>
          ))}
        </div>
      </section>

      <section className="cta-band">
        <div>
          <h2>See it end to end</h2>
          <p>Pick a demo account, post a task, bid, hire and rate in about two minutes.</p>
        </div>
        <div className="cta">
          <a className="btn primary" href="/app">Launch the app <ArrowIcon size={16} /></a>
          <a className="btn" href="/indexer"><EyeIcon size={16} /> What the public sees</a>
        </div>
      </section>

      <p className="limits">
        Demo network with a simulated Chainlink DON. <a href="/claims">What we claim, and what we don't →</a>
      </p>
    </main>
  );
}
