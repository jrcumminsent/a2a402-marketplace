import { describe, expect, it } from "vitest";
import { runEconomyDemo } from "../apps/demo-agents/src/economy.js";

describe("three-agent Proof-of-Earn economy demonstration", () => {
  it("completes two chained transactions entirely through public marketplace APIs", async () => {
    const report = await runEconomyDemo({ silent: true });
    expect(report).toMatchObject({
      protocol: "a2a402/0.1",
      mode: "simulation",
      proof: {
        agents_registered: 3,
        wallet_identities_verified: true,
        human_seeded_spend_rejected: true,
        imported_capital_classification: "platform_test_funds",
        first_transaction_funder: "platform_test_funds",
        second_transaction_funder: "marketplace_earned",
        chained_lineage_verified: true,
      },
      fees: {
        fee_basis_points: 500,
        first_fee_minor: "50000",
        second_fee_minor: "25000",
        total_fee_minor: "75000",
      },
      accounting_invariants: {
        nonnegativeCapitalLots: true,
        nonnegativeAgentBalances: true,
      },
    });
    expect(report.warning).toContain("simulation-only");
    expect(report.jobs).toHaveLength(2);
    expect(report.transactions).toHaveLength(2);
    expect(report.receipts).toHaveLength(2);
    expect(report.provenance_lineage).toHaveLength(2);

    const proof = report.proof as Record<string, unknown>;
    expect(proof.first_contract_settled).toEqual(expect.any(String));
    expect(proof.second_contract_settled).toEqual(expect.any(String));
    expect(proof.first_contract_settled).not.toBe(
      proof.second_contract_settled,
    );
    expect(proof.rejection).toMatchObject({
      code: "INSUFFICIENT_ELIGIBLE_CAPITAL",
      details: {
        required_minor: "1000000",
        eligible_minor: "0",
        ineligible_minor: "3000000",
      },
    });

    const balances = report.balances as Record<string, Record<string, unknown>>;
    expect(balances.buyer).toMatchObject({
      ineligibleAvailableMinor: "3000000",
      eligibleAvailableMinor: "1000000",
    });
    expect(balances.research_seller_then_buyer).toMatchObject({
      eligibleAvailableMinor: "450000",
    });
    expect(balances.artifact_builder).toMatchObject({
      eligibleAvailableMinor: "475000",
    });

    const reputation = report.reputation as Record<
      string,
      Record<string, unknown>
    >;
    expect(reputation.research).toMatchObject({
      completedContracts: 1,
      totalVerifiedEarningsMinor: "950000",
      signature: expect.any(String),
    });
    expect(reputation.builder).toMatchObject({
      completedContracts: 1,
      totalVerifiedEarningsMinor: "475000",
      signature: expect.any(String),
    });
    expect(reputation.buyer).toMatchObject({
      evaluationAccuracyPpm: 1000000,
      signature: expect.any(String),
    });

    const community = report.community as Record<string, unknown>;
    expect(community.channel_id).toEqual(expect.any(String));
    expect(community.message_id).toEqual(expect.any(String));
    expect(community.published_messages).toEqual([
      expect.objectContaining({
        moderationStatus: "published",
        signature: expect.any(String),
      }),
    ]);
  }, 20_000);
});
