import { buildApp } from "../../api/src/app.js";
import {
  earningAttestationPayload,
  testAttestationTemplate,
} from "@a2a402/provenance";
import { sha256 } from "@a2a402/shared";
import {
  ArtifactBuilderAgent,
  BuyerAgent,
  ResearchSellerAgent,
} from "./agents.js";
import { DemoApiError } from "./client.js";

export interface EconomyDemoResult {
  protocol: string;
  mode: "simulation";
  warning: string;
  proof: Record<string, unknown>;
  balances: Record<string, unknown>;
  fees: Record<string, unknown>;
  jobs: unknown[];
  transactions: unknown[];
  receipts: unknown[];
  provenance_lineage: unknown[];
  reputation: Record<string, unknown>;
  community: Record<string, unknown>;
  accounting_invariants: Record<string, unknown>;
}

export async function runEconomyDemo(
  options: { silent?: boolean } = {},
): Promise<EconomyDemoResult> {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const { server } = await buildApp({
    config: {
      nodeEnv: "test",
      paymentsMode: "mock",
      engine: {
        baseUrl: "http://localhost:3000",
        publicMarketUrl: "https://a2a402.market",
        domain: "a2a402.market",
        simulationMode: true,
        platformFeeBps: 500,
        jwtSecret: "demo-only-secret-that-is-at-least-thirty-two-bytes",
        nonceTtlSeconds: 300,
        tokenTtlSeconds: 900,
        maxJobAmountMinor: 100_000_000n,
        maxAgentDailySpendMinor: 250_000_000n,
        maxArtifactBytes: 10_000_000,
        communityMessagesPerMinute: 30,
      },
    },
  });
  await server.ready();
  try {
    const research = new ResearchSellerAgent(server);
    const builder = new ArtifactBuilderAgent(server);
    const buyer = new BuyerAgent(server);
    for (const agent of [research, builder, buyer]) {
      await agent.register();
      await agent.authenticate();
    }

    const researchListing = await research.request("POST", "/v1/listings", {
      type: "service",
      title: "Deterministic structured research",
      description:
        "Returns reproducible JSON research from a fixed simulation corpus.",
      input_schema: {
        type: "object",
        required: ["topic"],
        properties: { topic: { type: "string", minLength: 1 } },
        additionalProperties: false,
      },
      output_schema: researchOutputSchema(),
      maximum_execution_seconds: 300,
      price_minor: "1000000",
      asset: "USDC",
      required_capabilities: [],
      acceptance_rules: [
        { path: "$.source_count", operator: "gte", value: 2 },
        {
          path: "$.methodology",
          operator: "equals",
          value: "deterministic_demo_corpus",
        },
      ],
      artifact_mime_types: ["application/json"],
      license_terms: "a2a402-demo-research-license/0.1",
      tags: ["research", "deterministic"],
      policy_category: "analysis",
    });
    await builder.request("POST", "/v1/listings", {
      type: "digital_artifact",
      title: "Structured research artifact builder",
      description:
        "Transforms structured research into a deterministic licensed artifact.",
      input_schema: { type: "object" },
      output_schema: artifactOutputSchema(),
      maximum_execution_seconds: 300,
      price_minor: "500000",
      asset: "USDC",
      artifact_mime_types: ["application/json"],
      tags: ["artifact", "transform"],
      policy_category: "digital_artifact",
    });

    const humanLot = await buyer.request("POST", "/v1/provenance/deposits", {
      amount_minor: "3000000",
      asset: "USDC",
      origin_type: "human_seeded",
      source_transaction_hash: "human-demo-deposit-001",
    });
    const firstJob = await buyer.request("POST", "/v1/jobs", {
      listing_id: researchListing.id,
      type: "fixed_price",
      title: "Research Proof-of-Earn market controls",
      description:
        "Return deterministic structured findings about agent capital provenance.",
      input: { topic: "proof-of-earn marketplace controls" },
      output_schema: researchOutputSchema(),
      budget_minor: "1000000",
      asset: "USDC",
      required_capabilities: ["structured_web_research"],
      acceptance_rules: [
        { path: "$.source_count", operator: "gte", value: 2 },
        {
          path: "$.methodology",
          operator: "equals",
          value: "deterministic_demo_corpus",
        },
      ],
      artifact_mime_types: ["application/json"],
      tags: ["research", "proof-of-earn"],
      policy_category: "analysis",
    });
    const firstBid = await research.request(
      "POST",
      `/v1/jobs/${firstJob.id}/bids`,
      {
        amount_minor: "1000000",
        asset: "USDC",
        execution_seconds: 120,
        proposal: { strategy: "deterministic_demo_corpus" },
      },
    );
    let humanSeededRejected = false;
    let humanSeededFailure: Record<string, unknown> | null = null;
    try {
      await buyer.request("POST", `/v1/jobs/${firstJob.id}/accept-bid`, {
        bid_id: firstBid.id,
      });
    } catch (error) {
      if (
        error instanceof DemoApiError &&
        error.body.error.code === "INSUFFICIENT_ELIGIBLE_CAPITAL"
      ) {
        humanSeededRejected = true;
        humanSeededFailure = error.body.error;
      } else {
        throw error;
      }
    }
    if (!humanSeededRejected) {
      throw new Error(
        "Demo invariant failed: human-seeded funds were spendable.",
      );
    }

    const testTemplate = testAttestationTemplate(
      buyer.agentId!,
      buyer.walletAddress,
      builder.agentId!,
      builder.walletAddress,
      2_000_000n,
    );
    const { id: _testId, ...testUnsigned } = testTemplate;
    const issuerSignature = await builder.account.signMessage({
      message: earningAttestationPayload(testUnsigned),
    });
    const imported = await buyer.request(
      "POST",
      "/v1/provenance/attestations",
      {
        ...testTemplate,
        amountMinor: testTemplate.amountMinor.toString(),
        issuerSignature,
      },
    );
    if (imported.verification.classification !== "platform_test_funds") {
      throw new Error(
        "Simulation capital was not visibly labeled platform_test_funds.",
      );
    }
    const firstContract = await buyer.request(
      "POST",
      `/v1/jobs/${firstJob.id}/accept-bid`,
      { bid_id: firstBid.id },
    );
    const researchResult = research.deterministicResearch(
      "proof-of-earn marketplace controls",
    );
    const firstManifest = await research.signedDelivery({
      contractId: firstContract.id,
      result: researchResult,
      outputSchema: "https://a2a402.market/schemas/demo-research-output",
    });
    await research.request(
      "POST",
      `/v1/contracts/${firstContract.id}/deliver`,
      firstManifest as unknown as Record<string, unknown>,
    );
    const firstEvaluation = await buyer.request(
      "POST",
      `/v1/contracts/${firstContract.id}/evaluate`,
      {},
    );
    if (firstEvaluation.result !== "accepted") {
      throw new Error("First deterministic evaluation failed.");
    }
    await buyer.request("POST", `/v1/contracts/${firstContract.id}/accept`, {});
    const firstSettlement = await buyer.request(
      "POST",
      `/v1/contracts/${firstContract.id}/settle`,
      {},
    );

    const secondJob = await research.request("POST", "/v1/jobs", {
      type: "fixed_price",
      title: "Build a reusable artifact from completed research",
      description:
        "Transform research output into a deterministic machine-readable brief.",
      input: {
        source_job_id: firstJob.id,
        research_result_hash: sha256(JSON.stringify(researchResult)),
      },
      input_schema: { type: "object" },
      output_schema: artifactOutputSchema(),
      budget_minor: "500000",
      asset: "USDC",
      required_capabilities: ["artifact_generation"],
      acceptance_rules: [
        {
          path: "$.artifact_type",
          operator: "equals",
          value: "machine_readable_brief",
        },
        { path: "$.sections", operator: "present" },
      ],
      artifact_mime_types: ["application/json"],
      tags: ["artifact", "collaboration"],
      policy_category: "digital_artifact",
    });
    const secondBid = await builder.request(
      "POST",
      `/v1/jobs/${secondJob.id}/bids`,
      {
        amount_minor: "500000",
        asset: "USDC",
        execution_seconds: 120,
        proposal: { transform: "deterministic_brief_v1" },
      },
    );
    const secondContract = await research.request(
      "POST",
      `/v1/jobs/${secondJob.id}/accept-bid`,
      { bid_id: secondBid.id },
    );
    const artifactResult = builder.buildArtifact(firstJob.id);
    const secondManifest = await builder.signedDelivery({
      contractId: secondContract.id,
      result: artifactResult,
      outputSchema: "https://a2a402.market/schemas/demo-artifact-output",
    });
    await builder.request(
      "POST",
      `/v1/contracts/${secondContract.id}/deliver`,
      secondManifest as unknown as Record<string, unknown>,
    );
    const secondEvaluation = await research.request(
      "POST",
      `/v1/contracts/${secondContract.id}/evaluate`,
      {},
    );
    if (secondEvaluation.result !== "accepted") {
      throw new Error("Second deterministic evaluation failed.");
    }
    await research.request(
      "POST",
      `/v1/contracts/${secondContract.id}/accept`,
      {},
    );
    const secondSettlement = await research.request(
      "POST",
      `/v1/contracts/${secondContract.id}/settle`,
      {},
    );

    const channel = await buyer.request("POST", "/v1/community/channels", {
      slug: "completed-collaborations",
      description:
        "Signed machine-readable reports of completed agent collaboration.",
      minimum_completed_contracts: 0,
    });
    await research.request(
      "POST",
      `/v1/community/channels/${channel.id}/join`,
      {},
    );
    await builder.request(
      "POST",
      `/v1/community/channels/${channel.id}/join`,
      {},
    );
    const messageInput = await research.signedCommunityMessage({
      channelId: channel.id,
      type: "collaboration",
      content: {
        protocol: "a2a402/0.1",
        completed_contract_ids: [firstContract.id, secondContract.id],
        outcome: "research_and_artifact_chain_settled",
        proof_of_earn_chained: true,
      },
      tags: ["completed", "research", "artifact"],
      mentions: [buyer.agentId!, builder.agentId!],
    });
    const communityMessage = await research.request(
      "POST",
      "/v1/community/messages",
      messageInput,
    );

    const [buyerBalance, researchBalance, builderBalance] = await Promise.all([
      buyer.request("GET", `/v1/agents/${buyer.agentId}/balance`),
      research.request("GET", `/v1/agents/${research.agentId}/balance`),
      builder.request("GET", `/v1/agents/${builder.agentId}/balance`),
    ]);
    const [firstLineage, secondLineage] = await Promise.all([
      buyer.request(
        "GET",
        `/v1/provenance/capital-lots/${firstSettlement.sellerCapitalLotId}/lineage`,
      ),
      buyer.request(
        "GET",
        `/v1/provenance/capital-lots/${secondSettlement.sellerCapitalLotId}/lineage`,
      ),
    ]);
    const [buyerReputation, researchReputation, builderReputation] =
      await Promise.all([
        buyer.request("GET", `/v1/agents/${buyer.agentId}/reputation`),
        buyer.request("GET", `/v1/agents/${research.agentId}/reputation`),
        buyer.request("GET", `/v1/agents/${builder.agentId}/reputation`),
      ]);
    const stats = await buyer.request("GET", "/v1/stats");
    const jobs = await buyer.request("GET", "/v1/jobs?limit=100");
    const community = await buyer.request(
      "GET",
      `/v1/community/messages?channel_id=${channel.id}`,
    );
    const invariants = await buyer.request("GET", "/v1/accounting/invariants");
    const [firstTransaction, secondTransaction, firstReceipt, secondReceipt] =
      await Promise.all([
        buyer.request("GET", `/v1/transactions/${firstSettlement.id}`),
        buyer.request("GET", `/v1/transactions/${secondSettlement.id}`),
        buyer.request("GET", `/v1/receipts/${firstSettlement.receiptId}`),
        buyer.request("GET", `/v1/receipts/${secondSettlement.receiptId}`),
      ]);

    const report: EconomyDemoResult = {
      protocol: "a2a402/0.1",
      mode: "simulation",
      warning:
        "platform_test_funds are simulation-only and are not represented as genuine agent-earned capital.",
      proof: {
        agents_registered: 3,
        wallet_identities_verified: true,
        human_seeded_lot_id: humanLot.id,
        human_seeded_spend_rejected: humanSeededRejected,
        rejection: humanSeededFailure,
        imported_capital_classification: imported.verification.classification,
        first_transaction_funder: "platform_test_funds",
        second_transaction_funder: "marketplace_earned",
        first_contract_settled: firstContract.id,
        second_contract_settled: secondContract.id,
        chained_lineage_verified:
          secondLineage.parents?.[0]?.lot?.id ===
          firstSettlement.sellerCapitalLotId,
      },
      balances: {
        buyer: buyerBalance,
        research_seller_then_buyer: researchBalance,
        artifact_builder: builderBalance,
      },
      fees: {
        fee_basis_points: 500,
        first_fee_minor: firstSettlement.feeMinor,
        second_fee_minor: secondSettlement.feeMinor,
        total_fee_minor: stats.platformFeesMinor,
      },
      jobs: jobs.data,
      transactions: [firstTransaction, secondTransaction],
      receipts: [firstReceipt, secondReceipt],
      provenance_lineage: [firstLineage, secondLineage],
      reputation: {
        buyer: buyerReputation.snapshot,
        research: researchReputation.snapshot,
        builder: builderReputation.snapshot,
      },
      community: {
        channel_id: channel.id,
        message_id: communityMessage.id,
        published_messages: community.data,
      },
      accounting_invariants: invariants,
    };
    if (!report.proof.chained_lineage_verified) {
      throw new Error(
        "Demo invariant failed: second settlement lineage is not chained.",
      );
    }
    if (!options.silent) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    }
    return report;
  } finally {
    await server.close();
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
}

function researchOutputSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["topic", "findings", "methodology", "source_count"],
    properties: {
      topic: { type: "string" },
      findings: {
        type: "array",
        minItems: 2,
        items: {
          type: "object",
          required: ["claim", "evidence_id", "confidence_ppm"],
          properties: {
            claim: { type: "string" },
            evidence_id: { type: "string" },
            confidence_ppm: { type: "integer", minimum: 0, maximum: 1000000 },
          },
          additionalProperties: false,
        },
      },
      methodology: { const: "deterministic_demo_corpus" },
      source_count: { type: "integer", minimum: 2 },
    },
    additionalProperties: false,
  };
}

function artifactOutputSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: [
      "artifact_type",
      "title",
      "derived_from_job_id",
      "sections",
      "license",
    ],
    properties: {
      artifact_type: { const: "machine_readable_brief" },
      title: { type: "string" },
      derived_from_job_id: { type: "string" },
      sections: { type: "array", minItems: 2 },
      license: { type: "string" },
    },
    additionalProperties: false,
  };
}

const isMain =
  process.argv[1] &&
  import.meta.url
    .toLowerCase()
    .endsWith(process.argv[1].replaceAll("\\", "/").toLowerCase());
if (isMain) {
  await runEconomyDemo();
}
