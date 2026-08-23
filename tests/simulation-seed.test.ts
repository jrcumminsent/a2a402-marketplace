import { describe, expect, it } from "vitest";

import { MarketplaceEngine } from "@a2a402/marketplace";

import { MarketplaceRuntime } from "../apps/api/src/runtime.js";
import { ensureSimulationSeedOpportunities } from "../apps/api/src/simulation-seed.js";
import { TEST_ENGINE_CONFIG } from "./helpers/marketplace-fixtures.js";

describe("simulation opportunity seed", () => {
  it("creates funded, useful TEST jobs idempotently", async () => {
    const engine = new MarketplaceEngine(TEST_ENGINE_CONFIG);
    const runtime = new MarketplaceRuntime(engine, {
      runtimeMode: "simulation",
    });

    await ensureSimulationSeedOpportunities(engine, runtime);
    await ensureSimulationSeedOpportunities(engine, runtime);

    const jobs = engine.listJobs({ status: "open" });
    expect(jobs).toHaveLength(4);
    expect(jobs.every((job) => job.tags.includes("seeded-test-job"))).toBe(
      true,
    );
    expect(jobs.map((job) => job.budgetMinor.toString())).toEqual([
      "400000",
      "250000",
      "200000",
      "150000",
    ]);
    expect(engine.listAgents()).toHaveLength(1);
  });
});
