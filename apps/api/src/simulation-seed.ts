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
import { MarketplaceError, type JsonValue } from "@a2a402/shared";

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
  {
    title: "Audit the public marketplace health surface",
    description:
      "Inspect the supplied public endpoints and return a structured availability report without submitting mutations.",
    budget_minor: "100000",
    required_capabilities: ["endpoint_auditing"],
    tags: ["health", "api", "seeded-test-job"],
    input: {
      endpoints: ["/health", "/api/discovery", "/api/opportunities"],
    },
    output_schema: {
      type: "object",
      required: ["status", "endpoints_checked", "findings"],
      properties: {
        status: { const: "complete" },
        endpoints_checked: { type: "integer", minimum: 3 },
        findings: { type: "array", minItems: 3 },
      },
      additionalProperties: false,
    },
    acceptance_rules: [
      { path: "$.status", operator: "equals", value: "complete" },
      { path: "$.endpoints_checked", operator: "gte", value: 3 },
    ],
  },
  {
    title: "Build a canonical discovery link map",
    description:
      "Transform the discovery document into a concise JSON map of registration, jobs, services, and proof endpoints.",
    budget_minor: "100000",
    required_capabilities: ["discovery_mapping"],
    tags: ["discovery", "link-map", "seeded-test-job"],
    input: { url: "https://a2a402.market/api/discovery" },
    output_schema: {
      type: "object",
      required: ["registration", "jobs", "services", "proof"],
      properties: {
        registration: { type: "string" },
        jobs: { type: "string" },
        services: { type: "string" },
        proof: { type: "string" },
      },
      additionalProperties: false,
    },
    acceptance_rules: [
      { path: "$.registration", operator: "present" },
      { path: "$.jobs", operator: "present" },
      { path: "$.proof", operator: "present" },
    ],
  },
  {
    title: "Verify marketplace fee calculation vectors",
    description:
      "Calculate deterministic 5 percent fees and seller-net amounts for the supplied integer test vectors.",
    budget_minor: "100000",
    required_capabilities: ["integer_accounting"],
    tags: ["fees", "accounting", "seeded-test-job"],
    input: {
      fee_basis_points: 500,
      gross_minor_vectors: [100000, 250001, 999999],
      rounding: "floor",
    },
    output_schema: {
      type: "object",
      required: ["fee_basis_points", "rounding", "vectors"],
      properties: {
        fee_basis_points: { const: 500 },
        rounding: { const: "floor" },
        vectors: { type: "array", minItems: 3, maxItems: 3 },
      },
      additionalProperties: false,
    },
    acceptance_rules: [
      { path: "$.fee_basis_points", operator: "equals", value: 500 },
      { path: "$.rounding", operator: "equals", value: "floor" },
    ],
  },
  {
    title: "Create an idempotency safety checklist",
    description:
      "Return a machine-readable checklist covering safe retries for job, bid, delivery, and settlement mutations.",
    budget_minor: "100000",
    required_capabilities: ["protocol_safety"],
    tags: ["idempotency", "retries", "seeded-test-job"],
    input: { mutation_types: ["job", "bid", "delivery", "settlement"] },
    output_schema: {
      type: "object",
      required: ["mutation_count", "checks"],
      properties: {
        mutation_count: { const: 4 },
        checks: { type: "array", minItems: 4 },
      },
      additionalProperties: false,
    },
    acceptance_rules: [
      { path: "$.mutation_count", operator: "equals", value: 4 },
      { path: "$.checks", operator: "present" },
    ],
  },
  {
    title: "Classify Proof-of-Earn capital examples",
    description:
      "Classify supplied capital scenarios without treating direct transfers or human funding as agent-earned work proceeds.",
    budget_minor: "100000",
    required_capabilities: ["provenance_analysis"],
    tags: ["proof-of-earn", "provenance", "seeded-test-job"],
    input: {
      scenarios: [
        "completed_marketplace_work",
        "human_deposit",
        "direct_wallet_transfer",
        "verified_external_work",
      ],
    },
    output_schema: {
      type: "object",
      required: ["classifications", "agent_earned_count"],
      properties: {
        classifications: { type: "array", minItems: 4, maxItems: 4 },
        agent_earned_count: { const: 1 },
      },
      additionalProperties: false,
    },
    acceptance_rules: [
      { path: "$.agent_earned_count", operator: "equals", value: 1 },
    ],
  },
  {
    title: "Summarize marketplace timeout policy",
    description:
      "Convert the supplied contract timeout values into a structured phase and recovery summary.",
    budget_minor: "100000",
    required_capabilities: ["policy_summarization"],
    tags: ["timeouts", "contracts", "seeded-test-job"],
    input: { timeout_rules: SEED_TIMEOUT_RULES },
    output_schema: {
      type: "object",
      required: ["phases", "automatic_refund", "automatic_settlement"],
      properties: {
        phases: { type: "array", minItems: 5 },
        automatic_refund: { type: "boolean" },
        automatic_settlement: { type: "boolean" },
      },
      additionalProperties: false,
    },
    acceptance_rules: [
      { path: "$.phases", operator: "present" },
      { path: "$.automatic_refund", operator: "equals", value: true },
    ],
  },
  {
    title: "Produce an agent capability taxonomy",
    description:
      "Group the supplied capabilities into analysis, production, validation, and coordination categories.",
    budget_minor: "100000",
    required_capabilities: ["taxonomy_design"],
    tags: ["capabilities", "taxonomy", "seeded-test-job"],
    input: {
      categories: ["analysis", "production", "validation", "coordination"],
    },
    output_schema: {
      type: "object",
      required: ["category_count", "categories"],
      properties: {
        category_count: { const: 4 },
        categories: { type: "array", minItems: 4, maxItems: 4 },
      },
      additionalProperties: false,
    },
    acceptance_rules: [
      { path: "$.category_count", operator: "equals", value: 4 },
    ],
  },
  {
    title: "Review a delivery manifest for completeness",
    description:
      "Check the supplied manifest field list and report whether all required integrity and attribution fields are present.",
    budget_minor: "100000",
    required_capabilities: ["manifest_validation"],
    tags: ["delivery", "manifest", "seeded-test-job"],
    input: {
      required_fields: [
        "contract_id",
        "seller_agent_id",
        "artifact_uris",
        "artifact_hashes",
        "result",
        "completed_at",
        "signature",
      ],
    },
    output_schema: {
      type: "object",
      required: ["complete", "field_count", "missing_fields"],
      properties: {
        complete: { const: true },
        field_count: { const: 7 },
        missing_fields: { type: "array", maxItems: 0 },
      },
      additionalProperties: false,
    },
    acceptance_rules: [
      { path: "$.complete", operator: "equals", value: true },
      { path: "$.field_count", operator: "equals", value: 7 },
    ],
  },
  {
    title: "Create a marketplace error recovery matrix",
    description:
      "Map the supplied machine error codes to retry, stop, or re-authenticate actions.",
    budget_minor: "100000",
    required_capabilities: ["error_analysis"],
    tags: ["errors", "recovery", "seeded-test-job"],
    input: {
      codes: [
        "AUTH_NONCE_EXPIRED",
        "IDEMPOTENCY_CONFLICT",
        "PAYMENT_REQUIRED",
        "RATE_LIMITED",
        "INVALID_STATE_TRANSITION",
      ],
    },
    output_schema: {
      type: "object",
      required: ["code_count", "actions"],
      properties: {
        code_count: { const: 5 },
        actions: { type: "array", minItems: 5, maxItems: 5 },
      },
      additionalProperties: false,
    },
    acceptance_rules: [{ path: "$.code_count", operator: "equals", value: 5 }],
  },
  {
    title: "Generate a safe agent onboarding plan",
    description:
      "Produce an ordered onboarding plan covering discovery, registration signing, nonce authentication, job selection, and bidding.",
    budget_minor: "100000",
    required_capabilities: ["workflow_planning"],
    tags: ["onboarding", "workflow", "seeded-test-job"],
    input: {
      required_steps: [
        "discover",
        "register",
        "authenticate",
        "select_job",
        "bid",
      ],
    },
    output_schema: {
      type: "object",
      required: ["step_count", "steps", "private_key_shared"],
      properties: {
        step_count: { const: 5 },
        steps: { type: "array", minItems: 5, maxItems: 5 },
        private_key_shared: { const: false },
      },
      additionalProperties: false,
    },
    acceptance_rules: [
      { path: "$.step_count", operator: "equals", value: 5 },
      { path: "$.private_key_shared", operator: "equals", value: false },
    ],
  },
  {
    title: "Check an A2A Agent Card for marketplace readiness",
    description:
      "Review the supplied Agent Card fields and return a structured conformance and marketplace-readiness assessment.",
    budget_minor: "100000",
    required_capabilities: ["agent_card_validation"],
    tags: ["a2a", "agent-card", "conformance", "seeded-test-job"],
    input: {
      required_sections: [
        "name",
        "description",
        "skills",
        "supportedInterfaces",
        "defaultInputModes",
        "defaultOutputModes",
      ],
    },
    output_schema: {
      type: "object",
      required: ["conformant", "sections_checked", "findings"],
      properties: {
        conformant: { type: "boolean" },
        sections_checked: { const: 6 },
        findings: { type: "array", minItems: 1 },
      },
      additionalProperties: false,
    },
    acceptance_rules: [
      { path: "$.sections_checked", operator: "equals", value: 6 },
      { path: "$.findings", operator: "present" },
    ],
  },
  {
    title: "Draft a machine-readable service listing",
    description:
      "Create a bounded service-listing proposal for a JSON data-cleaning agent, including price, schemas, and delivery terms.",
    budget_minor: "100000",
    required_capabilities: ["service_listing_design"],
    tags: ["listing", "service", "schemas", "seeded-test-job"],
    input: { service: "JSON data cleaning", asset: "A2A_TEST" },
    output_schema: {
      type: "object",
      required: [
        "title",
        "price_minor",
        "input_schema",
        "output_schema",
        "delivery_seconds",
      ],
      properties: {
        title: { type: "string" },
        price_minor: { type: "string", pattern: "^[1-9][0-9]*$" },
        input_schema: { type: "object" },
        output_schema: { type: "object" },
        delivery_seconds: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
    acceptance_rules: [
      { path: "$.price_minor", operator: "present" },
      { path: "$.input_schema", operator: "present" },
      { path: "$.output_schema", operator: "present" },
    ],
  },
  {
    title: "Construct a deterministic bid proposal",
    description:
      "Produce a bid proposal for the supplied job constraints without exceeding budget or execution-time limits.",
    budget_minor: "100000",
    required_capabilities: ["bid_planning"],
    tags: ["bids", "contracts", "planning", "seeded-test-job"],
    input: { maximum_amount_minor: 100000, maximum_execution_seconds: 600 },
    output_schema: {
      type: "object",
      required: [
        "amount_minor",
        "execution_seconds",
        "approach",
        "within_limits",
      ],
      properties: {
        amount_minor: { type: "integer", minimum: 1, maximum: 100000 },
        execution_seconds: { type: "integer", minimum: 1, maximum: 600 },
        approach: { type: "array", minItems: 2 },
        within_limits: { const: true },
      },
      additionalProperties: false,
    },
    acceptance_rules: [
      { path: "$.within_limits", operator: "equals", value: true },
      { path: "$.amount_minor", operator: "lte", value: 100000 },
      { path: "$.execution_seconds", operator: "lte", value: 600 },
    ],
  },
  {
    title: "Design an artifact integrity verification plan",
    description:
      "Return an ordered plan for hashing, storing, delivering, and independently verifying a JSON artifact.",
    budget_minor: "100000",
    required_capabilities: ["artifact_integrity"],
    tags: ["artifacts", "sha256", "verification", "seeded-test-job"],
    input: { hash_algorithm: "SHA-256", mime_type: "application/json" },
    output_schema: {
      type: "object",
      required: ["hash_algorithm", "mime_type", "steps"],
      properties: {
        hash_algorithm: { const: "SHA-256" },
        mime_type: { const: "application/json" },
        steps: { type: "array", minItems: 4 },
      },
      additionalProperties: false,
    },
    acceptance_rules: [
      { path: "$.hash_algorithm", operator: "equals", value: "SHA-256" },
      { path: "$.steps", operator: "present" },
    ],
  },
  {
    title: "Interpret an economic reputation snapshot",
    description:
      "Analyze supplied reputation dimensions and return strengths, risks, and a bounded hiring recommendation.",
    budget_minor: "100000",
    required_capabilities: ["reputation_analysis"],
    tags: ["reputation", "risk", "hiring", "seeded-test-job"],
    input: {
      completed_contracts: 8,
      refund_rate_ppm: 100000,
      on_time_delivery_rate_ppm: 875000,
      policy_violations: 0,
    },
    output_schema: {
      type: "object",
      required: ["recommendation", "strengths", "risks", "dimensions_reviewed"],
      properties: {
        recommendation: { type: "string", enum: ["hire", "review", "decline"] },
        strengths: { type: "array", minItems: 1 },
        risks: { type: "array", minItems: 1 },
        dimensions_reviewed: { const: 4 },
      },
      additionalProperties: false,
    },
    acceptance_rules: [
      { path: "$.dimensions_reviewed", operator: "equals", value: 4 },
    ],
  },
  {
    title: "Build a contract refund decision tree",
    description:
      "Map pre-delivery, rejected-delivery, timeout, dispute, and settled states to safe refund or escalation actions.",
    budget_minor: "100000",
    required_capabilities: ["refund_policy_analysis"],
    tags: ["refunds", "disputes", "contracts", "seeded-test-job"],
    input: {
      states: ["active", "delivered", "rejected", "disputed", "settled"],
    },
    output_schema: {
      type: "object",
      required: ["state_count", "decisions", "post_settlement_requires_review"],
      properties: {
        state_count: { const: 5 },
        decisions: { type: "array", minItems: 5, maxItems: 5 },
        post_settlement_requires_review: { const: true },
      },
      additionalProperties: false,
    },
    acceptance_rules: [
      { path: "$.state_count", operator: "equals", value: 5 },
      {
        path: "$.post_settlement_requires_review",
        operator: "equals",
        value: true,
      },
    ],
  },
  {
    title: "Plan a minimal webhook subscription",
    description:
      "Select the smallest event set needed to track contract award, delivery, settlement, and failure without subscribing to unrelated events.",
    budget_minor: "100000",
    required_capabilities: ["event_integration"],
    tags: ["webhooks", "events", "integration", "seeded-test-job"],
    input: {
      required_outcomes: [
        "contract_awarded",
        "delivery_received",
        "settlement_completed",
        "delivery_failed",
      ],
    },
    output_schema: {
      type: "object",
      required: ["event_count", "event_types", "verification_steps"],
      properties: {
        event_count: { const: 4 },
        event_types: { type: "array", minItems: 4, maxItems: 4 },
        verification_steps: { type: "array", minItems: 2 },
      },
      additionalProperties: false,
    },
    acceptance_rules: [{ path: "$.event_count", operator: "equals", value: 4 }],
  },
  {
    title: "Create a settlement receipt verification checklist",
    description:
      "Return checks for receipt signature, wallets, amounts, fee arithmetic, transaction reference, network, and provenance parents.",
    budget_minor: "100000",
    required_capabilities: ["receipt_verification"],
    tags: ["settlement", "receipts", "proof-of-earn", "seeded-test-job"],
    input: {
      receipt_version: "a2a402-settlement-receipt/0.2",
      required_checks: 8,
    },
    output_schema: {
      type: "object",
      required: ["receipt_version", "check_count", "checks"],
      properties: {
        receipt_version: { const: "a2a402-settlement-receipt/0.2" },
        check_count: { const: 8 },
        checks: { type: "array", minItems: 8, maxItems: 8 },
      },
      additionalProperties: false,
    },
    acceptance_rules: [
      { path: "$.check_count", operator: "equals", value: 8 },
      {
        path: "$.receipt_version",
        operator: "equals",
        value: "a2a402-settlement-receipt/0.2",
      },
    ],
  },
  {
    title: "Generate canonical JSON signing vectors",
    description:
      "Normalize the supplied objects into stable key order and return deterministic canonical JSON strings for signing tests.",
    budget_minor: "100000",
    required_capabilities: ["canonical_json"],
    tags: ["signing", "json", "canonicalization", "seeded-test-job"],
    input: {
      vectors: [
        { b: 2, a: 1 },
        { nested: { z: false, a: true } },
        { list: [3, 2, 1] },
      ],
    },
    output_schema: {
      type: "object",
      required: ["vector_count", "canonical_values"],
      properties: {
        vector_count: { const: 3 },
        canonical_values: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: { type: "string" },
        },
      },
      additionalProperties: false,
    },
    acceptance_rules: [
      { path: "$.vector_count", operator: "equals", value: 3 },
    ],
  },
  {
    title: "Compare three agent service offers",
    description:
      "Rank three supplied offers by price, execution time, schema clarity, and reputation requirements using explicit integer scoring.",
    budget_minor: "100000",
    required_capabilities: ["offer_comparison"],
    tags: ["services", "comparison", "procurement", "seeded-test-job"],
    input: {
      offer_ids: ["offer-a", "offer-b", "offer-c"],
      scoring_dimensions: [
        "price",
        "execution_time",
        "schema_clarity",
        "reputation_requirement",
      ],
    },
    output_schema: {
      type: "object",
      required: ["offer_count", "ranking", "recommended_offer", "method"],
      properties: {
        offer_count: { const: 3 },
        ranking: { type: "array", minItems: 3, maxItems: 3 },
        recommended_offer: {
          type: "string",
          enum: ["offer-a", "offer-b", "offer-c"],
        },
        method: { const: "integer_weighted_score" },
      },
      additionalProperties: false,
    },
    acceptance_rules: [
      { path: "$.offer_count", operator: "equals", value: 3 },
      { path: "$.method", operator: "equals", value: "integer_weighted_score" },
    ],
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

      const expansionFundingHash =
        "test:a2a402-seeded-opportunities-expansion-v3";
      if (
        !engine
          .stateView()
          .capitalLots.some(
            (lot) => lot.sourceTransactionHash === expansionFundingHash,
          )
      ) {
        engine.importCapital({
          agentId: buyer.id,
          amountMinor: "1000000",
          asset: "USDC",
          originType: "platform_test_funds",
          provenanceScope: "simulation",
          sourceTransactionHash: expansionFundingHash,
        });
      }

      const secondExpansionFundingHash =
        "test:a2a402-seeded-opportunities-expansion-v4";
      if (
        !engine
          .stateView()
          .capitalLots.some(
            (lot) => lot.sourceTransactionHash === secondExpansionFundingHash,
          )
      ) {
        engine.importCapital({
          agentId: buyer.id,
          amountMinor: "1000000",
          asset: "USDC",
          originType: "platform_test_funds",
          provenanceScope: "simulation",
          sourceTransactionHash: secondExpansionFundingHash,
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
          input: job.input as unknown as JsonValue,
          input_schema: { type: "object" },
          output_schema:
            "output_schema" in job ? job.output_schema : { type: "object" },
          maximum_execution_seconds: 86_400,
          budget_minor: job.budget_minor,
          asset: "USDC",
          required_reputation: {},
          required_capabilities: [...job.required_capabilities],
          acceptance_rules:
            "acceptance_rules" in job ? [...job.acceptance_rules] : [],
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
      mutationId: "simulation-seed-opportunities:v4",
      lockKeys: ["simulation-seed-opportunities"],
    },
  );
}
