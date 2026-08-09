import { describe, expect, it } from "vitest";
import { MarketplaceEngine, type LedgerEntry } from "@a2a402/marketplace";
import {
  createContractFixture,
  createTestEngine,
  registerActor,
  settleFixture,
  signedManifest,
  standardJobInput,
  verifyPlatformValue,
} from "./helpers/marketplace-fixtures.js";

function entriesForTransaction(
  entries: LedgerEntry[],
  transactionId: string,
): LedgerEntry[] {
  return entries.filter((entry) => entry.transactionId === transactionId);
}

describe("listing, job, bid, and contract workflow", () => {
  it("creates a versioned listing and enforces job capability and ownership rules", async () => {
    const engine = createTestEngine();
    const buyer = await registerActor(engine, "workflow-buyer", ["buyer"]);
    const seller = await registerActor(engine, "workflow-seller", [
      "seller",
      "structured-analysis",
    ]);
    const unqualified = await registerActor(engine, "workflow-unqualified", [
      "seller",
    ]);
    engine.importCapital({
      agentId: buyer.agent.id,
      amountMinor: 2_000n,
      originType: "platform_test_funds",
    });

    const listing = engine.createListing(seller.agent.id, {
      type: "service",
      title: "Structured analysis",
      description: "Returns deterministic JSON.",
      input_schema: { type: "object" },
      output_schema: {
        type: "object",
        required: ["ok"],
        properties: { ok: { const: true } },
      },
      maximum_execution_seconds: 120,
      price_minor: "1000",
      asset: "USDC",
      required_capabilities: ["structured-analysis"],
      artifact_mime_types: ["application/json"],
      tags: ["analysis", "deterministic"],
      policy_category: "analysis",
    });
    expect(listing).toMatchObject({
      sellerAgentId: seller.agent.id,
      version: 1,
      status: "active",
      priceMinor: 1_000n,
      asset: "USDC",
    });
    const updated = engine.updateListing(seller.agent.id, listing.id, {
      title: "Structured analysis v2",
      price_minor: "1100",
    });
    expect(updated.version).toBe(2);
    expect(updated.priceMinor).toBe(1_100n);
    expect(() =>
      engine.updateListing(buyer.agent.id, listing.id, { title: "hijacked" }),
    ).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));

    const job = engine.createJob(buyer.agent.id, {
      ...standardJobInput(1_000n, {
        listing_id: listing.id,
        required_capabilities: ["structured-analysis"],
      }),
      output_schema: listing.outputSchema,
    });
    expect(job).toMatchObject({
      buyerAgentId: buyer.agent.id,
      listingId: listing.id,
      status: "open",
      budgetMinor: 1_000n,
    });
    expect(() =>
      engine.submitBid(unqualified.agent.id, job.id, {
        amount_minor: 1_000n,
        execution_seconds: 60,
      }),
    ).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(() =>
      engine.submitBid(buyer.agent.id, job.id, {
        amount_minor: 1_000n,
        execution_seconds: 60,
      }),
    ).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));

    const bid = engine.submitBid(seller.agent.id, job.id, {
      amount_minor: "900",
      asset: "USDC",
      execution_seconds: 60,
      proposal: { approach: "deterministic" },
    });
    const contract = await engine.acceptBid(buyer.agent.id, job.id, bid.id);
    expect(contract).toMatchObject({
      buyerAgentId: buyer.agent.id,
      sellerAgentId: seller.agent.id,
      amountMinor: 900n,
      platformFeeBps: 500,
      status: "active",
    });
    expect(engine.getJob(job.id).status).toBe("awarded");
    expect(engine.listBids(job.id)[0]?.status).toBe("accepted");
    expect(engine.getBalance(buyer.agent.id)).toMatchObject({
      eligibleAvailableMinor: 1_100n,
      eligibleReservedMinor: 900n,
    });
  });

  it("validates job input against JSON Schema before publishing it", async () => {
    const engine = createTestEngine();
    const buyer = await registerActor(engine, "invalid-input-buyer");
    expect(() =>
      engine.createJob(
        buyer.agent.id,
        standardJobInput(1_000n, {
          input: { unexpected: true },
          input_schema: {
            type: "object",
            required: ["request"],
            properties: { request: { type: "string" } },
            additionalProperties: false,
          },
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "SCHEMA_VALIDATION_FAILED" }));
    expect(engine.listJobs()).toHaveLength(0);
  });
});

describe("Proof-of-Earn reservation and concurrency", () => {
  it("rejects human-seeded and unknown funds while accepting visibly labeled test funds", async () => {
    const engine = createTestEngine();
    const buyer = await registerActor(engine, "origin-buyer", ["buyer"]);
    const seller = await registerActor(engine, "origin-seller", ["seller"]);
    engine.importCapital({
      agentId: buyer.agent.id,
      amountMinor: 3_000n,
      originType: "human_seeded",
      sourceTransactionHash: "human:deposit",
    });
    engine.importCapital({
      agentId: buyer.agent.id,
      amountMinor: 500n,
      originType: "unknown",
      sourceTransactionHash: "unknown:deposit",
    });
    const job = engine.createJob(buyer.agent.id, standardJobInput(1_000n));
    const bid = engine.submitBid(seller.agent.id, job.id, {
      amount_minor: 1_000n,
      execution_seconds: 60,
    });

    await expect(
      engine.acceptBid(buyer.agent.id, job.id, bid.id),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_ELIGIBLE_CAPITAL",
      statusCode: 402,
      details: {
        required_minor: "1000",
        eligible_minor: "0",
        ineligible_minor: "3500",
        platform_test_funds_eligible: true,
      },
    });
    expect(engine.getBalance(buyer.agent.id)).toMatchObject({
      eligibleAvailableMinor: 0n,
      eligibleReservedMinor: 0n,
      ineligibleAvailableMinor: 3_500n,
    });

    const testLot = engine.importCapital({
      agentId: buyer.agent.id,
      amountMinor: 1_000n,
      originType: "platform_test_funds",
      sourceTransactionHash: "simulation:test-funds",
    });
    expect(testLot.originType).toBe("platform_test_funds");
    const contract = await engine.acceptBid(buyer.agent.id, job.id, bid.id);
    expect(contract.status).toBe("active");
    expect(
      engine.getBalance(buyer.agent.id).byOrigin.platform_test_funds,
    ).toEqual({
      availableMinor: 0n,
      reservedMinor: 1_000n,
    });
    expect(engine.getBalance(buyer.agent.id).ineligibleAvailableMinor).toBe(
      3_500n,
    );
  });

  it("disables platform test funds outside explicit simulation mode", async () => {
    const engine = createTestEngine({
      simulationMode: false,
      jwtSecret: "production-shaped-test-secret-over-thirty-two-bytes",
    });
    const actor = await registerActor(engine, "real-mode-actor");
    expect(() =>
      engine.importCapital({
        agentId: actor.agent.id,
        amountMinor: 100n,
        originType: "platform_test_funds",
      }),
    ).toThrow(expect.objectContaining({ code: "PROVENANCE_INVALID" }));
  });

  it("preserves a partially spent capital lot and links the seller lot to its parent", async () => {
    const engine = createTestEngine();
    const fixture = await createContractFixture(engine, {
      prefix: "partial-lot",
      amountMinor: 1_000n,
      fundingAmountMinor: 1_500n,
    });
    const buyerLotsBefore = engine.getCapitalLots(fixture.buyer.agent.id);
    expect(buyerLotsBefore).toHaveLength(1);
    expect(buyerLotsBefore[0]).toMatchObject({
      amountMinor: 1_500n,
      availableMinor: 500n,
      reservedMinor: 1_000n,
      status: "verified",
    });

    const completed = await settleFixture(engine, fixture);
    const buyerLot = engine.getCapitalLots(fixture.buyer.agent.id)[0];
    expect(buyerLot).toMatchObject({
      amountMinor: 1_500n,
      availableMinor: 500n,
      reservedMinor: 0n,
      status: "verified",
    });
    const sellerLot = engine
      .getCapitalLots(fixture.seller.agent.id)
      .find((lot) => lot.id === completed.settlement.sellerCapitalLotId);
    expect(sellerLot).toMatchObject({
      amountMinor: 950n,
      availableMinor: 950n,
      originType: "marketplace_earned",
      sourceSettlementId: completed.settlement.id,
      sourceJobId: fixture.jobId,
      parentCapitalLotIds: [buyerLot?.id],
    });
    const lineage = engine.getProvenanceLineage(sellerLot!.id);
    expect(lineage.parents[0]?.lot.id).toBe(buyerLot?.id);
  });

  it("serializes competing reservations and prevents concurrent double spend", async () => {
    const engine = createTestEngine();
    const buyer = await registerActor(engine, "double-spend-buyer", ["buyer"]);
    const sellerA = await registerActor(engine, "double-spend-seller-a", [
      "seller",
    ]);
    const sellerB = await registerActor(engine, "double-spend-seller-b", [
      "seller",
    ]);
    engine.importCapital({
      agentId: buyer.agent.id,
      amountMinor: 1_000n,
      originType: "platform_test_funds",
    });

    const jobA = engine.createJob(
      buyer.agent.id,
      standardJobInput(1_000n, { title: "Concurrent job A" }),
    );
    const jobB = engine.createJob(
      buyer.agent.id,
      standardJobInput(1_000n, { title: "Concurrent job B" }),
    );
    const bidA = engine.submitBid(sellerA.agent.id, jobA.id, {
      amount_minor: 1_000n,
      execution_seconds: 60,
    });
    const bidB = engine.submitBid(sellerB.agent.id, jobB.id, {
      amount_minor: 1_000n,
      execution_seconds: 60,
    });

    const attempts = await Promise.allSettled([
      engine.acceptBid(buyer.agent.id, jobA.id, bidA.id),
      engine.acceptBid(buyer.agent.id, jobB.id, bidB.id),
    ]);
    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = attempts.find(
      (attempt): attempt is PromiseRejectedResult =>
        attempt.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({
      code: "INSUFFICIENT_ELIGIBLE_CAPITAL",
    });
    expect(engine.getBalance(buyer.agent.id)).toMatchObject({
      eligibleAvailableMinor: 0n,
      eligibleReservedMinor: 1_000n,
    });
    expect(
      engine
        .stateView()
        .reservations.filter((reservation) => reservation.status === "active"),
    ).toHaveLength(1);
    expect(engine.assertAccountingInvariants()).toMatchObject({
      nonnegativeCapitalLots: true,
      nonnegativeAgentBalances: true,
    });
  });
});

describe("delivery validation, settlement, and ledger accounting", () => {
  it("rejects bad artifact hashes, MIME types, and sizes with stable codes", async () => {
    const result = { ok: true, value: "artifact" };

    const hashEngine = createTestEngine();
    const hashFixture = await createContractFixture(hashEngine, {
      prefix: "bad-hash",
    });
    const badHash = await signedManifest(
      hashFixture.seller,
      hashFixture.contract.id,
      result,
      { artifact_hashes: ["0".repeat(64)] },
    );
    await expect(
      hashEngine.submitDelivery(
        hashFixture.seller.agent.id,
        hashFixture.contract.id,
        badHash,
      ),
    ).rejects.toMatchObject({ code: "ARTIFACT_HASH_MISMATCH" });

    const mimeEngine = createTestEngine();
    const mimeFixture = await createContractFixture(mimeEngine, {
      prefix: "bad-mime",
    });
    const badMime = await signedManifest(
      mimeFixture.seller,
      mimeFixture.contract.id,
      result,
      { artifact_mime_types: ["text/plain"] },
    );
    await expect(
      mimeEngine.submitDelivery(
        mimeFixture.seller.agent.id,
        mimeFixture.contract.id,
        badMime,
      ),
    ).rejects.toMatchObject({ code: "SCHEMA_VALIDATION_FAILED" });

    const sizeEngine = createTestEngine();
    const sizeFixture = await createContractFixture(sizeEngine, {
      prefix: "too-large",
      jobOverrides: { maximum_artifact_bytes: 10 },
    });
    const tooLarge = await signedManifest(
      sizeFixture.seller,
      sizeFixture.contract.id,
      result,
      { artifact_sizes: [11] },
    );
    await expect(
      sizeEngine.submitDelivery(
        sizeFixture.seller.agent.id,
        sizeFixture.contract.id,
        tooLarge,
      ),
    ).rejects.toMatchObject({
      code: "ARTIFACT_TOO_LARGE",
      statusCode: 413,
    });
  });

  it("records deterministic schema failure and prevents acceptance", async () => {
    const engine = createTestEngine();
    const fixture = await createContractFixture(engine, {
      prefix: "schema-failure",
    });
    const invalidResult = { ok: false, unexpected: 1 };
    const manifest = await signedManifest(
      fixture.seller,
      fixture.contract.id,
      invalidResult,
    );
    await engine.submitDelivery(
      fixture.seller.agent.id,
      fixture.contract.id,
      manifest,
    );
    const evaluation = engine.evaluateDelivery(
      fixture.buyer.agent.id,
      fixture.contract.id,
    );
    expect(evaluation.result).toBe("rejected");
    expect(
      evaluation.checks.find((check) => check.name === "json_schema"),
    ).toMatchObject({ passed: false });
    expect(() =>
      engine.acceptDelivery(fixture.buyer.agent.id, fixture.contract.id),
    ).toThrow(expect.objectContaining({ code: "SCHEMA_VALIDATION_FAILED" }));
  });

  it("settles exactly once, deducts the configured 5% fee, and signs the receipt", async () => {
    const engine = createTestEngine();
    const fixture = await createContractFixture(engine, {
      prefix: "settlement",
      amountMinor: 1_000n,
    });
    const completed = await settleFixture(engine, fixture);
    expect(completed.evaluation.result).toBe("accepted");
    expect(completed.settlement).toMatchObject({
      grossMinor: 1_000n,
      feeMinor: 50n,
      networkCostMinor: 0n,
      sellerNetMinor: 950n,
      status: "completed",
    });
    expect(
      await engine.settleContract(fixture.seller.agent.id, fixture.contract.id),
    ).toEqual(completed.settlement);

    const state = engine.stateView();
    expect(state.settlements).toHaveLength(1);
    expect(state.platformFees).toHaveLength(1);
    expect(state.platformFees[0]).toMatchObject({
      settlementId: completed.settlement.id,
      contractId: fixture.contract.id,
      amountMinor: 50n,
      basisPoints: 500,
    });
    expect(engine.getStats()).toMatchObject({
      completedContracts: 1,
      grossVolumeMinor: 1_000n,
      platformFeesMinor: 50n,
    });

    const receipt = state.receipts[0]!;
    const {
      keyId: _keyId,
      digest: _digest,
      signature,
      ...receiptBase
    } = receipt;
    expect(verifyPlatformValue(engine, receiptBase, signature)).toBe(true);
    expect(receipt).toMatchObject({
      settlementId: completed.settlement.id,
      grossMinor: 1_000n,
      feeMinor: 50n,
      sellerNetMinor: 950n,
      provenanceLotId: completed.settlement.sellerCapitalLotId,
    });
  });

  it("keeps every value movement balanced and all balances nonnegative", async () => {
    const engine = createTestEngine();
    const fixture = await createContractFixture(engine, {
      prefix: "balanced-ledger",
      amountMinor: 700n,
      fundingAmountMinor: 1_200n,
    });
    await settleFixture(engine, fixture);
    const state = engine.stateView();
    expect(state.ledgerTransactions.length).toBeGreaterThanOrEqual(3);
    for (const transaction of state.ledgerTransactions) {
      const entries = entriesForTransaction(
        state.ledgerEntries,
        transaction.id,
      );
      const debits = entries
        .filter((entry) => entry.side === "debit")
        .reduce((total, entry) => total + entry.amountMinor, 0n);
      const credits = entries
        .filter((entry) => entry.side === "credit")
        .reduce((total, entry) => total + entry.amountMinor, 0n);
      expect(entries.length).toBeGreaterThanOrEqual(2);
      expect(debits).toBeGreaterThan(0n);
      expect(credits).toBe(debits);
      expect(engine.isLedgerTransactionBalanced(transaction.id)).toBe(true);
    }
    expect(engine.assertAccountingInvariants()).toEqual({
      balancedTransactions: state.ledgerTransactions.length,
      totalTransactions: state.ledgerTransactions.length,
      nonnegativeCapitalLots: true,
      nonnegativeAgentBalances: true,
    });
  });
});

describe("refund and dispute handling", () => {
  it("refunds an active reservation back into the same capital lot", async () => {
    const engine = createTestEngine();
    const fixture = await createContractFixture(engine, {
      prefix: "simple-refund",
      amountMinor: 600n,
      fundingAmountMinor: 1_000n,
    });
    const originalLotId = engine.getCapitalLots(fixture.buyer.agent.id)[0]!.id;
    const refunded = await engine.refundContract(
      fixture.buyer.agent.id,
      fixture.contract.id,
      "buyer_cancelled",
    );
    expect(refunded.status).toBe("refunded");
    expect(engine.getBalance(fixture.buyer.agent.id)).toMatchObject({
      eligibleAvailableMinor: 1_000n,
      eligibleReservedMinor: 0n,
    });
    expect(engine.getCapitalLots(fixture.buyer.agent.id)).toContainEqual(
      expect.objectContaining({
        id: originalLotId,
        amountMinor: 1_000n,
        availableMinor: 1_000n,
        reservedMinor: 0n,
        status: "verified",
      }),
    );
    expect(engine.stateView().reservations[0]?.status).toBe("refunded");
    expect(engine.assertAccountingInvariants().nonnegativeAgentBalances).toBe(
      true,
    );
  });

  it("moves disputed funds into a distinct ledger account and resolves them by refund", async () => {
    const engine = createTestEngine();
    const fixture = await createContractFixture(engine, {
      prefix: "dispute-refund",
      amountMinor: 800n,
    });
    const manifest = await signedManifest(fixture.seller, fixture.contract.id, {
      ok: true,
      value: "disputed",
    });
    await engine.submitDelivery(
      fixture.seller.agent.id,
      fixture.contract.id,
      manifest,
    );
    const dispute = engine.disputeContract(
      fixture.buyer.agent.id,
      fixture.contract.id,
      "OUTPUT_CONTESTED",
      { artifact: "evidence-1" },
    );
    expect(dispute.status).toBe("open");
    expect(engine.getBalance(fixture.buyer.agent.id)).toMatchObject({
      eligibleReservedMinor: 0n,
      disputedMinor: 800n,
    });
    await expect(
      engine.settleContract(fixture.seller.agent.id, fixture.contract.id),
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });

    const contract = await engine.refundContract(
      fixture.seller.agent.id,
      fixture.contract.id,
      "dispute_resolved_for_buyer",
    );
    expect(contract.status).toBe("refunded");
    expect(engine.getBalance(fixture.buyer.agent.id)).toMatchObject({
      eligibleAvailableMinor: 800n,
      eligibleReservedMinor: 0n,
      disputedMinor: 0n,
    });
    expect(engine.stateView().disputes[0]).toMatchObject({
      id: dispute.id,
      status: "resolved_refund",
    });
    expect(
      engine
        .getReputation(fixture.seller.agent.id)
        .events.map((event) => event.type),
    ).toEqual(expect.arrayContaining(["dispute", "refund"]));
    expect(engine.assertAccountingInvariants().nonnegativeAgentBalances).toBe(
      true,
    );
  });
});
