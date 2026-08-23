import { describe, expect, it } from "vitest";

import {
  CANONICAL_SEEDED_GENESIS_DEFINITION_VERSION,
  MarketplaceEngine,
  canonicalSeededGenesisDefinitionDigest,
  marketplaceJobDefinitionDigest,
} from "@a2a402/marketplace";

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
    expect(jobs).toHaveLength(14);
    expect(jobs.every((job) => job.tags.includes("seeded-test-job"))).toBe(
      true,
    );
    expect(jobs.map((job) => job.budgetMinor.toString())).toEqual([
      "400000",
      "250000",
      "200000",
      "150000",
      ...Array(10).fill("100000"),
    ]);
    const addedJobs = jobs.filter((job) => job.budgetMinor === 100000n);
    expect(addedJobs).toHaveLength(10);
    expect(
      addedJobs.every(
        (job) =>
          Object.keys(job.outputSchema).length > 1 &&
          job.acceptanceRules.length > 0,
      ),
    ).toBe(true);
    expect(engine.listAgents()).toHaveLength(1);
    const genesis = jobs.find((job) => job.tags.includes("genesis"));
    expect(engine.getCanonicalSeededGenesisDesignation()).toEqual({
      jobId: genesis?.id,
      buyerAgentId: genesis?.buyerAgentId,
      definitionVersion: CANONICAL_SEEDED_GENESIS_DEFINITION_VERSION,
      definitionDigest: canonicalSeededGenesisDefinitionDigest(
        TEST_ENGINE_CONFIG.maxArtifactBytes,
      ),
    });
    expect(
      engine
        .stateView()
        .auditEvents.some(
          (event) => event.action === "simulation.genesis_job_designated",
        ),
    ).toBe(true);
    const nonGenesis = jobs.find((job) => !job.tags.includes("genesis"));
    if (!nonGenesis) throw new Error("Non-Genesis fixture is missing");
    expect(() =>
      engine.setCanonicalSeededGenesisJob({
        jobId: nonGenesis.id,
        buyerAgentId: nonGenesis.buyerAgentId,
        definitionVersion: CANONICAL_SEEDED_GENESIS_DEFINITION_VERSION,
        definitionDigest: canonicalSeededGenesisDefinitionDigest(
          TEST_ENGINE_CONFIG.maxArtifactBytes,
        ),
      }),
    ).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });

  it("backfills legacy seeded state without creating a duplicate Genesis job", async () => {
    const original = new MarketplaceEngine(TEST_ENGINE_CONFIG);
    const originalRuntime = new MarketplaceRuntime(original, {
      runtimeMode: "simulation",
    });
    await ensureSimulationSeedOpportunities(original, originalRuntime);
    const genesisId = original.getCanonicalSeededGenesisDesignation()?.jobId;
    const legacySnapshot = original.exportSnapshot();
    delete legacySnapshot.canonicalSeededGenesisDesignation;

    const restored = new MarketplaceEngine(TEST_ENGINE_CONFIG);
    restored.restoreSnapshot(legacySnapshot);
    expect(restored.getCanonicalSeededGenesisDesignation()).toBeNull();
    const restoredRuntime = new MarketplaceRuntime(restored, {
      runtimeMode: "simulation",
    });

    await ensureSimulationSeedOpportunities(restored, restoredRuntime);

    expect(restored.getCanonicalSeededGenesisDesignation()?.jobId).toBe(
      genesisId,
    );
    expect(restored.listJobs()).toHaveLength(14);
    expect(
      restored.listJobs().filter((job) => job.tags.includes("genesis")),
    ).toHaveLength(1);
  });

  it("fails closed for a Genesis-like legacy job whose full definition differs", async () => {
    const original = new MarketplaceEngine(TEST_ENGINE_CONFIG);
    const originalRuntime = new MarketplaceRuntime(original, {
      runtimeMode: "simulation",
    });
    await ensureSimulationSeedOpportunities(original, originalRuntime);
    const legacySnapshot = original.exportSnapshot();
    delete legacySnapshot.canonicalSeededGenesisDesignation;
    const jobs = legacySnapshot.jobs as Array<Record<string, unknown>>;
    const genesis = jobs.find((job) =>
      (job.tags as string[]).includes("genesis"),
    );
    if (!genesis) throw new Error("Genesis fixture is missing");
    genesis.description = "Impersonating legacy Genesis definition";

    const restored = new MarketplaceEngine(TEST_ENGINE_CONFIG);
    restored.restoreSnapshot(legacySnapshot);
    const runtime = new MarketplaceRuntime(restored, {
      runtimeMode: "simulation",
    });

    await expect(
      ensureSimulationSeedOpportunities(restored, runtime),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409,
    });
    expect(restored.listJobs()).toHaveLength(14);
    expect(restored.getCanonicalSeededGenesisDesignation()).toBeNull();
  });

  it("clears a restored designation that points at a non-Genesis job", async () => {
    const original = new MarketplaceEngine(TEST_ENGINE_CONFIG);
    const runtime = new MarketplaceRuntime(original, {
      runtimeMode: "simulation",
    });
    await ensureSimulationSeedOpportunities(original, runtime);
    const snapshot = original.exportSnapshot();
    const otherJob = original
      .listJobs()
      .find((job) => !job.tags.includes("genesis"));
    if (!otherJob) throw new Error("Non-Genesis fixture is missing");
    snapshot.canonicalSeededGenesisDesignation = {
      jobId: otherJob.id,
      buyerAgentId: otherJob.buyerAgentId,
      definitionVersion: CANONICAL_SEEDED_GENESIS_DEFINITION_VERSION,
      definitionDigest: marketplaceJobDefinitionDigest(otherJob),
    };

    const restored = new MarketplaceEngine(TEST_ENGINE_CONFIG);
    restored.restoreSnapshot(snapshot);

    expect(restored.getCanonicalSeededGenesisDesignation()).toBeNull();
  });

  it("rejects ambiguous complete legacy matches without creating another job", async () => {
    const original = new MarketplaceEngine(TEST_ENGINE_CONFIG);
    const originalRuntime = new MarketplaceRuntime(original, {
      runtimeMode: "simulation",
    });
    await ensureSimulationSeedOpportunities(original, originalRuntime);
    const snapshot = original.exportSnapshot();
    delete snapshot.canonicalSeededGenesisDesignation;
    const jobs = snapshot.jobs as Array<Record<string, unknown>>;
    const genesis = jobs.find((job) =>
      (job.tags as string[]).includes("genesis"),
    );
    if (!genesis) throw new Error("Genesis fixture is missing");
    jobs.push({ ...structuredClone(genesis), id: crypto.randomUUID() });

    const restored = new MarketplaceEngine(TEST_ENGINE_CONFIG);
    restored.restoreSnapshot(snapshot);
    const runtime = new MarketplaceRuntime(restored, {
      runtimeMode: "simulation",
    });

    await expect(
      ensureSimulationSeedOpportunities(restored, runtime),
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });
    expect(restored.listJobs()).toHaveLength(15);
    expect(restored.getCanonicalSeededGenesisDesignation()).toBeNull();
  });
});
