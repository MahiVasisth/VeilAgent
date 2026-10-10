import type { SimulatedFile } from "@veil8004/sdk";

/** Shown whenever the population simulator's output is on this chain (contracts/deployments/<chainId>-simulated.json). */
export function SimDataBanner({ sim }: { sim: SimulatedFile | null }) {
  if (!sim) return null;
  return (
    <p className="sim-banner" data-testid="sim-data-banner">
      <strong>Simulated data on screen.</strong> {sim.clients.length} clients, {sim.taskIds.length} tasks
      {sim.raters.length ? ` and ${sim.raters.length} ratings` : ""} on this chain come from the population simulator
      (<code>scripts/src/simulator.ts</code>), to fill the receipt groups' anonymity set. They are labeled{" "}
      <span className="sim-tag">simulated</span> where they appear. The anonymity sets shown here are partly simulated.
    </p>
  );
}
