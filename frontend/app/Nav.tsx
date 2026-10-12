import { Children } from "react";
import type { SimulatedFile } from "@veil8004/sdk";

/** One small "Demo network" chip for the page header. Click it to read what on this chain is simulated; nothing is
 *  hidden from the page, it just stays out of the way. */
export function DemoInfo({ children }: { children: React.ReactNode }) {
  if (Children.toArray(children).length === 0) return null;
  return (
    <details className="demo-info">
      <summary>
        <span className="notice-dot" /> Demo network
      </summary>
      <div className="demo-pop">{children}</div>
    </details>
  );
}

/** Shown whenever the population simulator's output is on this chain (contracts/deployments/<chainId>-simulated.json). */
export function SimDataBanner({ sim }: { sim: SimulatedFile | null }) {
  if (!sim) return null;
  return (
    <p data-testid="sim-data-banner">
      <strong>Simulated data on screen.</strong> {sim.clients.length} clients, {sim.taskIds.length} tasks
      {sim.raters.length ? ` and ${sim.raters.length} ratings` : ""} on this chain come from the population simulator
      (<code>scripts/src/simulator.ts</code>), to fill the receipt groups' anonymity set. They are labeled{" "}
      <span className="sim-tag">simulated</span> where they appear. The anonymity sets shown here are partly simulated.
    </p>
  );
}

/** The local runner stands in for the Chainlink DON on this chain. */
export function SimDonBanner({ children }: { children: React.ReactNode }) {
  return (
    <p data-testid="sim-banner">
      <strong>Simulated DON.</strong> {children}
    </p>
  );
}
