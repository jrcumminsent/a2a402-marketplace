import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  pgView,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import {
  agentStatusEnum,
  artifactStatusEnum,
  attestationStatusEnum,
  bidStatusEnum,
  capitalAllocationKindEnum,
  capitalLotStatusEnum,
  cardFetchStatusEnum,
  communityMessageTypeEnum,
  contractStatusEnum,
  deliveryAttemptStatusEnum,
  deliveryStatusEnum,
  disputeStatusEnum,
  evaluationVerdictEnum,
  feeStatusEnum,
  idempotencyStatusEnum,
  jobStatusEnum,
  jobTypeEnum,
  ledgerAccountClassEnum,
  ledgerEntryDirectionEnum,
  ledgerNormalBalanceEnum,
  ledgerTransactionStatusEnum,
  listingStatusEnum,
  listingTypeEnum,
  moderationActionEnum,
  moderationStatusEnum,
  nonceStatusEnum,
  originTypeEnum,
  outboxStatusEnum,
  paymentIntentStatusEnum,
  riskSeverityEnum,
  settlementStatusEnum,
  webhookStatusEnum,
} from "./enums.js";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    machineIdentifier: varchar("machine_identifier", { length: 128 })
      .notNull()
      .unique(),
    handle: varchar("handle", { length: 128 }).notNull().unique(),
    publicSigningKey: text("public_signing_key").notNull(),
    signingAlgorithm: varchar("signing_algorithm", { length: 32 }).notNull(),
    externalAgentCardUrl: text("external_agent_card_url"),
    capabilitiesDocument: jsonb("capabilities_document")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    inputModalities: jsonb("input_modalities")
      .$type<string[]>()
      .default([])
      .notNull(),
    outputModalities: jsonb("output_modalities")
      .$type<string[]>()
      .default([])
      .notNull(),
    status: agentStatusEnum("status").default("active").notNull(),
    statusReasonCode: varchar("status_reason_code", { length: 64 }),
    spendingLimitMinor: bigint("spending_limit_minor", { mode: "bigint" }),
    earningLimitMinor: bigint("earning_limit_minor", { mode: "bigint" }),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    economicStats: jsonb("economic_stats")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    reputationSummary: jsonb("reputation_summary")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (table) => [
    check(
      "agents_spending_limit_nonnegative",
      sql`${table.spendingLimitMinor} IS NULL OR ${table.spendingLimitMinor} >= 0`,
    ),
    check(
      "agents_earning_limit_nonnegative",
      sql`${table.earningLimitMinor} IS NULL OR ${table.earningLimitMinor} >= 0`,
    ),
    check("agents_version_positive", sql`${table.version} > 0`),
    index("agents_status_idx").on(table.status),
  ],
);

export const agentWallets = pgTable(
  "agent_wallets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    network: varchar("network", { length: 64 }).notNull(),
    address: varchar("address", { length: 255 }).notNull(),
    signatureScheme: varchar("signature_scheme", { length: 64 }).notNull(),
    isPrimary: boolean("is_primary").default(false).notNull(),
    isVerified: boolean("is_verified").default(false).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    ...timestamps,
  },
  (table) => [
    unique("agent_wallet_network_address_unique").on(
      table.network,
      table.address,
    ),
    uniqueIndex("agent_wallet_one_primary_idx")
      .on(table.agentId)
      .where(sql`${table.isPrimary} = true AND ${table.disabledAt} IS NULL`),
    index("agent_wallet_agent_idx").on(table.agentId),
  ],
);

export const agentCapabilities = pgTable(
  "agent_capabilities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    capability: varchar("capability", { length: 128 }).notNull(),
    version: varchar("version", { length: 32 }).default("1").notNull(),
    description: text("description"),
    inputSchema: jsonb("input_schema").$type<Record<string, unknown>>(),
    outputSchema: jsonb("output_schema").$type<Record<string, unknown>>(),
    modalities: jsonb("modalities").$type<string[]>().default([]).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    ...timestamps,
  },
  (table) => [
    unique("agent_capability_unique").on(
      table.agentId,
      table.capability,
      table.version,
    ),
    index("agent_capability_lookup_idx").on(table.capability, table.isActive),
  ],
);

export const agentCards = pgTable(
  "agent_cards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    sourceUrl: text("source_url").notNull(),
    document: jsonb("document").$type<Record<string, unknown>>(),
    documentSha256: varchar("document_sha256", { length: 64 }),
    fetchStatus: cardFetchStatusEnum("fetch_status")
      .default("pending")
      .notNull(),
    httpStatus: smallint("http_status"),
    responseBytes: bigint("response_bytes", { mode: "bigint" }),
    etag: text("etag"),
    failureCode: varchar("failure_code", { length: 64 }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    redirectChain: jsonb("redirect_chain")
      .$type<string[]>()
      .default([])
      .notNull(),
    resolvedAddresses: jsonb("resolved_addresses")
      .$type<string[]>()
      .default([])
      .notNull(),
    ...timestamps,
  },
  (table) => [
    unique("agent_card_agent_url_unique").on(table.agentId, table.sourceUrl),
    check(
      "agent_card_size_nonnegative",
      sql`${table.responseBytes} IS NULL OR ${table.responseBytes} >= 0`,
    ),
    index("agent_card_status_idx").on(table.fetchStatus),
  ],
);

export const authNonces = pgTable(
  "auth_nonces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "cascade",
    }),
    walletId: uuid("wallet_id").references(() => agentWallets.id, {
      onDelete: "cascade",
    }),
    walletAddress: varchar("wallet_address", { length: 255 }).notNull(),
    network: varchar("network", { length: 64 }).notNull(),
    nonceHash: varchar("nonce_hash", { length: 128 }).notNull().unique(),
    challenge: text("challenge").notNull(),
    domain: varchar("domain", { length: 255 }).notNull(),
    uri: text("uri").notNull(),
    status: nonceStatusEnum("status").default("issued").notNull(),
    requestIp: inet("request_ip"),
    userAgentHash: varchar("user_agent_hash", { length: 64 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "auth_nonce_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    index("auth_nonce_lookup_idx").on(table.walletAddress, table.status),
    index("auth_nonce_expiry_idx").on(table.expiresAt),
  ],
);

export const serviceListings = pgTable(
  "service_listings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerAgentId: uuid("seller_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    listingType: listingTypeEnum("listing_type").notNull(),
    slug: varchar("slug", { length: 160 }).notNull(),
    status: listingStatusEnum("status").default("draft").notNull(),
    currentVersion: integer("current_version").default(1).notNull(),
    policyCategory: varchar("policy_category", { length: 128 }).notNull(),
    moderationStatus: moderationStatusEnum("moderation_status")
      .default("pending")
      .notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("listing_seller_slug_unique").on(table.sellerAgentId, table.slug),
    check("listing_current_version_positive", sql`${table.currentVersion} > 0`),
    index("listing_discovery_idx").on(
      table.status,
      table.listingType,
      table.policyCategory,
    ),
  ],
);

export const listingVersions = pgTable(
  "listing_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => serviceListings.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    description: text("description").notNull(),
    inputSchema: jsonb("input_schema")
      .$type<Record<string, unknown>>()
      .notNull(),
    outputSchema: jsonb("output_schema")
      .$type<Record<string, unknown>>()
      .notNull(),
    acceptanceRules: jsonb("acceptance_rules")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    refundRules: jsonb("refund_rules")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    timeoutRules: jsonb("timeout_rules")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    licenseTerms: jsonb("license_terms")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    requiredCapabilities: jsonb("required_capabilities")
      .$type<string[]>()
      .default([])
      .notNull(),
    requiredReputation: jsonb("required_reputation")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    artifactMimeTypes: jsonb("artifact_mime_types")
      .$type<string[]>()
      .default([])
      .notNull(),
    maxExecutionSeconds: integer("max_execution_seconds").notNull(),
    priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
    asset: varchar("asset", { length: 32 }).notNull(),
    network: varchar("network", { length: 64 }).notNull(),
    tags: jsonb("tags").$type<string[]>().default([]).notNull(),
    sellerA2aEndpoint: text("seller_a2a_endpoint"),
    sellerWebhookEndpoint: text("seller_webhook_endpoint"),
    contentSha256: varchar("content_sha256", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("listing_version_unique").on(table.listingId, table.version),
    check("listing_version_positive", sql`${table.version} > 0`),
    check("listing_price_nonnegative", sql`${table.priceMinor} >= 0`),
    check(
      "listing_execution_time_positive",
      sql`${table.maxExecutionSeconds} > 0`,
    ),
    index("listing_version_asset_idx").on(table.asset, table.priceMinor),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    buyerAgentId: uuid("buyer_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    sourceListingId: uuid("source_listing_id").references(
      () => serviceListings.id,
      { onDelete: "set null" },
    ),
    sourceListingVersionId: uuid("source_listing_version_id").references(
      () => listingVersions.id,
      { onDelete: "set null" },
    ),
    jobType: jobTypeEnum("job_type").notNull(),
    status: jobStatusEnum("status").default("draft").notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    description: text("description").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    inputSchema: jsonb("input_schema")
      .$type<Record<string, unknown>>()
      .notNull(),
    outputSchema: jsonb("output_schema")
      .$type<Record<string, unknown>>()
      .notNull(),
    acceptanceRules: jsonb("acceptance_rules")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    refundRules: jsonb("refund_rules")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    timeoutRules: jsonb("timeout_rules")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    budgetMinor: bigint("budget_minor", { mode: "bigint" }).notNull(),
    asset: varchar("asset", { length: 32 }).notNull(),
    network: varchar("network", { length: 64 }).notNull(),
    maxExecutionSeconds: integer("max_execution_seconds").notNull(),
    requiredReputation: jsonb("required_reputation")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    requiredCapabilities: jsonb("required_capabilities")
      .$type<string[]>()
      .default([])
      .notNull(),
    artifactMimeTypes: jsonb("artifact_mime_types")
      .$type<string[]>()
      .default([])
      .notNull(),
    licenseTerms: jsonb("license_terms")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    tags: jsonb("tags").$type<string[]>().default([]).notNull(),
    policyCategory: varchar("policy_category", { length: 128 }).notNull(),
    moderationStatus: moderationStatusEnum("moderation_status")
      .default("pending")
      .notNull(),
    biddingClosesAt: timestamp("bidding_closes_at", { withTimezone: true }),
    sellerAcceptanceDeadline: timestamp("seller_acceptance_deadline", {
      withTimezone: true,
    }).notNull(),
    deliveryDeadline: timestamp("delivery_deadline", { withTimezone: true }),
    evaluationDeadline: timestamp("evaluation_deadline", {
      withTimezone: true,
    }),
    buyerResponseDeadline: timestamp("buyer_response_deadline", {
      withTimezone: true,
    }),
    automaticRefundAt: timestamp("automatic_refund_at", {
      withTimezone: true,
    }),
    automaticSettlementAt: timestamp("automatic_settlement_at", {
      withTimezone: true,
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check("job_budget_positive", sql`${table.budgetMinor} > 0`),
    check("job_execution_time_positive", sql`${table.maxExecutionSeconds} > 0`),
    index("job_discovery_idx").on(table.status, table.jobType, table.asset),
    index("job_buyer_idx").on(table.buyerAgentId, table.createdAt),
  ],
);

export const jobRequirements = pgTable(
  "job_requirements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    requirementType: varchar("requirement_type", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    operator: varchar("operator", { length: 32 }).default("eq").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    isMandatory: boolean("is_mandatory").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("job_requirement_unique").on(
      table.jobId,
      table.requirementType,
      table.name,
    ),
    index("job_requirement_lookup_idx").on(table.requirementType, table.name),
  ],
);

export const bids = pgTable(
  "bids",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "restrict" }),
    sellerAgentId: uuid("seller_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    status: bidStatusEnum("status").default("submitted").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    asset: varchar("asset", { length: 32 }).notNull(),
    estimatedExecutionSeconds: integer("estimated_execution_seconds").notNull(),
    proposal: jsonb("proposal").$type<Record<string, unknown>>().notNull(),
    signedPayload: jsonb("signed_payload")
      .$type<Record<string, unknown>>()
      .notNull(),
    signature: text("signature").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("bid_job_idempotency_unique").on(table.jobId, table.idempotencyKey),
    check("bid_amount_positive", sql`${table.amountMinor} > 0`),
    check(
      "bid_execution_time_positive",
      sql`${table.estimatedExecutionSeconds} > 0`,
    ),
    index("bid_job_status_idx").on(
      table.jobId,
      table.status,
      table.amountMinor,
    ),
    index("bid_expiry_idx").on(table.expiresAt),
  ],
);

export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "restrict" }),
    acceptedBidId: uuid("accepted_bid_id").references(() => bids.id, {
      onDelete: "restrict",
    }),
    buyerAgentId: uuid("buyer_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    sellerAgentId: uuid("seller_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    status: contractStatusEnum("status")
      .default("pending_acceptance")
      .notNull(),
    statusBeforeFreeze: contractStatusEnum("status_before_freeze"),
    asset: varchar("asset", { length: 32 }).notNull(),
    network: varchar("network", { length: 64 }).notNull(),
    grossAmountMinor: bigint("gross_amount_minor", {
      mode: "bigint",
    }).notNull(),
    feeBps: integer("fee_bps").notNull(),
    maximumNetworkCostMinor: bigint("maximum_network_cost_minor", {
      mode: "bigint",
    })
      .default(0n)
      .notNull(),
    terms: jsonb("terms").$type<Record<string, unknown>>().notNull(),
    termsSha256: varchar("terms_sha256", { length: 64 }).notNull(),
    buyerSignature: text("buyer_signature").notNull(),
    sellerSignature: text("seller_signature"),
    sellerAcceptanceDeadline: timestamp("seller_acceptance_deadline", {
      withTimezone: true,
    }).notNull(),
    sellerAcceptedAt: timestamp("seller_accepted_at", { withTimezone: true }),
    deliveryDeadline: timestamp("delivery_deadline", {
      withTimezone: true,
    }).notNull(),
    evaluationDeadline: timestamp("evaluation_deadline", {
      withTimezone: true,
    }).notNull(),
    buyerResponseDeadline: timestamp("buyer_response_deadline", {
      withTimezone: true,
    }).notNull(),
    automaticRefundAt: timestamp("automatic_refund_at", {
      withTimezone: true,
    }).notNull(),
    automaticSettlementAt: timestamp("automatic_settlement_at", {
      withTimezone: true,
    }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
    freezeReasonCode: varchar("freeze_reason_code", { length: 64 }),
    ...timestamps,
  },
  (table) => [
    unique("contract_job_unique").on(table.jobId),
    check("contract_gross_positive", sql`${table.grossAmountMinor} > 0`),
    check("contract_fee_bps_range", sql`${table.feeBps} BETWEEN 0 AND 10000`),
    check(
      "contract_network_cost_nonnegative",
      sql`${table.maximumNetworkCostMinor} >= 0`,
    ),
    check(
      "contract_agents_distinct",
      sql`${table.buyerAgentId} <> ${table.sellerAgentId}`,
    ),
    check(
      "contract_status_before_freeze_valid",
      sql`${table.statusBeforeFreeze} IS NULL OR (${table.status} = 'frozen' AND ${table.statusBeforeFreeze} <> 'frozen')`,
    ),
    check(
      "contract_seller_acceptance_on_time",
      sql`${table.sellerAcceptedAt} IS NULL OR ${table.sellerAcceptedAt} <= ${table.sellerAcceptanceDeadline}`,
    ),
    index("contract_buyer_status_idx").on(table.buyerAgentId, table.status),
    index("contract_seller_status_idx").on(table.sellerAgentId, table.status),
    index("contract_seller_acceptance_due_idx").on(
      table.status,
      table.sellerAcceptanceDeadline,
    ),
  ],
);

export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "restrict" }),
    sellerAgentId: uuid("seller_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    sequence: integer("sequence").default(1).notNull(),
    status: deliveryStatusEnum("status").default("submitted").notNull(),
    manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
    manifestSha256: varchar("manifest_sha256", { length: 64 }).notNull(),
    outputSchemaUri: text("output_schema_uri").notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    signature: text("signature").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
  },
  (table) => [
    unique("delivery_contract_sequence_unique").on(
      table.contractId,
      table.sequence,
    ),
    check("delivery_sequence_positive", sql`${table.sequence} > 0`),
    index("delivery_contract_status_idx").on(table.contractId, table.status),
  ],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => deliveries.id, { onDelete: "restrict" }),
    ordinal: integer("ordinal").notNull(),
    uri: text("uri").notNull(),
    storageAdapter: varchar("storage_adapter", { length: 32 }).notNull(),
    storageKey: text("storage_key").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    mimeType: varchar("mime_type", { length: 255 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "bigint" }).notNull(),
    status: artifactStatusEnum("status").default("pending").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("artifact_delivery_ordinal_unique").on(
      table.deliveryId,
      table.ordinal,
    ),
    check("artifact_ordinal_nonnegative", sql`${table.ordinal} >= 0`),
    check("artifact_size_nonnegative", sql`${table.sizeBytes} >= 0`),
    index("artifact_hash_idx").on(table.sha256),
  ],
);

export const evaluations = pgTable(
  "evaluations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "restrict" }),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => deliveries.id, { onDelete: "restrict" }),
    evaluatorAgentId: uuid("evaluator_agent_id").references(() => agents.id, {
      onDelete: "restrict",
    }),
    evaluatorType: varchar("evaluator_type", { length: 64 }).notNull(),
    evaluatorVersion: varchar("evaluator_version", { length: 32 }).notNull(),
    verdict: evaluationVerdictEnum("verdict").default("pending").notNull(),
    scoreBps: integer("score_bps"),
    checks: jsonb("checks").$type<Record<string, unknown>>().notNull(),
    deterministicEvidence: jsonb("deterministic_evidence")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    failureCodes: jsonb("failure_codes")
      .$type<string[]>()
      .default([])
      .notNull(),
    signedResult: jsonb("signed_result").$type<Record<string, unknown>>(),
    signature: text("signature"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "evaluation_score_range",
      sql`${table.scoreBps} IS NULL OR ${table.scoreBps} BETWEEN 0 AND 10000`,
    ),
    index("evaluation_delivery_idx").on(table.deliveryId, table.verdict),
    index("evaluation_contract_idx").on(table.contractId),
  ],
);

export const disputes = pgTable(
  "disputes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "restrict" }),
    openedByAgentId: uuid("opened_by_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    status: disputeStatusEnum("status").default("open").notNull(),
    reasonCode: varchar("reason_code", { length: 64 }).notNull(),
    claim: jsonb("claim").$type<Record<string, unknown>>().notNull(),
    evidence: jsonb("evidence")
      .$type<Record<string, unknown>[]>()
      .default([])
      .notNull(),
    resolution: jsonb("resolution").$type<Record<string, unknown>>(),
    buyerAmountMinor: bigint("buyer_amount_minor", { mode: "bigint" }),
    sellerAmountMinor: bigint("seller_amount_minor", { mode: "bigint" }),
    platformAmountMinor: bigint("platform_amount_minor", { mode: "bigint" }),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "dispute_buyer_amount_nonnegative",
      sql`${table.buyerAmountMinor} IS NULL OR ${table.buyerAmountMinor} >= 0`,
    ),
    check(
      "dispute_seller_amount_nonnegative",
      sql`${table.sellerAmountMinor} IS NULL OR ${table.sellerAmountMinor} >= 0`,
    ),
    check(
      "dispute_platform_amount_nonnegative",
      sql`${table.platformAmountMinor} IS NULL OR ${table.platformAmountMinor} >= 0`,
    ),
    index("dispute_contract_idx").on(table.contractId, table.status),
  ],
);

export const earningAttestations = pgTable(
  "earning_attestations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attestationVersion: varchar("attestation_version", { length: 32 })
      .default("a2a402-earning-attestation/0.1")
      .notNull(),
    issuerAgentId: uuid("issuer_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    recipientAgentId: uuid("recipient_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    recipientWallet: varchar("recipient_wallet", { length: 255 }).notNull(),
    network: varchar("network", { length: 64 }).notNull(),
    asset: varchar("asset", { length: 32 }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    workDescriptionHash: varchar("work_description_hash", {
      length: 128,
    }).notNull(),
    deliverableHash: varchar("deliverable_hash", { length: 128 }).notNull(),
    paymentTransactionHash: varchar("payment_transaction_hash", {
      length: 255,
    }).notNull(),
    replayProtectionId: varchar("replay_protection_id", {
      length: 128,
    }).notNull(),
    earnedAt: timestamp("earned_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    payloadSha256: varchar("payload_sha256", { length: 64 }).notNull(),
    issuerSignature: text("issuer_signature").notNull(),
    issuerKeyId: varchar("issuer_key_id", { length: 255 }),
    status: attestationStatusEnum("status").default("pending").notNull(),
    verifierType: varchar("verifier_type", { length: 64 }),
    verificationEvidence: jsonb("verification_evidence")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    rejectionCode: varchar("rejection_code", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("earning_attestation_replay_unique").on(table.replayProtectionId),
    unique("earning_attestation_tx_unique").on(
      table.network,
      table.paymentTransactionHash,
      table.asset,
    ),
    check("earning_attestation_amount_positive", sql`${table.amountMinor} > 0`),
    check(
      "earning_attestation_no_self_attestation",
      sql`${table.issuerAgentId} <> ${table.recipientAgentId}`,
    ),
    index("earning_attestation_recipient_idx").on(
      table.recipientAgentId,
      table.status,
    ),
  ],
);

export const paymentIntents = pgTable(
  "payment_intents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentIdentifier: varchar("payment_identifier", { length: 128 })
      .notNull()
      .unique(),
    contractId: uuid("contract_id").references(() => contracts.id, {
      onDelete: "restrict",
    }),
    payerAgentId: uuid("payer_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    payeeAgentId: uuid("payee_agent_id").references(() => agents.id, {
      onDelete: "restrict",
    }),
    adapter: varchar("adapter", { length: 64 }).notNull(),
    status: paymentIntentStatusEnum("status")
      .default("requires_payment")
      .notNull(),
    network: varchar("network", { length: 64 }).notNull(),
    asset: varchar("asset", { length: 32 }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    requirementJson: jsonb("requirement_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    paymentPayloadHash: varchar("payment_payload_hash", { length: 128 }),
    transactionHash: varchar("transaction_hash", { length: 255 }),
    verificationJson: jsonb("verification_json")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check("payment_intent_amount_positive", sql`${table.amountMinor} > 0`),
    check(
      "payment_intent_requirement_object",
      sql`jsonb_typeof(${table.requirementJson}) = 'object'`,
    ),
    check(
      "payment_intent_verification_object",
      sql`jsonb_typeof(${table.verificationJson}) = 'object'`,
    ),
    uniqueIndex("payment_intent_payload_replay_idx")
      .on(table.paymentPayloadHash)
      .where(sql`${table.paymentPayloadHash} IS NOT NULL`),
    uniqueIndex("payment_intent_transaction_replay_idx")
      .on(table.network, table.transactionHash)
      .where(sql`${table.transactionHash} IS NOT NULL`),
    index("payment_intent_contract_idx").on(table.contractId, table.status),
    index("payment_intent_expiry_idx").on(table.expiresAt),
  ],
);

export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "restrict" }),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => deliveries.id, { onDelete: "restrict" }),
    evaluationId: uuid("evaluation_id")
      .notNull()
      .references(() => evaluations.id, { onDelete: "restrict" }),
    paymentIntentId: uuid("payment_intent_id").references(
      () => paymentIntents.id,
      { onDelete: "restrict" },
    ),
    status: settlementStatusEnum("status").default("pending").notNull(),
    adapter: varchar("adapter", { length: 64 }).notNull(),
    network: varchar("network", { length: 64 }).notNull(),
    asset: varchar("asset", { length: 32 }).notNull(),
    grossAmountMinor: bigint("gross_amount_minor", {
      mode: "bigint",
    }).notNull(),
    platformFeeMinor: bigint("platform_fee_minor", {
      mode: "bigint",
    }).notNull(),
    networkCostMinor: bigint("network_cost_minor", { mode: "bigint" })
      .default(0n)
      .notNull(),
    sellerNetMinor: bigint("seller_net_minor", { mode: "bigint" }).notNull(),
    transactionHash: varchar("transaction_hash", { length: 255 }),
    receiptPayload: jsonb("receipt_payload")
      .$type<Record<string, unknown>>()
      .notNull(),
    receiptSha256: varchar("receipt_sha256", { length: 64 }).notNull(),
    marketplaceSignature: text("marketplace_signature").notNull(),
    marketplaceKeyId: varchar("marketplace_key_id", { length: 255 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    failureCode: varchar("failure_code", { length: 64 }),
    initiatedAt: timestamp("initiated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("settlement_contract_unique").on(table.contractId),
    unique("settlement_idempotency_unique").on(table.idempotencyKey),
    check("settlement_gross_positive", sql`${table.grossAmountMinor} > 0`),
    check("settlement_fee_nonnegative", sql`${table.platformFeeMinor} >= 0`),
    check(
      "settlement_network_nonnegative",
      sql`${table.networkCostMinor} >= 0`,
    ),
    check("settlement_net_nonnegative", sql`${table.sellerNetMinor} >= 0`),
    check(
      "settlement_amount_equation",
      sql`${table.grossAmountMinor} = ${table.platformFeeMinor} + ${table.networkCostMinor} + ${table.sellerNetMinor}`,
    ),
    index("settlement_tx_hash_idx").on(table.network, table.transactionHash),
  ],
);

export const capitalLots = pgTable(
  "capital_lots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    walletId: uuid("wallet_id").references(() => agentWallets.id, {
      onDelete: "restrict",
    }),
    asset: varchar("asset", { length: 32 }).notNull(),
    network: varchar("network", { length: 64 }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    originType: originTypeEnum("origin_type").notNull(),
    provenanceScope: varchar("provenance_scope", { length: 16 })
      .default("simulation")
      .notNull(),
    status: capitalLotStatusEnum("status").default("pending").notNull(),
    sourceJobId: uuid("source_job_id").references(() => jobs.id, {
      onDelete: "restrict",
    }),
    sourceContractId: uuid("source_contract_id").references(
      () => contracts.id,
      { onDelete: "restrict" },
    ),
    sourceDeliveryId: uuid("source_delivery_id").references(
      () => deliveries.id,
      { onDelete: "restrict" },
    ),
    sourceEvaluationId: uuid("source_evaluation_id").references(
      () => evaluations.id,
      { onDelete: "restrict" },
    ),
    sourceSettlementId: uuid("source_settlement_id").references(
      () => settlements.id,
      { onDelete: "restrict" },
    ),
    sourceTransactionHash: varchar("source_transaction_hash", {
      length: 255,
    }),
    earningAttestationId: uuid("earning_attestation_id").references(
      () => earningAttestations.id,
      { onDelete: "restrict" },
    ),
    verificationEvidence: jsonb("verification_evidence")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    earnedAt: timestamp("earned_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
    freezeReasonCode: varchar("freeze_reason_code", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("capital_lot_amount_positive", sql`${table.amountMinor} > 0`),
    check(
      "capital_lot_provenance_scope_valid",
      sql`${table.provenanceScope} IN ('simulation', 'real')`,
    ),
    check(
      "capital_lot_test_funds_simulation_scope",
      sql`${table.originType} <> 'platform_test_funds' OR ${table.provenanceScope} = 'simulation'`,
    ),
    uniqueIndex("capital_lot_settlement_unique")
      .on(table.sourceSettlementId)
      .where(
        sql`${table.sourceSettlementId} IS NOT NULL AND ${table.originType} = 'marketplace_earned'`,
      ),
    uniqueIndex("capital_lot_attestation_unique")
      .on(table.earningAttestationId)
      .where(sql`${table.earningAttestationId} IS NOT NULL`),
    index("capital_lot_selection_idx").on(
      table.agentId,
      table.asset,
      table.network,
      table.status,
      table.earnedAt,
    ),
    index("capital_lot_transaction_idx").on(
      table.network,
      table.sourceTransactionHash,
    ),
  ],
);

export const capitalLotParents = pgTable(
  "capital_lot_parents",
  {
    childCapitalLotId: uuid("child_capital_lot_id")
      .notNull()
      .references(() => capitalLots.id, { onDelete: "restrict" }),
    parentCapitalLotId: uuid("parent_capital_lot_id")
      .notNull()
      .references(() => capitalLots.id, { onDelete: "restrict" }),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    lineageDepth: integer("lineage_depth").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "capital_lot_parents_pk",
      columns: [table.childCapitalLotId, table.parentCapitalLotId],
    }),
    check("capital_lot_parent_amount_positive", sql`${table.amountMinor} > 0`),
    check(
      "capital_lot_parent_not_self",
      sql`${table.childCapitalLotId} <> ${table.parentCapitalLotId}`,
    ),
    check("capital_lot_parent_depth_positive", sql`${table.lineageDepth} > 0`),
    index("capital_lot_parent_reverse_idx").on(table.parentCapitalLotId),
  ],
);

export const capitalLotAllocations = pgTable(
  "capital_lot_allocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    capitalLotId: uuid("capital_lot_id")
      .notNull()
      .references(() => capitalLots.id, { onDelete: "restrict" }),
    contractId: uuid("contract_id").references(() => contracts.id, {
      onDelete: "restrict",
    }),
    settlementId: uuid("settlement_id").references(() => settlements.id, {
      onDelete: "restrict",
    }),
    derivedCapitalLotId: uuid("derived_capital_lot_id").references(
      () => capitalLots.id,
      { onDelete: "restrict" },
    ),
    allocationKind: capitalAllocationKindEnum("allocation_kind").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    asset: varchar("asset", { length: 32 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("capital_allocation_idempotency_unique").on(table.idempotencyKey),
    check("capital_allocation_amount_positive", sql`${table.amountMinor} > 0`),
    index("capital_allocation_lot_idx").on(
      table.capitalLotId,
      table.allocationKind,
    ),
    index("capital_allocation_contract_idx").on(table.contractId),
  ],
);

export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "restrict",
    }),
    code: varchar("code", { length: 96 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    asset: varchar("asset", { length: 32 }).notNull(),
    network: varchar("network", { length: 64 }).notNull(),
    accountClass: ledgerAccountClassEnum("account_class").notNull(),
    normalBalance: ledgerNormalBalanceEnum("normal_balance").notNull(),
    balanceBucket: varchar("balance_bucket", { length: 64 }).notNull(),
    proofOfEarnEligible: boolean("proof_of_earn_eligible")
      .default(false)
      .notNull(),
    allowNegative: boolean("allow_negative").default(false).notNull(),
    isSystemAccount: boolean("is_system_account").default(false).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    ...timestamps,
  },
  (table) => [
    unique("ledger_account_owner_code_unique").on(
      table.agentId,
      table.code,
      table.asset,
      table.network,
    ),
    index("ledger_account_agent_bucket_idx").on(
      table.agentId,
      table.balanceBucket,
      table.asset,
    ),
  ],
);

export const ledgerTransactions = pgTable(
  "ledger_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    transactionType: varchar("transaction_type", { length: 64 }).notNull(),
    status: ledgerTransactionStatusEnum("status").default("draft").notNull(),
    asset: varchar("asset", { length: 32 }).notNull(),
    network: varchar("network", { length: 64 }).notNull(),
    contractId: uuid("contract_id").references(() => contracts.id, {
      onDelete: "restrict",
    }),
    settlementId: uuid("settlement_id").references(() => settlements.id, {
      onDelete: "restrict",
    }),
    paymentIntentId: uuid("payment_intent_id").references(
      () => paymentIntents.id,
      { onDelete: "restrict" },
    ),
    reversesTransactionId: uuid("reverses_transaction_id"),
    idempotencyKey: varchar("idempotency_key", { length: 128 })
      .notNull()
      .unique(),
    description: text("description").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ledger_transaction_contract_idx").on(table.contractId),
    index("ledger_transaction_settlement_idx").on(table.settlementId),
    index("ledger_transaction_effective_idx").on(
      table.status,
      table.effectiveAt,
    ),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ledgerTransactionId: uuid("ledger_transaction_id")
      .notNull()
      .references(() => ledgerTransactions.id, { onDelete: "restrict" }),
    ledgerAccountId: uuid("ledger_account_id")
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: "restrict" }),
    direction: ledgerEntryDirectionEnum("direction").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    capitalLotId: uuid("capital_lot_id").references(() => capitalLots.id, {
      onDelete: "restrict",
    }),
    memo: text("memo"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("ledger_entry_amount_positive", sql`${table.amountMinor} > 0`),
    index("ledger_entry_transaction_idx").on(table.ledgerTransactionId),
    index("ledger_entry_account_idx").on(
      table.ledgerAccountId,
      table.createdAt,
    ),
    index("ledger_entry_capital_lot_idx").on(table.capitalLotId),
  ],
);

export const platformFees = pgTable(
  "platform_fees",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    settlementId: uuid("settlement_id")
      .notNull()
      .references(() => settlements.id, { onDelete: "restrict" }),
    ledgerTransactionId: uuid("ledger_transaction_id")
      .notNull()
      .references(() => ledgerTransactions.id, { onDelete: "restrict" }),
    feeBps: integer("fee_bps").notNull(),
    grossAmountMinor: bigint("gross_amount_minor", {
      mode: "bigint",
    }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    asset: varchar("asset", { length: 32 }).notNull(),
    network: varchar("network", { length: 64 }).notNull(),
    status: feeStatusEnum("status").default("accrued").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    collectedAt: timestamp("collected_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
  },
  (table) => [
    unique("platform_fee_settlement_unique").on(table.settlementId),
    check("platform_fee_bps_range", sql`${table.feeBps} BETWEEN 0 AND 10000`),
    check("platform_fee_gross_positive", sql`${table.grossAmountMinor} > 0`),
    check("platform_fee_amount_nonnegative", sql`${table.amountMinor} >= 0`),
    check(
      "platform_fee_not_over_gross",
      sql`${table.amountMinor} <= ${table.grossAmountMinor}`,
    ),
  ],
);

export const reputationEvents = pgTable(
  "reputation_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subjectAgentId: uuid("subject_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    actorAgentId: uuid("actor_agent_id").references(() => agents.id, {
      onDelete: "restrict",
    }),
    contractId: uuid("contract_id").references(() => contracts.id, {
      onDelete: "restrict",
    }),
    eventType: varchar("event_type", { length: 96 }).notNull(),
    dimension: varchar("dimension", { length: 96 }).notNull(),
    delta: bigint("delta", { mode: "bigint" }).notNull(),
    unit: varchar("unit", { length: 32 }).notNull(),
    evidence: jsonb("evidence")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    evidenceSha256: varchar("evidence_sha256", { length: 64 }).notNull(),
    marketplaceSignature: text("marketplace_signature").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "reputation_no_direct_self_rating",
      sql`${table.actorAgentId} IS NULL OR ${table.actorAgentId} <> ${table.subjectAgentId}`,
    ),
    index("reputation_subject_dimension_idx").on(
      table.subjectAgentId,
      table.dimension,
      table.occurredAt,
    ),
    index("reputation_contract_idx").on(table.contractId),
  ],
);

export const reputationSnapshots = pgTable(
  "reputation_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    sequence: bigint("sequence", { mode: "bigint" }).notNull(),
    dimensions: jsonb("dimensions").$type<Record<string, unknown>>().notNull(),
    sourceEventCount: bigint("source_event_count", {
      mode: "bigint",
    }).notNull(),
    snapshotSha256: varchar("snapshot_sha256", { length: 64 }).notNull(),
    marketplaceSignature: text("marketplace_signature").notNull(),
    marketplaceKeyId: varchar("marketplace_key_id", { length: 255 }).notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("reputation_snapshot_sequence_unique").on(
      table.agentId,
      table.sequence,
    ),
    check("reputation_snapshot_sequence_positive", sql`${table.sequence} > 0`),
    check(
      "reputation_snapshot_count_nonnegative",
      sql`${table.sourceEventCount} >= 0`,
    ),
  ],
);

export const riskSignals = pgTable(
  "risk_signals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subjectAgentId: uuid("subject_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    relatedAgentId: uuid("related_agent_id").references(() => agents.id, {
      onDelete: "restrict",
    }),
    contractId: uuid("contract_id").references(() => contracts.id, {
      onDelete: "restrict",
    }),
    signalType: varchar("signal_type", { length: 96 }).notNull(),
    severity: riskSeverityEnum("severity").notNull(),
    explanation: text("explanation").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
    confidenceBps: integer("confidence_bps").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "risk_signal_confidence_range",
      sql`${table.confidenceBps} BETWEEN 0 AND 10000`,
    ),
    index("risk_signal_subject_idx").on(
      table.subjectAgentId,
      table.signalType,
      table.detectedAt,
    ),
  ],
);

export const communityChannels = pgTable(
  "community_channels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: varchar("slug", { length: 128 }).notNull().unique(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description").notNull(),
    creatorAgentId: uuid("creator_agent_id").references(() => agents.id, {
      onDelete: "restrict",
    }),
    visibility: varchar("visibility", { length: 32 })
      .default("public")
      .notNull(),
    minimumReputation: jsonb("minimum_reputation")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    rateLimitPerMinute: integer("rate_limit_per_minute").default(10).notNull(),
    allowedMessageTypes: jsonb("allowed_message_types")
      .$type<string[]>()
      .default([
        "discussion",
        "proposal",
        "request",
        "announcement",
        "collaboration",
      ])
      .notNull(),
    moderationStatus: moderationStatusEnum("moderation_status")
      .default("allowed")
      .notNull(),
    ...timestamps,
  },
  (table) => [
    check(
      "community_channel_rate_positive",
      sql`${table.rateLimitPerMinute} > 0`,
    ),
  ],
);

export const communityChannelMemberships = pgTable(
  "community_channel_memberships",
  {
    channelId: uuid("channel_id")
      .notNull()
      .references(() => communityChannels.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 32 }).default("member").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    mutedUntil: timestamp("muted_until", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      name: "community_channel_memberships_pk",
      columns: [table.channelId, table.agentId],
    }),
    index("community_membership_agent_idx").on(table.agentId),
  ],
);

export const communityMessages = pgTable(
  "community_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => communityChannels.id, { onDelete: "restrict" }),
    authorAgentId: uuid("author_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    messageType: communityMessageTypeEnum("message_type").notNull(),
    contentType: varchar("content_type", { length: 128 })
      .default("application/json")
      .notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    contentSha256: varchar("content_sha256", { length: 64 }).notNull(),
    tags: jsonb("tags").$type<string[]>().default([]).notNull(),
    mentions: jsonb("mentions").$type<string[]>().default([]).notNull(),
    signature: text("signature").notNull(),
    signingKeyId: varchar("signing_key_id", { length: 255 }),
    moderationStatus: moderationStatusEnum("moderation_status")
      .default("pending")
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("community_message_feed_idx").on(
      table.channelId,
      table.moderationStatus,
      table.createdAt,
    ),
    index("community_message_author_idx").on(
      table.authorAgentId,
      table.createdAt,
    ),
  ],
);

export const communityReplies = pgTable(
  "community_replies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentMessageId: uuid("parent_message_id")
      .notNull()
      .references(() => communityMessages.id, { onDelete: "restrict" }),
    replyMessageId: uuid("reply_message_id")
      .notNull()
      .references(() => communityMessages.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("community_reply_message_unique").on(table.replyMessageId),
    check(
      "community_reply_not_self",
      sql`${table.parentMessageId} <> ${table.replyMessageId}`,
    ),
    index("community_reply_parent_idx").on(
      table.parentMessageId,
      table.createdAt,
    ),
  ],
);

export const moderationEvents = pgTable(
  "moderation_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    targetType: varchar("target_type", { length: 64 }).notNull(),
    targetId: uuid("target_id").notNull(),
    subjectAgentId: uuid("subject_agent_id").references(() => agents.id, {
      onDelete: "restrict",
    }),
    actorType: varchar("actor_type", { length: 32 }).notNull(),
    actorAgentId: uuid("actor_agent_id").references(() => agents.id, {
      onDelete: "restrict",
    }),
    action: moderationActionEnum("action").notNull(),
    reasonCode: varchar("reason_code", { length: 96 }).notNull(),
    policyRule: varchar("policy_rule", { length: 160 }).notNull(),
    evidence: jsonb("evidence")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("moderation_target_idx").on(
      table.targetType,
      table.targetId,
      table.createdAt,
    ),
    index("moderation_subject_idx").on(table.subjectAgentId, table.createdAt),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    sequence: bigserial("sequence", { mode: "bigint" }).primaryKey(),
    id: uuid("id").defaultRandom().notNull().unique(),
    eventType: varchar("event_type", { length: 96 }).notNull(),
    actorType: varchar("actor_type", { length: 32 }).notNull(),
    actorAgentId: uuid("actor_agent_id").references(() => agents.id, {
      onDelete: "restrict",
    }),
    requestId: varchar("request_id", { length: 128 }),
    correlationId: varchar("correlation_id", { length: 128 }),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    resourceType: varchar("resource_type", { length: 64 }).notNull(),
    resourceId: uuid("resource_id"),
    action: varchar("action", { length: 96 }).notNull(),
    outcome: varchar("outcome", { length: 32 }).notNull(),
    details: jsonb("details")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    previousEventHash: varchar("previous_event_hash", { length: 64 }),
    eventHash: varchar("event_hash", { length: 64 }).notNull(),
    sourceIp: inet("source_ip"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("audit_event_hash_unique").on(table.eventHash),
    index("audit_resource_idx").on(
      table.resourceType,
      table.resourceId,
      table.occurredAt,
    ),
    index("audit_correlation_idx").on(table.correlationId),
  ],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scope: varchar("scope", { length: 128 }).notNull(),
    key: varchar("key", { length: 128 }).notNull(),
    actorAgentId: uuid("actor_agent_id").references(() => agents.id, {
      onDelete: "restrict",
    }),
    method: varchar("method", { length: 16 }).notNull(),
    path: text("path").notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    status: idempotencyStatusEnum("status").default("processing").notNull(),
    responseStatus: smallint("response_status"),
    responseBody: jsonb("response_body").$type<unknown>(),
    responseHeaders: jsonb("response_headers")
      .$type<Record<string, string>>()
      .default({})
      .notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    unique("idempotency_scope_key_unique").on(table.scope, table.key),
    index("idempotency_expiry_idx").on(table.expiresAt),
  ],
);

export const webhookSubscriptions = pgTable(
  "webhook_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    endpointUrl: text("endpoint_url").notNull(),
    eventTypes: jsonb("event_types").$type<string[]>().notNull(),
    status: webhookStatusEnum("status").default("active").notNull(),
    signingSecretCiphertext: text("signing_secret_ciphertext").notNull(),
    signingKeyVersion: integer("signing_key_version").default(1).notNull(),
    maxAttempts: integer("max_attempts").default(8).notNull(),
    timeoutMs: integer("timeout_ms").default(10_000).notNull(),
    lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true }),
    disabledReasonCode: varchar("disabled_reason_code", { length: 64 }),
    ...timestamps,
  },
  (table) => [
    unique("webhook_agent_endpoint_unique").on(
      table.agentId,
      table.endpointUrl,
    ),
    check("webhook_attempts_positive", sql`${table.maxAttempts} > 0`),
    check("webhook_timeout_positive", sql`${table.timeoutMs} > 0`),
    check(
      "webhook_secret_ciphertext_nonempty",
      sql`length(${table.signingSecretCiphertext}) > 0`,
    ),
  ],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => webhookSubscriptions.id, { onDelete: "cascade" }),
    outboxEventId: uuid("outbox_event_id").notNull(),
    status: deliveryAttemptStatusEnum("status").default("pending").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    responseStatus: smallint("response_status"),
    responseBodyHash: varchar("response_body_hash", { length: 64 }),
    errorCode: varchar("error_code", { length: 64 }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("webhook_delivery_event_unique").on(
      table.subscriptionId,
      table.outboxEventId,
    ),
    check(
      "webhook_delivery_attempt_nonnegative",
      sql`${table.attemptCount} >= 0`,
    ),
    index("webhook_delivery_due_idx").on(table.status, table.nextAttemptAt),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    aggregateType: varchar("aggregate_type", { length: 64 }).notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    aggregateVersion: bigint("aggregate_version", { mode: "bigint" }).notNull(),
    eventType: varchar("event_type", { length: 128 }).notNull(),
    protocolVersion: varchar("protocol_version", { length: 32 })
      .default("a2a402/0.1")
      .notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    payloadSha256: varchar("payload_sha256", { length: 64 }).notNull(),
    marketplaceSignature: text("marketplace_signature"),
    status: outboxStatusEnum("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: varchar("locked_by", { length: 128 }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("outbox_aggregate_version_unique").on(
      table.aggregateType,
      table.aggregateId,
      table.aggregateVersion,
    ),
    check("outbox_version_positive", sql`${table.aggregateVersion} > 0`),
    check("outbox_attempts_nonnegative", sql`${table.attempts} >= 0`),
    index("outbox_publish_idx").on(table.status, table.availableAt),
  ],
);

export const platformSettings = pgTable(
  "platform_settings",
  {
    key: varchar("key", { length: 160 }).primaryKey(),
    value: jsonb("value").$type<unknown>().notNull(),
    valueType: varchar("value_type", { length: 32 }).notNull(),
    description: text("description").notNull(),
    isPublic: boolean("is_public").default(false).notNull(),
    isSecret: boolean("is_secret").default(false).notNull(),
    version: bigint("version", { mode: "bigint" }).default(1n).notNull(),
    updatedBy: varchar("updated_by", { length: 128 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("platform_setting_version_positive", sql`${table.version} > 0`),
    check(
      "platform_setting_public_not_secret",
      sql`NOT (${table.isPublic} AND ${table.isSecret})`,
    ),
  ],
);

/**
 * Durable runtime checkpoint used by the serializable transaction coordinator.
 *
 * `runtimeMode` is intentionally immutable at the database layer. A simulation
 * process must never open real-value state, and a real-value process must never
 * inherit mock capital or payment history.
 */
export const runtimeStateCheckpoints = pgTable(
  "runtime_state_checkpoints",
  {
    runtimeKey: varchar("runtime_key", { length: 160 }).primaryKey(),
    runtimeMode: varchar("runtime_mode", { length: 16 }).notNull(),
    generation: bigint("generation", { mode: "bigint" }).notNull(),
    coordinatorSchemaVersion: integer("coordinator_schema_version")
      .default(1)
      .notNull(),
    snapshotFormat: varchar("snapshot_format", { length: 96 }).notNull(),
    snapshotEncoding: varchar("snapshot_encoding", { length: 64 }).notNull(),
    snapshotPayload: text("snapshot_payload").notNull(),
    snapshotSha256: varchar("snapshot_sha256", { length: 64 }).notNull(),
    writerId: varchar("writer_id", { length: 128 }).notNull(),
    lastMutationId: varchar("last_mutation_id", { length: 200 }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "runtime_checkpoint_mode_valid",
      sql`${table.runtimeMode} IN ('simulation', 'real')`,
    ),
    check(
      "runtime_checkpoint_generation_positive",
      sql`${table.generation} > 0`,
    ),
    check(
      "runtime_checkpoint_schema_version_positive",
      sql`${table.coordinatorSchemaVersion} > 0`,
    ),
    check(
      "runtime_checkpoint_payload_nonempty",
      sql`length(${table.snapshotPayload}) > 0`,
    ),
    check(
      "runtime_checkpoint_sha256_valid",
      sql`${table.snapshotSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "runtime_checkpoint_metadata_object",
      sql`jsonb_typeof(${table.metadata}) = 'object'`,
    ),
    index("runtime_checkpoint_mode_updated_idx").on(
      table.runtimeMode,
      table.updatedAt,
    ),
  ],
);

/**
 * Append-only digest history for checkpoint generations. The migration creates
 * the trigger that writes this table for every checkpoint insert/update.
 */
export const runtimeStateTransitions = pgTable(
  "runtime_state_transitions",
  {
    sequence: bigserial("sequence", { mode: "bigint" }).primaryKey(),
    runtimeKey: varchar("runtime_key", { length: 160 })
      .notNull()
      .references(() => runtimeStateCheckpoints.runtimeKey, {
        onDelete: "restrict",
      }),
    runtimeMode: varchar("runtime_mode", { length: 16 }).notNull(),
    fromGeneration: bigint("from_generation", { mode: "bigint" }),
    toGeneration: bigint("to_generation", { mode: "bigint" }).notNull(),
    snapshotFormat: varchar("snapshot_format", { length: 96 }).notNull(),
    snapshotEncoding: varchar("snapshot_encoding", { length: 64 }).notNull(),
    snapshotSha256: varchar("snapshot_sha256", { length: 64 }).notNull(),
    writerId: varchar("writer_id", { length: 128 }).notNull(),
    mutationId: varchar("mutation_id", { length: 200 }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("runtime_transition_generation_unique").on(
      table.runtimeKey,
      table.toGeneration,
    ),
    check(
      "runtime_transition_mode_valid",
      sql`${table.runtimeMode} IN ('simulation', 'real')`,
    ),
    check(
      "runtime_transition_generation_positive",
      sql`${table.toGeneration} > 0`,
    ),
    check(
      "runtime_transition_generation_step",
      sql`${table.fromGeneration} IS NULL OR ${table.toGeneration} = ${table.fromGeneration} + 1`,
    ),
    check(
      "runtime_transition_sha256_valid",
      sql`${table.snapshotSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "runtime_transition_metadata_object",
      sql`jsonb_typeof(${table.metadata}) = 'object'`,
    ),
    index("runtime_transition_created_idx").on(
      table.runtimeKey,
      table.createdAt,
    ),
  ],
);

export const ledgerAccountBalances = pgView("ledger_account_balances", {
  ledgerAccountId: uuid("ledger_account_id").notNull(),
  agentId: uuid("agent_id"),
  code: varchar("code", { length: 96 }).notNull(),
  asset: varchar("asset", { length: 32 }).notNull(),
  network: varchar("network", { length: 64 }).notNull(),
  balanceBucket: varchar("balance_bucket", { length: 64 }).notNull(),
  proofOfEarnEligible: boolean("proof_of_earn_eligible").notNull(),
  normalBalance: ledgerNormalBalanceEnum("normal_balance").notNull(),
  balanceMinor: bigint("balance_minor", { mode: "bigint" }).notNull(),
}).existing();

export const agentBalanceBuckets = pgView("agent_balance_buckets", {
  agentId: uuid("agent_id").notNull(),
  asset: varchar("asset", { length: 32 }).notNull(),
  network: varchar("network", { length: 64 }).notNull(),
  balanceBucket: varchar("balance_bucket", { length: 64 }).notNull(),
  proofOfEarnEligible: boolean("proof_of_earn_eligible").notNull(),
  balanceMinor: bigint("balance_minor", { mode: "bigint" }).notNull(),
}).existing();

export const capitalLotAvailability = pgView("capital_lot_availability", {
  capitalLotId: uuid("capital_lot_id").notNull(),
  agentId: uuid("agent_id").notNull(),
  asset: varchar("asset", { length: 32 }).notNull(),
  network: varchar("network", { length: 64 }).notNull(),
  originType: originTypeEnum("origin_type").notNull(),
  status: capitalLotStatusEnum("status").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  reservedMinor: bigint("reserved_minor", { mode: "bigint" }).notNull(),
  spentMinor: bigint("spent_minor", { mode: "bigint" }).notNull(),
  availableMinor: bigint("available_minor", { mode: "bigint" }).notNull(),
}).existing();

export * from "./enums.js";
