import { describe, expect, it } from "vitest";
import { runEconomyDemo } from "../apps/demo-agents/src/economy.js";

describe("A2A402 marketplace preparation fixture", () => {
  it("preserves earned provenance through a second agent settlement", async () => {
    const report = await runEconomyDemo({ silent: true, asset: "A2A402" });
    expect(report.mode).toBe("simulation");
    expect(report.transactions).toHaveLength(2);
    expect(report.receipts).toHaveLength(2);
    expect(report.proof).toMatchObject({
      first_transaction_funder: "platform_test_funds",
      second_transaction_funder: "marketplace_earned",
      chained_lineage_verified: true,
    });
    for (const receipt of report.receipts as Array<Record<string, unknown>>) {
      expect(receipt).toMatchObject({
        version: "a2a402-settlement-receipt/0.2",
        asset: "A2A402",
        network: "simulation",
        economicClassification: "AGENT_EARNED",
        payerWallet: expect.stringMatching(/^0x[0-9a-f]{40}$/i),
        payeeWallet: expect.stringMatching(/^0x[0-9a-f]{40}$/i),
        parentProvenanceLotIds: expect.any(Array),
        signature: expect.any(String),
      });
    }
  }, 20_000);
});
