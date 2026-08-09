import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson, LocalArtifactStorage, sha256 } from "@a2a402/shared";

import {
  createContractFixture,
  createTestEngine,
  registerActor,
  settleFixture,
  signedManifest,
  standardJobInput,
} from "./helpers/marketplace-fixtures.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) =>
      rm(path, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("production provenance boundaries", () => {
  it("rejects a snapshot from the other execution mode", () => {
    const simulation = createTestEngine();
    const snapshot = simulation.exportSnapshot();
    const real = createTestEngine({
      simulationMode: false,
      jwtSecret: "production-shaped-test-secret-over-thirty-two-bytes",
    });

    expect(() => real.restoreSnapshot(snapshot)).toThrow(
      "Marketplace snapshot mode simulation cannot be loaded in real mode.",
    );
  });

  it("keeps marketplace earnings descended from simulation funds ineligible in real mode", async () => {
    const simulation = createTestEngine();
    const fixture = await createContractFixture(simulation, {
      prefix: "production-taint",
      amountMinor: 1_000n,
    });
    const alternateSeller = await registerActor(
      simulation,
      "production-taint-alternate-seller",
      ["seller"],
    );
    await settleFixture(simulation, fixture);

    const earnedLot = simulation
      .getCapitalLots(fixture.seller.agent.id)
      .find((lot) => lot.originType === "marketplace_earned");
    expect(earnedLot).toMatchObject({
      originType: "marketplace_earned",
      provenanceScope: "simulation",
      availableMinor: 950n,
    });

    // This represents an explicit operator migration to real mode. Even if the
    // snapshot's mode marker is migrated, the immutable lot-level taint must
    // still prevent that capital from becoming spendable.
    const migratedSnapshot = {
      ...simulation.exportSnapshot(),
      executionMode: "real",
    };
    const real = createTestEngine({
      simulationMode: false,
      jwtSecret: "production-shaped-test-secret-over-thirty-two-bytes",
    });
    real.restoreSnapshot(migratedSnapshot);

    const job = real.createJob(
      fixture.seller.agent.id,
      standardJobInput(900n),
    );
    const bid = real.submitBid(alternateSeller.agent.id, job.id, {
      amount_minor: 900n,
      execution_seconds: 60,
    });
    await expect(
      real.acceptBid(fixture.seller.agent.id, job.id, bid.id),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_ELIGIBLE_CAPITAL",
      details: {
        eligible_minor: "0",
        ineligible_minor: "950",
        platform_test_funds_eligible: false,
      },
    });
  });
});

describe("production artifact verification", () => {
  it("accepts an immutable marketplace artifact only when its stored bytes match the manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "a2a402-production-artifact-"));
    temporaryRoots.push(root);
    const storage = new LocalArtifactStorage({
      rootPath: root,
      maxBytes: 10_000,
    });
    const engine = createTestEngine({
      simulationMode: false,
      jwtSecret: "production-shaped-test-secret-over-thirty-two-bytes",
      artifactStorage: storage,
    });
    const buyer = await registerActor(engine, "stored-artifact-buyer", [
      "buyer",
    ]);
    const seller = await registerActor(engine, "stored-artifact-seller", [
      "seller",
    ]);
    engine.importCapital({
      agentId: buyer.agent.id,
      amountMinor: 1_000n,
      originType: "marketplace_earned",
      sourceTransactionHash: "0xreal-earned-capital",
    });
    const fixture = await createContractFixture(engine, {
      prefix: "stored-artifact",
      buyer,
      seller,
      fundBuyer: false,
    });
    const result = { ok: true, value: "verified bytes" };
    const bytes = canonicalJson(result);
    const hash = sha256(bytes);
    const stored = await engine.storeArtifact(seller.agent.id, {
      key: "deliveries/result.json",
      data_utf8: bytes,
      mime_type: "application/json",
      expected_sha256: hash,
    });
    const manifest = await signedManifest(
      seller,
      fixture.contract.id,
      result,
      {
        artifact_uris: [stored.uri],
        artifact_hashes: [stored.sha256],
        artifact_mime_types: [stored.mimeType],
        artifact_sizes: [stored.sizeBytes],
      },
    );

    await expect(
      engine.submitDelivery(seller.agent.id, fixture.contract.id, manifest),
    ).resolves.toMatchObject({
      contractId: fixture.contract.id,
      status: "submitted",
    });
  });

  it("rejects a marketplace artifact whose object bytes were changed after metadata creation", async () => {
    const root = await mkdtemp(join(tmpdir(), "a2a402-tampered-artifact-"));
    temporaryRoots.push(root);
    const storage = new LocalArtifactStorage({
      rootPath: root,
      maxBytes: 10_000,
    });
    const engine = createTestEngine({
      simulationMode: false,
      jwtSecret: "production-shaped-test-secret-over-thirty-two-bytes",
      artifactStorage: storage,
    });
    const buyer = await registerActor(engine, "tampered-artifact-buyer", [
      "buyer",
    ]);
    const seller = await registerActor(engine, "tampered-artifact-seller", [
      "seller",
    ]);
    engine.importCapital({
      agentId: buyer.agent.id,
      amountMinor: 1_000n,
      originType: "marketplace_earned",
      sourceTransactionHash: "0xreal-earned-capital-tamper-test",
    });
    const fixture = await createContractFixture(engine, {
      prefix: "tampered-artifact",
      buyer,
      seller,
      fundBuyer: false,
    });
    const result = { ok: true, value: "original" };
    const bytes = canonicalJson(result);
    const stored = await engine.storeArtifact(seller.agent.id, {
      key: "deliveries/tamper.json",
      data_utf8: bytes,
      mime_type: "application/json",
      expected_sha256: sha256(bytes),
    });
    const manifest = await signedManifest(
      seller,
      fixture.contract.id,
      result,
      {
        artifact_uris: [stored.uri],
        artifact_hashes: [stored.sha256],
        artifact_mime_types: [stored.mimeType],
        artifact_sizes: [stored.sizeBytes],
      },
    );

    await writeFile(
      join(root, "objects", "deliveries", "tamper.json"),
      canonicalJson({ ok: true, value: "tampered" }),
      "utf8",
    );

    await expect(
      engine.submitDelivery(seller.agent.id, fixture.contract.id, manifest),
    ).rejects.toMatchObject({
      code: "ARTIFACT_HASH_MISMATCH",
    });
    expect(engine.getContract(fixture.contract.id).status).toBe("active");
  });
});
