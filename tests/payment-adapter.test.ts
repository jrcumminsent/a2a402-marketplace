import { describe, expect, it } from "vitest";
import { MockPaymentAdapter, type PaymentRequirement } from "@a2a402/payments";

async function requirementFor(
  adapter: MockPaymentAdapter,
  idempotencyKey = "requirement-key",
): Promise<PaymentRequirement> {
  return adapter.createPaymentRequirement({
    idempotencyKey,
    amountMinor: "1000",
    asset: "USDC",
    payTo: "seller-wallet",
    resource: {
      url: "https://a2a402.market/v1/contracts/contract-1/settle",
      description: "Exact-price contract settlement",
    },
  });
}

describe("mock payment adapter replay and idempotency controls", () => {
  it("rejects a changed payload that reuses a payment identifier", async () => {
    const adapter = new MockPaymentAdapter({
      wallets: [
        {
          address: "payer-wallet",
          asset: "USDC",
          balanceMinor: "5000",
          signingSecret: "payer-signing-secret",
        },
      ],
    });
    const requirement = await requirementFor(adapter);
    const firstPayload = MockPaymentAdapter.createPaymentPayload(
      requirement,
      "payer-wallet",
      "payer-signing-secret",
      { paymentId: "payment-replay-id", nonce: "nonce-one" },
    );
    const first = await adapter.verifyPayment({
      paymentId: "payment-replay-id",
      requirement,
      payload: firstPayload,
    });
    expect(first.valid).toBe(true);

    const replayPayload = MockPaymentAdapter.createPaymentPayload(
      requirement,
      "payer-wallet",
      "payer-signing-secret",
      { paymentId: "payment-replay-id", nonce: "nonce-two" },
    );
    const replay = await adapter.verifyPayment({
      paymentId: "payment-replay-id",
      requirement,
      payload: replayPayload,
    });
    expect(replay).toMatchObject({
      valid: false,
      paymentId: "payment-replay-id",
      reason: "PAYMENT_REPLAYED",
    });
  });

  it("settles an exact-price requirement once and returns the same result idempotently", async () => {
    const adapter = new MockPaymentAdapter({
      wallets: [
        {
          address: "payer-wallet",
          asset: "USDC",
          balanceMinor: "5000",
          signingSecret: "payer-signing-secret",
        },
      ],
    });
    const requirement = await requirementFor(adapter);
    const payload = MockPaymentAdapter.createPaymentPayload(
      requirement,
      "payer-wallet",
      "payer-signing-secret",
      { paymentId: "payment-to-settle" },
    );
    const verification = await adapter.verifyPayment({
      paymentId: payload.paymentId,
      requirement,
      payload,
    });
    expect(verification.valid).toBe(true);
    const first = await adapter.settlePayment({
      idempotencyKey: "settlement-idempotency-key",
      requirement,
      verification,
    });
    const duplicate = await adapter.settlePayment({
      idempotencyKey: "settlement-idempotency-key",
      requirement,
      verification,
    });
    expect(duplicate).toEqual(first);
    expect(
      await adapter.getWalletBalance("payer-wallet", "USDC"),
    ).toMatchObject({
      balanceMinor: "4000",
    });
    expect(
      await adapter.getWalletBalance("seller-wallet", "USDC"),
    ).toMatchObject({
      balanceMinor: "1000",
    });

    const secondPayload = MockPaymentAdapter.createPaymentPayload(
      requirement,
      "payer-wallet",
      "payer-signing-secret",
      { paymentId: "second-payment-same-requirement" },
    );
    const second = await adapter.verifyPayment({
      paymentId: secondPayload.paymentId,
      requirement,
      payload: secondPayload,
    });
    expect(second).toMatchObject({
      valid: false,
      reason: "PAYMENT_ALREADY_SETTLED",
    });
  });

  it("rejects reuse of a payment idempotency key with different economic input", async () => {
    const adapter = new MockPaymentAdapter();
    await requirementFor(adapter, "shared-requirement-key");
    await expect(
      adapter.createPaymentRequirement({
        idempotencyKey: "shared-requirement-key",
        amountMinor: "1001",
        asset: "USDC",
        payTo: "seller-wallet",
        resource: { url: "https://a2a402.market/another-resource" },
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_IDEMPOTENCY_CONFLICT" });
  });
});
