import { describe, expect, it } from "vitest";
import { MockPaymentAdapter, PaymentAdapterError } from "../src/index.js";

describe("MockPaymentAdapter", () => {
  it("verifies and settles an exact payment exactly once", async () => {
    const adapter = new MockPaymentAdapter({
      wallets: [
        {
          address: "buyer",
          asset: "USDC",
          balanceMinor: "1000000",
          signingSecret: "buyer-secret",
        },
        {
          address: "seller",
          asset: "USDC",
          balanceMinor: "0",
          signingSecret: "seller-secret",
        },
      ],
    });
    const requirement = await adapter.createPaymentRequirement({
      idempotencyKey: "requirement-1",
      amountMinor: "250000",
      asset: "USDC",
      payTo: "seller",
      resource: { url: "http://localhost/jobs/1" },
    });
    const payload = MockPaymentAdapter.createPaymentPayload(
      requirement,
      "buyer",
      "buyer-secret",
      { paymentId: "payment-1" },
    );
    const verification = await adapter.verifyPayment({
      paymentId: "payment-1",
      requirement,
      payload,
    });
    expect(verification.valid).toBe(true);

    const settlement = await adapter.settlePayment({
      idempotencyKey: "settlement-1",
      requirement,
      verification,
    });
    const repeated = await adapter.settlePayment({
      idempotencyKey: "settlement-1",
      requirement,
      verification,
    });
    expect(repeated.transactionHash).toBe(settlement.transactionHash);
    await expect(
      adapter.getWalletBalance("buyer", "USDC"),
    ).resolves.toMatchObject({
      balanceMinor: "750000",
    });
    await expect(
      adapter.getWalletBalance("seller", "USDC"),
    ).resolves.toMatchObject({
      balanceMinor: "250000",
    });
  });

  it("rejects reuse of a payment identifier with a different payload", async () => {
    const adapter = new MockPaymentAdapter({
      wallets: [
        {
          address: "buyer",
          asset: "USDC",
          balanceMinor: "1000",
          signingSecret: "secret",
        },
      ],
    });
    const requirement = await adapter.createPaymentRequirement({
      idempotencyKey: "requirement-2",
      amountMinor: "100",
      asset: "USDC",
      payTo: "seller",
      resource: { url: "http://localhost/jobs/2" },
    });
    const payload = MockPaymentAdapter.createPaymentPayload(
      requirement,
      "buyer",
      "secret",
      { paymentId: "replayed-payment", nonce: "first-nonce" },
    );
    expect(
      (
        await adapter.verifyPayment({
          paymentId: "replayed-payment",
          requirement,
          payload,
        })
      ).valid,
    ).toBe(true);
    const replay = {
      ...payload,
      nonce: "different-nonce",
    };
    const result = await adapter.verifyPayment({
      paymentId: "replayed-payment",
      requirement,
      payload: replay,
    });
    expect(result).toMatchObject({ valid: false, reason: "PAYMENT_REPLAYED" });
  });

  it("supports bounded partial and full refunds", async () => {
    const adapter = new MockPaymentAdapter({
      wallets: [
        {
          address: "buyer",
          asset: "USDC",
          balanceMinor: "1000",
          signingSecret: "secret",
        },
        {
          address: "seller",
          asset: "USDC",
          balanceMinor: "0",
          signingSecret: "seller",
        },
      ],
    });
    const requirement = await adapter.createPaymentRequirement({
      idempotencyKey: "requirement-3",
      amountMinor: "600",
      asset: "USDC",
      payTo: "seller",
      resource: { url: "http://localhost/jobs/3" },
    });
    const payload = MockPaymentAdapter.createPaymentPayload(
      requirement,
      "buyer",
      "secret",
      { paymentId: "refundable-payment" },
    );
    const verification = await adapter.verifyPayment({
      paymentId: "refundable-payment",
      requirement,
      payload,
    });
    const settlement = await adapter.settlePayment({
      idempotencyKey: "settlement-3",
      requirement,
      verification,
    });
    await expect(
      adapter.refundPayment({
        idempotencyKey: "refund-partial",
        transactionHash: settlement.transactionHash,
        amountMinor: "100",
      }),
    ).resolves.toMatchObject({ status: "partially_refunded" });
    await expect(
      adapter.refundPayment({
        idempotencyKey: "refund-rest",
        transactionHash: settlement.transactionHash,
      }),
    ).resolves.toMatchObject({ status: "refunded", amountMinor: "500" });
    await expect(
      adapter.refundPayment({
        idempotencyKey: "refund-too-much",
        transactionHash: settlement.transactionHash,
        amountMinor: "1",
      }),
    ).rejects.toBeInstanceOf(PaymentAdapterError);
  });
});
