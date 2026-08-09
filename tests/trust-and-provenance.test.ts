import { describe, expect, it } from "vitest";
import { verifyMessage } from "viem";
import { MarketplaceEngine, communityMessageToSign } from "@a2a402/marketplace";
import {
  DeterministicTestVerifier,
  earningAttestationPayload,
  testAttestationTemplate,
  type EarningAttestation,
} from "@a2a402/provenance";
import { canonicalJson, sha256, uuid } from "@a2a402/shared";
import {
  createContractFixture,
  createTestEngine,
  registerActor,
  settleFixture,
  verifyPlatformValue,
} from "./helpers/marketplace-fixtures.js";

async function signedTestAttestation(input: {
  issuer: Awaited<ReturnType<typeof registerActor>>;
  recipient: Awaited<ReturnType<typeof registerActor>>;
  amountMinor?: bigint;
}): Promise<EarningAttestation> {
  const template = testAttestationTemplate(
    input.recipient.agent.id,
    input.recipient.agent.walletAddress,
    input.issuer.agent.id,
    input.issuer.agent.walletAddress,
    input.amountMinor ?? 1_000n,
  );
  const { id: _id, ...unsigned } = template;
  const issuerSignature = await input.issuer.account.signMessage({
    message: earningAttestationPayload(unsigned),
  });
  return { ...template, issuerSignature };
}

describe("external earning replay protection", () => {
  it("imports verified simulation earnings once and rejects replay IDs or transaction hashes", async () => {
    const engine = createTestEngine();
    const issuer = await registerActor(engine, "attestation-issuer");
    const recipient = await registerActor(engine, "attestation-recipient");
    const attestation = await signedTestAttestation({ issuer, recipient });
    const verifier = new DeterministicTestVerifier();

    const imported = await engine.importEarningAttestation(
      recipient.agent.id,
      attestation,
      verifier,
    );
    expect(imported).toMatchObject({
      verification: {
        verified: true,
        classification: "platform_test_funds",
      },
    });
    expect(imported.capitalLotId).toEqual(expect.any(String));
    expect(engine.getBalance(recipient.agent.id)).toMatchObject({
      eligibleAvailableMinor: 1_000n,
      byOrigin: {
        platform_test_funds: {
          availableMinor: 1_000n,
          reservedMinor: 0n,
        },
      },
    });

    await expect(
      engine.importEarningAttestation(
        recipient.agent.id,
        {
          ...attestation,
          id: uuid(),
          paymentTransactionHash: `test:${uuid()}`,
        },
        verifier,
      ),
    ).rejects.toMatchObject({
      code: "PAYMENT_REPLAYED",
      statusCode: 409,
    });
    await expect(
      engine.importEarningAttestation(
        recipient.agent.id,
        {
          ...attestation,
          id: uuid(),
          replayProtectionId: uuid(),
        },
        verifier,
      ),
    ).rejects.toMatchObject({
      code: "PAYMENT_REPLAYED",
      statusCode: 409,
    });
    expect(engine.getCapitalLots(recipient.agent.id)).toHaveLength(1);
  });

  it("rejects self-attestation before any capital lot is created", async () => {
    const engine = createTestEngine();
    const actor = await registerActor(engine, "self-attestation");
    const template = testAttestationTemplate(
      actor.agent.id,
      actor.agent.walletAddress,
      actor.agent.id,
      actor.agent.walletAddress,
      500n,
    );
    const attestation: EarningAttestation = {
      ...template,
      issuerSignature: await actor.account.signMessage({ message: "self" }),
    };
    await expect(
      engine.importEarningAttestation(
        actor.agent.id,
        attestation,
        new DeterministicTestVerifier(),
      ),
    ).rejects.toMatchObject({ code: "PROVENANCE_INVALID" });
    expect(engine.getCapitalLots(actor.agent.id)).toHaveLength(0);
  });
});

describe("reputation and explainable provenance risk signals", () => {
  it("updates machine-useful reputation and signs a digest-verifiable snapshot", async () => {
    const engine = createTestEngine();
    const fixture = await createContractFixture(engine, {
      prefix: "signed-reputation",
    });
    await settleFixture(engine, fixture);

    const { events, snapshot } = engine.getReputation(fixture.seller.agent.id);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "schema_compliant",
        "contract_completed",
        "on_time",
      ]),
    );
    expect(snapshot).toMatchObject({
      agentId: fixture.seller.agent.id,
      completedContracts: 1,
      failedContracts: 0,
      schemaComplianceRatePpm: 1_000_000,
      onTimeDeliveryRatePpm: 1_000_000,
      totalVerifiedEarningsMinor: 950n,
      riskFlags: [],
    });
    const { signature, digest, ...metrics } = snapshot;
    expect(digest).toBe(sha256(canonicalJson(metrics)));
    expect(signature).toEqual(expect.any(String));
    expect(
      verifyPlatformValue(engine, { ...metrics, digest }, signature!),
    ).toBe(true);
  });

  it("flags a seller that reuses an identical artifact across settled contracts", async () => {
    const engine = createTestEngine();
    const seller = await registerActor(engine, "reused-artifact-seller", [
      "seller",
    ]);
    const buyerA = await registerActor(engine, "reused-artifact-buyer-a", [
      "buyer",
    ]);
    const buyerB = await registerActor(engine, "reused-artifact-buyer-b", [
      "buyer",
    ]);
    const result = { ok: true, value: "same-output" };
    const first = await createContractFixture(engine, {
      prefix: "reused-first",
      buyer: buyerA,
      seller,
      amountMinor: 500n,
    });
    await settleFixture(engine, first, result);
    const second = await createContractFixture(engine, {
      prefix: "reused-second",
      buyer: buyerB,
      seller,
      amountMinor: 500n,
    });
    await settleFixture(engine, second, result);

    const flags = engine.getReputation(seller.agent.id).snapshot.riskFlags;
    expect(flags).toContainEqual(
      expect.objectContaining({
        code: "REUSED_ARTIFACT",
        severity: "medium",
        evidenceIds: expect.arrayContaining([
          first.contract.id,
          second.contract.id,
        ]),
      }),
    );
  });

  it("flags a circular A-to-B-to-A economic provenance cycle", async () => {
    const engine = createTestEngine();
    const agentA = await registerActor(engine, "cycle-agent-a", [
      "buyer",
      "seller",
    ]);
    const agentB = await registerActor(engine, "cycle-agent-b", [
      "buyer",
      "seller",
    ]);
    const first = await createContractFixture(engine, {
      prefix: "cycle-a-to-b",
      buyer: agentA,
      seller: agentB,
      amountMinor: 1_000n,
    });
    const firstSettlement = await settleFixture(engine, first, {
      ok: true,
      value: "a-to-b",
    });
    const second = await createContractFixture(engine, {
      prefix: "cycle-b-to-a",
      buyer: agentB,
      seller: agentA,
      amountMinor: 500n,
      fundBuyer: false,
    });
    const secondSettlement = await settleFixture(engine, second, {
      ok: true,
      value: "b-to-a",
    });

    const secondLineage = engine.getProvenanceLineage(
      secondSettlement.settlement.sellerCapitalLotId,
    );
    expect(secondLineage.parents[0]?.lot.id).toBe(
      firstSettlement.settlement.sellerCapitalLotId,
    );
    const flagsA = engine.getReputation(agentA.agent.id).snapshot.riskFlags;
    const flagsB = engine.getReputation(agentB.agent.id).snapshot.riskFlags;
    for (const flags of [flagsA, flagsB]) {
      expect(flags).toContainEqual(
        expect.objectContaining({
          code: "CIRCULAR_TRANSACTION_PATTERN",
          evidenceIds: expect.arrayContaining([
            first.contract.id,
            second.contract.id,
          ]),
        }),
      );
      expect(flags).toContainEqual(
        expect.objectContaining({ code: "RECIPROCAL_TRADING" }),
      );
    }
  });
});

describe("signed community messages", () => {
  it("rejects a forged author signature and publishes the correctly signed message", async () => {
    const engine = createTestEngine();
    const owner = await registerActor(engine, "community-owner");
    const member = await registerActor(engine, "community-member");
    const forger = await registerActor(engine, "community-forger");
    const channel = engine.createCommunityChannel(owner.agent.id, {
      slug: "signed-collaboration",
      description: "Signed machine-readable collaboration events.",
      minimum_completed_contracts: 0,
    });
    engine.joinCommunityChannel(member.agent.id, channel.id);
    const unsigned = {
      channel_id: channel.id,
      author_agent_id: member.agent.id,
      type: "collaboration" as const,
      content_type: "application/json" as const,
      content: { status: "ready", protocol: "a2a402/0.1" },
      tags: ["collaboration", "signed"],
      mentions: [owner.agent.id],
      reply_to: null,
      expires_at: null,
    };
    const forgedSignature = await forger.account.signMessage({
      message: communityMessageToSign(unsigned),
    });
    await expect(
      engine.postCommunityMessage(member.agent.id, {
        ...unsigned,
        signature: forgedSignature,
      }),
    ).rejects.toMatchObject({ code: "SIGNATURE_INVALID" });
    expect(
      engine.listCommunityMessages({ channelId: channel.id }),
    ).toHaveLength(0);

    const signature = await member.account.signMessage({
      message: communityMessageToSign(unsigned),
    });
    const published = await engine.postCommunityMessage(member.agent.id, {
      ...unsigned,
      signature,
    });
    expect(published).toMatchObject({
      channelId: channel.id,
      authorAgentId: member.agent.id,
      moderationStatus: "published",
      content: unsigned.content,
      tags: unsigned.tags,
      mentions: unsigned.mentions,
    });
    expect(
      await verifyMessage({
        address: member.agent.signingKey,
        message: communityMessageToSign(unsigned),
        signature: published.signature,
      }),
    ).toBe(true);
    expect(engine.listCommunityMessages({ channelId: channel.id })).toEqual([
      published,
    ]);
  });
});

describe("signed webhooks", () => {
  it("signs each outbox delivery and rejects tampered, stale, or wrongly keyed payloads", async () => {
    const engine = createTestEngine();
    const actor = await registerActor(engine, "webhook-owner", ["seller"]);
    const secret = "test-webhook-secret-at-least-24-characters";
    const subscription = engine.registerWebhook(actor.agent.id, {
      url: "http://webhook.example.test/events",
      eventTypes: ["*"],
      secret,
    });
    engine.createListing(actor.agent.id, {
      type: "service",
      title: "Webhook-producing listing",
      description: "Creates a signed outbox event.",
      output_schema: { type: "object" },
      price_minor: "100",
    });

    let callbackCount = 0;
    const dispatch = await engine.dispatchOutbox(
      async ({ event, deliveryId, timestamp, signature }) => {
        callbackCount += 1;
        expect(
          MarketplaceEngine.verifyWebhookSignature({
            secret,
            deliveryId,
            timestamp,
            payload: event.payload,
            signature,
          }),
        ).toBe(true);
        expect(
          MarketplaceEngine.verifyWebhookSignature({
            secret,
            deliveryId,
            timestamp,
            payload: { tampered: true },
            signature,
          }),
        ).toBe(false);
        return true;
      },
      (subscriptionId) => (subscriptionId === subscription.id ? secret : null),
    );
    expect(callbackCount).toBeGreaterThan(0);
    expect(dispatch).toEqual({
      delivered: callbackCount,
      failed: 0,
      deadLettered: 0,
    });
    expect(engine.listOutboxEvents("delivered")).toHaveLength(callbackCount);

    const timestamp = new Date().toISOString();
    const payload = { event: "test" };
    const captured: {
      deliveryId?: string;
      signature?: string;
    } = {};
    engine.createListing(actor.agent.id, {
      type: "service",
      title: "Second webhook event",
      description: "Captures a signature for negative verification.",
      output_schema: { type: "object" },
      price_minor: "101",
    });
    await engine.dispatchOutbox(
      async ({ deliveryId, signature }) => {
        captured.deliveryId = deliveryId;
        captured.signature = signature;
        return true;
      },
      () => secret,
    );
    expect(captured.deliveryId).toEqual(expect.any(String));
    expect(captured.signature).toEqual(expect.any(String));
    expect(
      MarketplaceEngine.verifyWebhookSignature({
        secret: `${secret}-wrong`,
        deliveryId: captured.deliveryId!,
        timestamp,
        payload,
        signature: captured.signature!,
      }),
    ).toBe(false);
    expect(
      MarketplaceEngine.verifyWebhookSignature({
        secret,
        deliveryId: "irrelevant",
        timestamp: new Date(Date.now() - 6 * 60_000).toISOString(),
        payload,
        signature: "0".repeat(64),
      }),
    ).toBe(false);
  });
});
