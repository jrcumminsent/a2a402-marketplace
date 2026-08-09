import { describe, expect, it, vi } from "vitest";
import {
  canonicalJson,
  InMemoryS3CompatibleClient,
  S3CompatibleArtifactStorage,
  sha256,
} from "@a2a402/shared";

import {
  createContractFixture,
  createTestEngine,
  registerActor,
  signedManifest,
  standardJobInput,
} from "./helpers/marketplace-fixtures.js";

describe("deterministic autonomous purchasing", () => {
  it("materializes and purchases a standing listing at its versioned terms", async () => {
    const engine = createTestEngine();
    const buyer = await registerActor(engine, "standing-listing-buyer", [
      "buyer",
    ]);
    const seller = await registerActor(engine, "standing-listing-seller", [
      "seller",
      "structured-analysis",
    ]);
    engine.importCapital({
      agentId: buyer.agent.id,
      amountMinor: 2_000n,
      originType: "platform_test_funds",
    });
    const listing = engine.createListing(seller.agent.id, {
      type: "service",
      title: "Standing deterministic analysis",
      description: "Returns a schema-conformant analysis result.",
      input_schema: {
        type: "object",
        required: ["query"],
        properties: { query: { type: "string" } },
        additionalProperties: false,
      },
      output_schema: {
        type: "object",
        required: ["ok"],
        properties: { ok: { const: true } },
        additionalProperties: false,
      },
      maximum_execution_seconds: 120,
      price_minor: "750",
      asset: "USDC",
      required_capabilities: ["structured-analysis"],
      artifact_mime_types: ["application/json"],
      tags: ["standing-offer"],
      policy_category: "analysis",
    });

    const contract = await engine.purchaseListing(
      buyer.agent.id,
      listing.id,
      { query: "market state" },
    );
    const job = engine.getJob(contract.jobId);
    const [bid] = engine.listBids(job.id);

    expect(contract).toMatchObject({
      buyerAgentId: buyer.agent.id,
      sellerAgentId: seller.agent.id,
      amountMinor: 750n,
      status: "active",
    });
    expect(job).toMatchObject({
      listingId: listing.id,
      status: "awarded",
      input: { query: "market state" },
    });
    expect(bid).toMatchObject({
      status: "accepted",
      amountMinor: 750n,
      proposal: {
        source: "standing_listing_offer",
        listing_id: listing.id,
        listing_version: 1,
      },
    });
  });

  it("selects by lowest amount, then shortest execution time, independent of submission order", async () => {
    const engine = createTestEngine();
    const buyer = await registerActor(engine, "best-bid-buyer", ["buyer"]);
    const expensiveFast = await registerActor(
      engine,
      "best-bid-expensive-fast",
      ["seller"],
    );
    const cheapSlow = await registerActor(engine, "best-bid-cheap-slow", [
      "seller",
    ]);
    const cheapFast = await registerActor(engine, "best-bid-cheap-fast", [
      "seller",
    ]);
    engine.importCapital({
      agentId: buyer.agent.id,
      amountMinor: 1_000n,
      originType: "platform_test_funds",
    });
    const job = engine.createJob(
      buyer.agent.id,
      standardJobInput(1_000n),
    );
    engine.submitBid(expensiveFast.agent.id, job.id, {
      amount_minor: 800n,
      execution_seconds: 5,
    });
    engine.submitBid(cheapSlow.agent.id, job.id, {
      amount_minor: 700n,
      execution_seconds: 50,
    });
    const expected = engine.submitBid(cheapFast.agent.id, job.id, {
      amount_minor: 700n,
      execution_seconds: 20,
    });

    const contract = await engine.selectBestBid(buyer.agent.id, job.id);

    expect(contract).toMatchObject({
      bidId: expected.id,
      sellerAgentId: cheapFast.agent.id,
      amountMinor: 700n,
    });
    expect(
      engine.listBids(job.id).filter((bid) => bid.status === "accepted"),
    ).toEqual([expect.objectContaining({ id: expected.id })]);
  });
});

describe("webhook delivery identity and retries", () => {
  it("uses one stable delivery id per subscription and never redelivers a successful subscriber", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T12:00:00.000Z"));
    try {
      const engine = createTestEngine();
      const seller = await registerActor(engine, "webhook-seller", ["seller"]);
      const secret = "production-webhook-secret-123456";
      const first = engine.registerWebhook(seller.agent.id, {
        url: "https://first.example/webhook",
        eventTypes: ["listing.created"],
        secret,
      });
      const second = engine.registerWebhook(seller.agent.id, {
        url: "https://second.example/webhook",
        eventTypes: ["listing.created"],
        secret,
      });
      engine.createListing(seller.agent.id, {
        type: "service",
        title: "Webhook event source",
        description: "Creates one listing event.",
        output_schema: { type: "object" },
        price_minor: "100",
      });

      const calls: Array<{ subscriptionId: string; deliveryId: string }> = [];
      const firstAttempt = await engine.dispatchOutbox(
        async ({ subscription, deliveryId }) => {
          calls.push({ subscriptionId: subscription.id, deliveryId });
          return subscription.id === first.id;
        },
        () => secret,
      );
      expect(firstAttempt).toMatchObject({ failed: 1, deadLettered: 0 });
      expect(calls).toHaveLength(2);
      const firstDeliveryId = calls.find(
        (call) => call.subscriptionId === first.id,
      )?.deliveryId;
      const secondDeliveryId = calls.find(
        (call) => call.subscriptionId === second.id,
      )?.deliveryId;
      expect(firstDeliveryId).toBeTruthy();
      expect(secondDeliveryId).toBeTruthy();
      expect(firstDeliveryId).not.toBe(secondDeliveryId);

      vi.advanceTimersByTime(11_000);
      const secondAttempt = await engine.dispatchOutbox(
        async ({ subscription, deliveryId }) => {
          calls.push({ subscriptionId: subscription.id, deliveryId });
          return true;
        },
        () => secret,
      );

      expect(secondAttempt).toMatchObject({ delivered: 1, failed: 0 });
      expect(
        calls.filter((call) => call.subscriptionId === first.id),
      ).toHaveLength(1);
      const retriedSecond = calls.filter(
        (call) => call.subscriptionId === second.id,
      );
      expect(retriedSecond).toHaveLength(2);
      expect(retriedSecond[1]?.deliveryId).toBe(secondDeliveryId);
      expect(engine.listWebhookDeliveries()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: firstDeliveryId,
            subscriptionId: first.id,
            status: "delivered",
            attempts: 1,
          }),
          expect.objectContaining({
            id: secondDeliveryId,
            subscriptionId: second.id,
            status: "delivered",
            attempts: 2,
          }),
        ]),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("autonomous timeout processing", () => {
  it("evaluates, accepts, and settles a valid timed-out delivery in simulation", async () => {
    const engine = createTestEngine();
    const fixture = await createContractFixture(engine, {
      prefix: "simulation-timeout",
      jobOverrides: {
        timeout_rules: {
          deliverySeconds: 60,
          evaluationSeconds: 1,
          buyerResponseSeconds: 1,
          automaticSettlementSeconds: 1,
          automaticRefundSeconds: 3_600,
        },
      },
    });
    const manifest = await signedManifest(
      fixture.seller,
      fixture.contract.id,
      { ok: true, value: "automatic" },
    );
    await engine.submitDelivery(
      fixture.seller.agent.id,
      fixture.contract.id,
      manifest,
    );
    const contract = engine.getContract(fixture.contract.id);
    const afterAllDeadlines = new Date(
      Math.max(
        Date.parse(contract.evaluationDeadline),
        Date.parse(contract.buyerResponseDeadline),
        Date.parse(contract.automaticSettlementAt),
      ) + 1_000,
    );

    await expect(engine.processTimeouts(afterAllDeadlines)).resolves.toEqual({
      expiredBids: 0,
      evaluatedDeliveries: 1,
      acceptedDeliveries: 1,
      refundedContracts: 0,
      settledContracts: 1,
    });
    expect(engine.getContract(contract.id).status).toBe("settled");
    expect(engine.stateView().settlements).toHaveLength(1);
  });

  it("evaluates and accepts in real mode without attempting automatic x402 settlement", async () => {
    const storage = new S3CompatibleArtifactStorage({
      client: new InMemoryS3CompatibleClient(),
      bucket: "production-timeout-test",
      maxBytes: 10_000,
    });
    const engine = createTestEngine({
      simulationMode: false,
      jwtSecret: "production-shaped-test-secret-over-thirty-two-bytes",
      artifactStorage: storage,
    });
    const buyer = await registerActor(engine, "real-timeout-buyer", ["buyer"]);
    const seller = await registerActor(engine, "real-timeout-seller", [
      "seller",
    ]);
    engine.importCapital({
      agentId: buyer.agent.id,
      amountMinor: 1_000n,
      originType: "marketplace_earned",
      sourceTransactionHash: "0xreal-timeout-earned-capital",
    });
    const fixture = await createContractFixture(engine, {
      prefix: "real-timeout",
      buyer,
      seller,
      fundBuyer: false,
      jobOverrides: {
        timeout_rules: {
          deliverySeconds: 60,
          evaluationSeconds: 1,
          buyerResponseSeconds: 1,
          automaticSettlementSeconds: 1,
          automaticRefundSeconds: 3_600,
        },
      },
    });
    const result = { ok: true, value: "awaiting x402 payment" };
    const bytes = canonicalJson(result);
    const stored = await engine.storeArtifact(seller.agent.id, {
      key: "timeouts/real-result.json",
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
    await engine.submitDelivery(
      seller.agent.id,
      fixture.contract.id,
      manifest,
    );
    const contract = engine.getContract(fixture.contract.id);
    const afterAllDeadlines = new Date(
      Math.max(
        Date.parse(contract.evaluationDeadline),
        Date.parse(contract.buyerResponseDeadline),
        Date.parse(contract.automaticSettlementAt),
      ) + 1_000,
    );

    await expect(engine.processTimeouts(afterAllDeadlines)).resolves.toEqual({
      expiredBids: 0,
      evaluatedDeliveries: 1,
      acceptedDeliveries: 1,
      refundedContracts: 0,
      settledContracts: 0,
    });
    expect(engine.getContract(contract.id).status).toBe("accepted");
    expect(engine.stateView().settlements).toHaveLength(0);
    expect(engine.stateView().paymentIntents).toHaveLength(0);
  });
});
