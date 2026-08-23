import { privateKeyToAccount } from "viem/accounts";

import {
  type AgentRegistration,
  type MarketplaceEngine,
  registrationMessage,
} from "@a2a402/marketplace";

import type { MarketplaceRuntime } from "./runtime.js";

const SEED_PRIVATE_KEY = `0x${"42".repeat(32)}` as const;
const SEED_CAPABILITY = "a2a402_seed_buyer";

const JOBS = [
  {
    title: "Genesis: verify autonomous marketplace discovery",
    description:
      "Return a JSON report showing the discovery endpoints inspected, the canonical registration path used, and the TEST-only safeguards observed.",
    budget_minor: "400000",
    required_capabilities: ["protocol_analysis"],
    tags: ["genesis", "discovery", "seeded-test-job"],
    input: {
      discovery: "https://a2a402.market/api/discovery",
      onboarding: "https://a2a402.market/onboarding.json",
    },
  },
  {
    title: "Summarize an agent interoperability specification",
    description:
      "Return a concise JSON compatibility report for the supplied A2A402 discovery document.",
    budget_minor: "250000",
    required_capabilities: ["protocol_analysis"],
    tags: ["a2a", "interoperability", "seeded-test-job"],
    input: { url: "https://a2a402.market/api/discovery" },
  },
  {
    title: "Validate a machine-readable opportunity feed",
    description:
      "Inspect the public opportunity feed and return deterministic schema and safety findings as JSON.",
    budget_minor: "200000",
    required_capabilities: ["json_validation"],
    tags: ["validation", "opportunities", "seeded-test-job"],
    input: { url: "https://a2a402.market/api/opportunities" },
  },
  {
    title: "Draft an agent-to-agent service capability card",
    description:
      "Produce a bounded JSON capability-card draft for a fictional autonomous research service.",
    budget_minor: "150000",
    required_capabilities: ["agent_card_authoring"],
    tags: ["agent-card", "service-design", "seeded-test-job"],
    input: { service: "autonomous research brief" },
  },
] as const;

export async function ensureSimulationSeedOpportunities(
  engine: MarketplaceEngine,
  runtime: MarketplaceRuntime,
): Promise<void> {
  await runtime.runMutation(
    async () => {
      const existing = engine
        .listAgents()
        .find((agent) => agent.capabilities.includes(SEED_CAPABILITY));
      if (existing) return;

      const account = privateKeyToAccount(SEED_PRIVATE_KEY);
      const unsigned: Omit<AgentRegistration, "registration_signature"> = {
        wallet_address: account.address.toLowerCase() as `0x${string}`,
        signing_key: account.address.toLowerCase() as `0x${string}`,
        external_agent_card_url: null,
        capabilities: [SEED_CAPABILITY],
        input_modalities: ["application/json"],
        output_modalities: ["application/json"],
      };
      const registration_signature = await account.signMessage({
        message: registrationMessage(unsigned),
      });
      const buyer = await engine.registerAgent({
        ...unsigned,
        registration_signature,
      });
      engine.importCapital({
        agentId: buyer.id,
        amountMinor: "1400000",
        asset: "USDC",
        originType: "platform_test_funds",
        provenanceScope: "simulation",
        sourceTransactionHash: "test:a2a402-seeded-opportunities-v1",
      });
      for (const job of JOBS) {
        engine.createJob(buyer.id, {
          type: "open_bid",
          title: job.title,
          description: job.description,
          input: job.input,
          input_schema: { type: "object" },
          output_schema: { type: "object" },
          budget_minor: job.budget_minor,
          asset: "USDC",
          required_capabilities: [...job.required_capabilities],
          acceptance_rules: [],
          artifact_mime_types: ["application/json"],
          tags: [...job.tags],
          policy_category: "analysis",
          timeout_rules: {
            bidExpirationSeconds: 31_536_000,
            sellerAcceptanceSeconds: 86_400,
            deliverySeconds: 604_800,
            evaluationSeconds: 86_400,
            buyerResponseSeconds: 86_400,
            automaticRefundSeconds: 1_209_600,
            automaticSettlementSeconds: 604_800,
          },
        });
      }
    },
    {
      mutationId: "simulation-seed-opportunities:v1",
      lockKeys: ["simulation-seed-opportunities"],
    },
  );
}
