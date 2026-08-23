import { describe, expect, it } from "vitest";
import {
  BASE_SEPOLIA_NETWORK,
  BASE_SEPOLIA_USDC,
  PaymentAdapterError,
  X402TestnetPaymentAdapter,
  type X402FacilitatorPort,
} from "../src/index.js";

const settlementAddress = "0x1111111111111111111111111111111111111111";

function fakeFacilitator(): X402FacilitatorPort {
  return {
    async verify() {
      return {
        isValid: true,
        payer: "0x2222222222222222222222222222222222222222",
      };
    },
    async settle(_payload, requirements) {
      return {
        success: true,
        payer: "0x2222222222222222222222222222222222222222",
        transaction: "0xsettled",
        network: requirements.network,
        amount: requirements.amount,
      };
    },
    async getSupported() {
      return { kinds: [], extensions: [], signers: {} };
    },
  } as X402FacilitatorPort;
}

describe("X402TestnetPaymentAdapter", () => {
  it("creates Base Sepolia requirements for a configured A2A402 contract", async () => {
    const tokenAddress = "0x4024024024024024024024024024024024024024";
    const adapter = new X402TestnetPaymentAdapter({
      platformSettlementAddress: settlementAddress,
      facilitator: fakeFacilitator(),
      assetAddress: tokenAddress,
      assetSymbol: "A2A402",
    });
    const requirement = await adapter.createPaymentRequirement({
      idempotencyKey: "a2a402-requirement",
      amountMinor: "1000000000000000000",
      asset: "A2A402",
      payTo: settlementAddress,
      resource: { url: "https://a2a402.market/contracts/a2a402" },
    });
    expect(requirement).toMatchObject({
      network: BASE_SEPOLIA_NETWORK,
      asset: "A2A402",
      amountMinor: "1000000000000000000",
      protocolData: { paymentRequirements: { asset: tokenAddress } },
    });
  });

  it("uses official facilitator verification and settlement on Base Sepolia", async () => {
    const adapter = new X402TestnetPaymentAdapter({
      platformSettlementAddress: settlementAddress,
      facilitator: fakeFacilitator(),
    });
    const requirement = await adapter.createPaymentRequirement({
      idempotencyKey: "x402-requirement",
      amountMinor: "100000",
      asset: "USDC",
      payTo: settlementAddress,
      resource: { url: "https://a2a402.market/contracts/1" },
    });
    expect(requirement).toMatchObject({
      network: BASE_SEPOLIA_NETWORK,
      protocolData: {
        paymentRequirements: {
          asset: BASE_SEPOLIA_USDC,
        },
      },
    });
    const payload = {
      x402Version: 2,
      resource: requirement.resource,
      accepted: requirement.protocolData.paymentRequirements,
      payload: { authorization: "signed-test-authorization" },
    };
    const verification = await adapter.verifyPayment({
      paymentId: "x402-payment",
      requirement,
      payload,
    });
    expect(verification.valid).toBe(true);
    const settlement = await adapter.settlePayment({
      idempotencyKey: "x402-settlement",
      requirement,
      verification,
    });
    expect(settlement).toMatchObject({
      transactionHash: "0xsettled",
      receipt: {
        network: BASE_SEPOLIA_NETWORK,
        amountMinor: "100000",
      },
    });
  });

  it("refuses mainnet and does not pretend exact payments support refunds", async () => {
    expect(
      () =>
        new X402TestnetPaymentAdapter({
          platformSettlementAddress: settlementAddress,
          facilitator: fakeFacilitator(),
          enableMainnet: true,
        }),
    ).toThrow(PaymentAdapterError);
    const adapter = new X402TestnetPaymentAdapter({
      platformSettlementAddress: settlementAddress,
      facilitator: fakeFacilitator(),
    });
    await expect(
      adapter.refundPayment({
        idempotencyKey: "x402-refund",
        transactionHash: "0xmissing",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_REFUND_UNSUPPORTED" });
  });
});
