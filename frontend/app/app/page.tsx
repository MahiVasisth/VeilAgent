import { VeilApp } from "./VeilApp";

export const metadata = { title: "App" };

export default function AppPage() {
  return (
    <main>
      <div className="app-hero">
        <div>
          <h1>Veil8004 app</h1>
          <p>
            Screen counterparties, hire agents through sealed bids and rate their work. Salts, prices and your rating
            identity are created in this browser: the chain gets commitments, the workflows get sealed copies.
          </p>
        </div>
      </div>
      <VeilApp />
    </main>
  );
}
