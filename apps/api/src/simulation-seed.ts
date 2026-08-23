import { privateKeyToAccount } from "viem/accounts";

import {
  CANONICAL_SEEDED_GENESIS_BUYER_CAPABILITY,
  CANONICAL_SEEDED_GENESIS_BUYER_WALLET,
  CANONICAL_SEEDED_GENESIS_DEFINITION_VERSION,
  canonicalSeededGenesisDefinition,
  canonicalSeededGenesisDefinitionDigest,
  type AgentRegistration,
  type MarketplaceEngine,
  marketplaceJobDefinitionDigest,
  registrationMessage,
} from "@a2a402/marketplace";
import { MarketplaceError } from "@a2a402/shared";

import type { MarketplaceRuntime } from "./runtime.js";

const SEED_PRIVATE_KEY = `0x${"42".repeat(32)}` as const;
const SEED_CAPABILITY = CANONICAL_SEEDED_GENESIS_BUYER_CAPABILITY;
const GENESIS_DEFINITION_TEMPLATE = canonicalSeededGenesisDefinition();

const SEED_TIMEOUT_RULES = GENESIS_DEFINITION_TEMPLATE.timeoutRules;

const JOBS = [
  {
    title: GENESIS_DEFINITION_TEMPLATE.title,
    description: GENESIS_DEFINITION_TEMPLATE.description,
    budget_minor: GENESIS_DEFINITION_TEMPLATE.budgetMinor.toString(),
    required_capabilities: [
      ...GENESIS_DEFINITION_TEMPLATE.requiredCapabilities,
    ],
    tags: [...GENESIS_DEFINITION_TEMPLATE.tags],
    input: GENESIS_DEFINITION_TEMPLATE.input,
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

const GENESIS_JOB = JOBS[0];

function matchesSeededJob(
  job: ReturnType<MarketplaceEngine["getJob"]>,
  buyerAgentId: string,
  definition: (typeof JOBS)[number],
): boolean {
  return (
    job.buyerAgentId === buyerAgentId &&
    job.title === definition.title &&
    definition.tags.every((tag) => job.tags.includes(tag))
  );
}

export function isCanonicalSeededGenesisJob(
  engine: MarketplaceEngine,
  jobId: string,
): boolean {
  if (!engine.config.simulationMode) return false;
  const expectedDefinitionDigest = canonicalSeededGenesisDefinitionDigest(
    engine.config.maxArtifactBytes,
  );
  const designation = engine.getCanonicalSeededGenesisDesignation();
  if (
    !designation ||
    designation.jobId !== jobId ||
    designation.definitionVersion !==
      CANONICAL_SEEDED_GENESIS_DEFINITION_VERSION ||
    designation.definitionDigest !== expectedDefinitionDigest
  ) {
    return false;
  }
  try {
    const job = engine.getJob(jobId);
    const buyer = engine.getAgent(designation.buyerAgentId);
    return (
      job.buyerAgentId === designation.buyerAgentId &&
      buyer.walletAddress === CANONICAL_SEEDED_GENESIS_BUYER_WALLET &&
      buyer.capabilities.includes(SEED_CAPABILITY) &&
      marketplaceJobDefinitionDigest(job) === expectedDefinitionDigest
    );
  } catch {
    return false;
  }
}

export async function ensureSimulationSeedOpportunities(
  engine: MarketplaceEngine,
  runtime: MarketplaceRuntime,
): Promise<void> {
  await runtime.runMutation(
    async () => {
      const account = privateKeyToAccount(SEED_PRIVATE_KEY);
      let buyer = engine
        .listAgents()
        .find(
          (agent) =>
            agent.walletAddress === account.address.toLowerCase() &&
            agent.capabilities.includes(SEED_CAPABILITY),
        );

      if (!buyer) {
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
        buyer = await engine.registerAgent({
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
      }

      const storedDesignation = engine.getCanonicalSeededGenesisDesignation();
      const expectedDefinitionDigest = canonicalSeededGenesisDefinitionDigest(
        engine.config.maxArtifactBytes,
      );
      if (
        storedDesignation &&
        !isCanonicalSeededGenesisJob(engine, storedDesignation.jobId)
      ) {
        throw new MarketplaceError(
          "CONFLICT",
          "The stored canonical seeded Genesis designation is invalid.",
          409,
          { canonical_job_id: storedDesignation.jobId },
        );
      }
      if (!storedDesignation) {
        const buyerJobs = engine.listJobs({ buyerAgentId: buyer.id });
        const exactGenesisJobs = buyerJobs.filter(
          (job) =>
            marketplaceJobDefinitionDigest(job) === expectedDefinitionDigest,
        );
        const genesisLikeJobs = buyerJobs.filter(
          (job) =>
            job.title === GENESIS_JOB.title || job.tags.includes("genesis"),
        );
        if (exactGenesisJobs.length !== 1 && genesisLikeJobs.length > 0) {
          throw new MarketplaceError(
            "CONFLICT",
            "Existing Genesis-like jobs cannot be identified unambiguously.",
            409,
            {
              exact_candidate_job_ids: exactGenesisJobs.map((job) => job.id),
              genesis_like_job_ids: genesisLikeJobs.map((job) => job.id),
            },
          );
        }
        if (exactGenesisJobs.length === 1) {
          engine.setCanonicalSeededGenesisJob({
            jobId: exactGenesisJobs[0]!.id,
            buyerAgentId: buyer.id,
            definitionVersion: CANONICAL_SEEDED_GENESIS_DEFINITION_VERSION,
            definitionDigest: expectedDefinitionDigest,
          });
        }
      }

      for (const job of JOBS) {
        const existingJob = engine
          .listJobs({ buyerAgentId: buyer.id })
          .find((candidate) => matchesSeededJob(candidate, buyer.id, job));
        if (existingJob) continue;
        const created = engine.createJob(buyer.id, {
          type: "open_bid",
          title: job.title,
          description: job.description,
          input: job.input,
          input_schema: { type: "object" },
          output_schema: { type: "object" },
          maximum_execution_seconds: 86_400,
          budget_minor: job.budget_minor,
          asset: "USDC",
          required_reputation: {},
          required_capabilities: [...job.required_capabilities],
          acceptance_rules: [],
          artifact_mime_types: ["application/json"],
          license_terms: "Marketplace output license",
          refund_rules: {},
          tags: [...job.tags],
          policy_category: "analysis",
          timeout_rules: { ...SEED_TIMEOUT_RULES },
        });
        if (job === GENESIS_JOB) {
          engine.setCanonicalSeededGenesisJob({
            jobId: created.id,
            buyerAgentId: buyer.id,
            definitionVersion: CANONICAL_SEEDED_GENESIS_DEFINITION_VERSION,
            definitionDigest: expectedDefinitionDigest,
          });
        }
      }
    },
    {
      mutationId: "simulation-seed-opportunities:v2",
      lockKeys: ["simulation-seed-opportunities"],
    },
  );
}
