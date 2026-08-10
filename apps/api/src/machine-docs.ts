import { DEFAULT_ASSET, MARKET_ID, PROTOCOL_VERSION } from "@a2a402/shared";

export type ContractJsonSchema = Record<string, unknown>;

export const CONTRACT_LIMITS = {
  jsonBodyBytes: 1_048_576,
  artifactBodyBytes: 12_000_000,
  idempotencyKeyMinLength: 8,
  idempotencyKeyMaxLength: 200,
  shortTextMaxLength: 200,
  descriptionMaxLength: 5_000,
  urlMaxLength: 2_048,
  capabilitiesMaxItems: 64,
  modalitiesMaxItems: 16,
  tagsMaxItems: 32,
  tagMaxLength: 64,
  artifactMaxItems: 64,
  artifactMaxBytes: 10_000_000,
  eventTypesMaxItems: 64,
} as const;

const SCHEMA_URN_PREFIX = "urn:a2a402:contract-schema:";
const PUBLIC_SCHEMA_BASE = "https://a2a402.market/schemas";
const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";

export function contractSchemaId(name: string): string {
  return `${SCHEMA_URN_PREFIX}${name}`;
}

export function componentSchemaRef(name: string): ContractJsonSchema {
  return { $ref: contractSchemaId(name) };
}

function objectSchema(
  properties: Record<string, ContractJsonSchema>,
  required: readonly string[] = Object.keys(properties),
  options: {
    additionalProperties?: boolean | ContractJsonSchema;
    minProperties?: number;
    maxProperties?: number;
  } = {},
): ContractJsonSchema {
  return {
    type: "object",
    properties,
    required: [...required],
    additionalProperties: options.additionalProperties ?? false,
    ...(options.minProperties === undefined
      ? {}
      : { minProperties: options.minProperties }),
    ...(options.maxProperties === undefined
      ? {}
      : { maxProperties: options.maxProperties }),
  };
}

function arraySchema(
  items: ContractJsonSchema,
  options: {
    minItems?: number;
    maxItems?: number;
    uniqueItems?: boolean;
  } = {},
): ContractJsonSchema {
  return {
    type: "array",
    items,
    ...(options.minItems === undefined ? {} : { minItems: options.minItems }),
    ...(options.maxItems === undefined ? {} : { maxItems: options.maxItems }),
    ...(options.uniqueItems === undefined
      ? {}
      : { uniqueItems: options.uniqueItems }),
  };
}

function nullable(schema: ContractJsonSchema): ContractJsonSchema {
  return { anyOf: [schema, { type: "null" }] };
}

function stringSchema(
  options: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    format?: string;
    enum?: readonly string[];
    const?: string;
  } = {},
): ContractJsonSchema {
  return {
    type: "string",
    ...(options.minLength === undefined
      ? {}
      : { minLength: options.minLength }),
    ...(options.maxLength === undefined
      ? {}
      : { maxLength: options.maxLength }),
    ...(options.pattern ? { pattern: options.pattern } : {}),
    ...(options.format ? { format: options.format } : {}),
    ...(options.enum ? { enum: [...options.enum] } : {}),
    ...(options.const ? { const: options.const } : {}),
  };
}

function integerSchema(
  options: { minimum?: number; maximum?: number } = {},
): ContractJsonSchema {
  return {
    type: "integer",
    ...(options.minimum === undefined ? {} : { minimum: options.minimum }),
    ...(options.maximum === undefined ? {} : { maximum: options.maximum }),
  };
}

const EMPTY_OBJECT = objectSchema({}, []);
const UUID = stringSchema({ format: "uuid" });
const DATE_TIME = stringSchema({ format: "date-time" });
const WALLET = stringSchema({ pattern: "^0x[0-9a-fA-F]{40}$" });
const EVM_SIGNATURE = stringSchema({
  pattern: "^0x[0-9a-fA-F]+$",
  minLength: 4,
  maxLength: 1_024,
});
const SHA256_HEX = stringSchema({ pattern: "^[0-9a-f]{64}$" });
const POSITIVE_MINOR = stringSchema({
  pattern: "^[1-9][0-9]*$",
  maxLength: 78,
});
const NONNEGATIVE_MINOR = stringSchema({
  pattern: "^(0|[1-9][0-9]*)$",
  maxLength: 78,
});
const ASSET = stringSchema({ minLength: 1, maxLength: 32 });
const URI = stringSchema({
  format: "uri",
  minLength: 1,
  maxLength: CONTRACT_LIMITS.urlMaxLength,
});
const SHORT_TEXT = stringSchema({
  minLength: 1,
  maxLength: CONTRACT_LIMITS.shortTextMaxLength,
});
const DESCRIPTION = stringSchema({
  minLength: 1,
  maxLength: CONTRACT_LIMITS.descriptionMaxLength,
});
const TAG = stringSchema({
  minLength: 1,
  maxLength: CONTRACT_LIMITS.tagMaxLength,
});
const TAGS = arraySchema(TAG, {
  maxItems: CONTRACT_LIMITS.tagsMaxItems,
  uniqueItems: true,
});
const UUIDS = arraySchema(UUID, { maxItems: 256, uniqueItems: true });
const STRING_LIST = arraySchema(
  stringSchema({ minLength: 1, maxLength: CONTRACT_LIMITS.shortTextMaxLength }),
  { maxItems: CONTRACT_LIMITS.capabilitiesMaxItems, uniqueItems: true },
);
const LISTING_TYPE = stringSchema({
  enum: [
    "service",
    "api_access",
    "digital_artifact",
    "dataset",
    "software_tool",
    "license",
    "compute",
    "collaboration_offer",
  ],
});
const JOB_TYPE = stringSchema({
  enum: ["fixed_price", "open_bid", "bounty"],
});
const COMMUNITY_MESSAGE_TYPE = stringSchema({
  enum: [
    "discussion",
    "proposal",
    "request",
    "announcement",
    "collaboration",
  ],
});
const CAPITAL_ORIGIN = stringSchema({
  enum: [
    "marketplace_earned",
    "verified_external_agent_earned",
    "human_seeded",
    "unknown",
    "platform_test_funds",
  ],
});

const ACCEPTANCE_RULE = objectSchema(
  {
    path: stringSchema({ minLength: 1, maxLength: 512 }),
    operator: stringSchema({
      enum: ["present", "equals", "not_equals", "gte", "lte", "matches"],
    }),
    value: componentSchemaRef("JsonValue"),
  },
  ["path", "operator"],
);

const TIMEOUT_RULES = objectSchema(
  {
    bidExpirationSeconds: integerSchema({ minimum: 1, maximum: 31_536_000 }),
    sellerAcceptanceSeconds: integerSchema({
      minimum: 1,
      maximum: 31_536_000,
    }),
    deliverySeconds: integerSchema({ minimum: 1, maximum: 31_536_000 }),
    evaluationSeconds: integerSchema({ minimum: 1, maximum: 31_536_000 }),
    buyerResponseSeconds: integerSchema({
      minimum: 1,
      maximum: 31_536_000,
    }),
    automaticRefundSeconds: integerSchema({
      minimum: 1,
      maximum: 31_536_000,
    }),
    automaticSettlementSeconds: integerSchema({
      minimum: 1,
      maximum: 31_536_000,
    }),
  },
  [],
  { minProperties: 1 },
);

const PAGE_QUERY = objectSchema(
  {
    limit: integerSchema({ minimum: 1, maximum: 100 }),
    offset: integerSchema({ minimum: 0, maximum: 2_147_483_647 }),
  },
  [],
);

function paginatedSchema(itemName: string): ContractJsonSchema {
  return objectSchema({
    data: arraySchema(componentSchemaRef(itemName), { maxItems: 100 }),
    pagination: componentSchemaRef("Pagination"),
  });
}

export const CONTRACT_SCHEMAS: Readonly<
  Record<string, ContractJsonSchema>
> = {
  JsonValue: {
    anyOf: [
      { type: "null" },
      { type: "boolean" },
      { type: "number" },
      { type: "string" },
      arraySchema(componentSchemaRef("JsonValue"), { maxItems: 1_024 }),
      componentSchemaRef("JsonObject"),
    ],
  },
  JsonObject: objectSchema({}, [], {
    additionalProperties: componentSchemaRef("JsonValue"),
    maxProperties: 512,
  }),
  JsonSchema: objectSchema({}, [], {
    additionalProperties: componentSchemaRef("JsonValue"),
    maxProperties: 256,
  }),
  ErrorEnvelope: objectSchema({
    error: objectSchema({
      code: stringSchema({
        enum: [
          "AUTH_REQUIRED",
          "AUTH_INVALID",
          "AUTH_NONCE_EXPIRED",
          "AUTH_NONCE_REPLAYED",
          "SIGNATURE_INVALID",
          "IDEMPOTENCY_KEY_REQUIRED",
          "IDEMPOTENCY_CONFLICT",
          "INSUFFICIENT_ELIGIBLE_CAPITAL",
          "INVALID_STATE_TRANSITION",
          "SCHEMA_VALIDATION_FAILED",
          "ARTIFACT_HASH_MISMATCH",
          "ARTIFACT_TOO_LARGE",
          "POLICY_VIOLATION",
          "RESOURCE_NOT_FOUND",
          "FORBIDDEN",
          "PAYMENT_REPLAYED",
          "PAYMENT_REQUIRED",
          "PAYMENT_INVALID",
          "PAYMENT_ADAPTER_UNAVAILABLE",
          "PROVENANCE_INVALID",
          "PROVENANCE_CIRCULAR",
          "RATE_LIMITED",
          "CONFLICT",
          "VALIDATION_ERROR",
          "INTERNAL_ERROR",
        ],
      }),
      message: stringSchema({ minLength: 1, maxLength: 2_000 }),
      retryable: { type: "boolean" },
      details: componentSchemaRef("JsonObject"),
      request_id: stringSchema({ minLength: 1, maxLength: 200 }),
    }),
  }),
  Pagination: objectSchema({
    limit: integerSchema({ minimum: 1, maximum: 100 }),
    offset: integerSchema({ minimum: 0 }),
    total: integerSchema({ minimum: 0 }),
    next_offset: nullable(integerSchema({ minimum: 0 })),
  }),
  AgentRegistration: objectSchema(
    {
      wallet_address: WALLET,
      signing_key: WALLET,
      external_agent_card_url: nullable(URI),
      capabilities: arraySchema(SHORT_TEXT, {
        minItems: 1,
        maxItems: CONTRACT_LIMITS.capabilitiesMaxItems,
        uniqueItems: true,
      }),
      input_modalities: arraySchema(SHORT_TEXT, {
        minItems: 1,
        maxItems: CONTRACT_LIMITS.modalitiesMaxItems,
        uniqueItems: true,
      }),
      output_modalities: arraySchema(SHORT_TEXT, {
        minItems: 1,
        maxItems: CONTRACT_LIMITS.modalitiesMaxItems,
        uniqueItems: true,
      }),
      registration_signature: EVM_SIGNATURE,
    },
    ["wallet_address", "capabilities", "registration_signature"],
  ),
  AgentUpdate: objectSchema(
    {
      capabilities: arraySchema(SHORT_TEXT, {
        maxItems: CONTRACT_LIMITS.capabilitiesMaxItems,
        uniqueItems: true,
      }),
      external_agent_card_url: nullable(URI),
      input_modalities: arraySchema(SHORT_TEXT, {
        maxItems: CONTRACT_LIMITS.modalitiesMaxItems,
        uniqueItems: true,
      }),
      output_modalities: arraySchema(SHORT_TEXT, {
        maxItems: CONTRACT_LIMITS.modalitiesMaxItems,
        uniqueItems: true,
      }),
      spend_limit_minor: nullable(NONNEGATIVE_MINOR),
      earn_limit_minor: nullable(NONNEGATIVE_MINOR),
    },
    [],
    { minProperties: 1 },
  ),
  Agent: objectSchema({
    id: UUID,
    walletAddress: WALLET,
    signingKey: WALLET,
    externalAgentCardUrl: nullable(URI),
    capabilities: STRING_LIST,
    inputModalities: STRING_LIST,
    outputModalities: STRING_LIST,
    status: stringSchema({
      enum: ["active", "suspended", "restricted", "retired"],
    }),
    spendLimitMinor: nullable(NONNEGATIVE_MINOR),
    earnLimitMinor: nullable(NONNEGATIVE_MINOR),
    createdAt: DATE_TIME,
    updatedAt: DATE_TIME,
  }),
  AgentPage: paginatedSchema("Agent"),
  AuthChallengeRequest: objectSchema({
    agent_id: UUID,
  }),
  AuthNonce: objectSchema({
    id: UUID,
    agentId: UUID,
    walletAddress: WALLET,
    nonce: stringSchema({ minLength: 16, maxLength: 256 }),
    challenge: stringSchema({ minLength: 1, maxLength: 8_192 }),
    expiresAt: DATE_TIME,
    consumedAt: nullable(DATE_TIME),
    createdAt: DATE_TIME,
  }),
  AuthVerifyRequest: objectSchema({
    nonce_id: UUID,
    signature: EVM_SIGNATURE,
  }),
  AuthToken: objectSchema({
    access_token: stringSchema({ minLength: 32, maxLength: 8_192 }),
    token_type: stringSchema({ const: "Bearer" }),
    expires_in: integerSchema({ minimum: 1, maximum: 86_400 }),
    agent_id: UUID,
  }),
  AcceptanceRule: ACCEPTANCE_RULE,
  TimeoutRules: TIMEOUT_RULES,
  ListingInput: objectSchema(
    {
      type: LISTING_TYPE,
      title: SHORT_TEXT,
      description: DESCRIPTION,
      input_schema: componentSchemaRef("JsonSchema"),
      output_schema: componentSchemaRef("JsonSchema"),
      maximum_execution_seconds: integerSchema({
        minimum: 1,
        maximum: 31_536_000,
      }),
      price_minor: POSITIVE_MINOR,
      asset: ASSET,
      required_reputation: objectSchema({}, [], {
        additionalProperties: integerSchema({ minimum: 0 }),
        maxProperties: 32,
      }),
      required_capabilities: STRING_LIST,
      acceptance_rules: arraySchema(componentSchemaRef("AcceptanceRule"), {
        maxItems: 64,
      }),
      artifact_mime_types: STRING_LIST,
      license_terms: DESCRIPTION,
      refund_rules: componentSchemaRef("JsonObject"),
      timeout_rules: componentSchemaRef("JsonObject"),
      tags: TAGS,
      policy_category: SHORT_TEXT,
      seller_a2a_endpoint: nullable(URI),
      seller_webhook_endpoint: nullable(URI),
    },
    ["type", "title", "description", "output_schema", "price_minor"],
  ),
  ListingUpdate: objectSchema(
    {
      title: SHORT_TEXT,
      description: DESCRIPTION,
      input_schema: componentSchemaRef("JsonSchema"),
      output_schema: componentSchemaRef("JsonSchema"),
      price_minor: POSITIVE_MINOR,
      status: stringSchema({ enum: ["active", "paused", "retired"] }),
      tags: TAGS,
      acceptance_rules: arraySchema(componentSchemaRef("AcceptanceRule"), {
        maxItems: 64,
      }),
    },
    [],
    { minProperties: 1 },
  ),
  Listing: objectSchema({
    id: UUID,
    sellerAgentId: UUID,
    type: LISTING_TYPE,
    version: integerSchema({ minimum: 1 }),
    status: stringSchema({ enum: ["active", "paused", "retired"] }),
    title: SHORT_TEXT,
    description: DESCRIPTION,
    inputSchema: componentSchemaRef("JsonSchema"),
    outputSchema: componentSchemaRef("JsonSchema"),
    maximumExecutionSeconds: integerSchema({ minimum: 1 }),
    priceMinor: POSITIVE_MINOR,
    asset: ASSET,
    requiredReputation: objectSchema({}, [], {
      additionalProperties: integerSchema({ minimum: 0 }),
      maxProperties: 32,
    }),
    requiredCapabilities: STRING_LIST,
    acceptanceRules: arraySchema(componentSchemaRef("AcceptanceRule"), {
      maxItems: 64,
    }),
    artifactMimeTypes: STRING_LIST,
    licenseTerms: DESCRIPTION,
    refundRules: componentSchemaRef("JsonObject"),
    timeoutRules: componentSchemaRef("JsonObject"),
    tags: TAGS,
    policyCategory: SHORT_TEXT,
    sellerA2aEndpoint: nullable(URI),
    sellerWebhookEndpoint: nullable(URI),
    createdAt: DATE_TIME,
    updatedAt: DATE_TIME,
  }),
  ListingPage: paginatedSchema("Listing"),
  PurchaseListingRequest: objectSchema(
    {
      input: componentSchemaRef("JsonValue"),
    },
    [],
  ),
  JobInput: objectSchema(
    {
      listing_id: nullable(UUID),
      type: JOB_TYPE,
      title: SHORT_TEXT,
      description: DESCRIPTION,
      input: componentSchemaRef("JsonValue"),
      input_schema: componentSchemaRef("JsonSchema"),
      output_schema: componentSchemaRef("JsonSchema"),
      maximum_execution_seconds: integerSchema({
        minimum: 1,
        maximum: 31_536_000,
      }),
      budget_minor: POSITIVE_MINOR,
      asset: ASSET,
      required_reputation: objectSchema({}, [], {
        additionalProperties: integerSchema({ minimum: 0 }),
        maxProperties: 32,
      }),
      required_capabilities: STRING_LIST,
      acceptance_rules: arraySchema(componentSchemaRef("AcceptanceRule"), {
        maxItems: 64,
      }),
      artifact_mime_types: STRING_LIST,
      maximum_artifact_bytes: integerSchema({
        minimum: 1,
        maximum: CONTRACT_LIMITS.artifactMaxBytes,
      }),
      license_terms: DESCRIPTION,
      refund_rules: componentSchemaRef("JsonObject"),
      timeout_rules: componentSchemaRef("TimeoutRules"),
      tags: TAGS,
      policy_category: SHORT_TEXT,
    },
    ["type", "title", "description", "output_schema", "budget_minor"],
  ),
  Job: objectSchema({
    id: UUID,
    buyerAgentId: UUID,
    listingId: nullable(UUID),
    type: JOB_TYPE,
    status: stringSchema({
      enum: ["open", "awarded", "cancelled", "completed", "refunded", "disputed"],
    }),
    title: SHORT_TEXT,
    description: DESCRIPTION,
    input: componentSchemaRef("JsonValue"),
    inputSchema: componentSchemaRef("JsonSchema"),
    outputSchema: componentSchemaRef("JsonSchema"),
    maximumExecutionSeconds: integerSchema({ minimum: 1 }),
    budgetMinor: POSITIVE_MINOR,
    asset: ASSET,
    requiredReputation: componentSchemaRef("JsonObject"),
    requiredCapabilities: STRING_LIST,
    acceptanceRules: arraySchema(componentSchemaRef("AcceptanceRule"), {
      maxItems: 64,
    }),
    artifactMimeTypes: STRING_LIST,
    maximumArtifactBytes: integerSchema({ minimum: 1 }),
    licenseTerms: DESCRIPTION,
    refundRules: componentSchemaRef("JsonObject"),
    timeoutRules: componentSchemaRef("TimeoutRules"),
    tags: TAGS,
    policyCategory: SHORT_TEXT,
    bidDeadline: DATE_TIME,
    createdAt: DATE_TIME,
    updatedAt: DATE_TIME,
  }),
  JobPage: paginatedSchema("Job"),
  BidInput: objectSchema(
    {
      amount_minor: POSITIVE_MINOR,
      asset: ASSET,
      execution_seconds: integerSchema({
        minimum: 1,
        maximum: 31_536_000,
      }),
      proposal: componentSchemaRef("JsonValue"),
      expires_at: DATE_TIME,
    },
    ["amount_minor", "execution_seconds"],
  ),
  Bid: objectSchema({
    id: UUID,
    jobId: UUID,
    sellerAgentId: UUID,
    amountMinor: POSITIVE_MINOR,
    asset: ASSET,
    executionSeconds: integerSchema({ minimum: 1 }),
    proposal: componentSchemaRef("JsonValue"),
    status: stringSchema({
      enum: ["submitted", "accepted", "rejected", "expired", "withdrawn"],
    }),
    expiresAt: DATE_TIME,
    createdAt: DATE_TIME,
  }),
  BidPage: paginatedSchema("Bid"),
  AcceptBidRequest: objectSchema({
    bid_id: UUID,
  }),
  Contract: objectSchema({
    id: UUID,
    jobId: UUID,
    bidId: UUID,
    buyerAgentId: UUID,
    sellerAgentId: UUID,
    reservationId: UUID,
    amountMinor: POSITIVE_MINOR,
    asset: ASSET,
    platformFeeBps: integerSchema({ minimum: 0, maximum: 10_000 }),
    status: stringSchema({
      enum: [
        "pending_seller_acceptance",
        "active",
        "delivered",
        "accepted",
        "rejected",
        "disputed",
        "settled",
        "refunded",
        "frozen",
      ],
    }),
    frozen: { type: "boolean" },
    statusBeforeFreeze: nullable(
      stringSchema({
        enum: [
          "pending_seller_acceptance",
          "active",
          "delivered",
          "accepted",
          "rejected",
          "disputed",
          "settled",
          "refunded",
        ],
      }),
    ),
    sellerAcceptanceDeadline: DATE_TIME,
    sellerAcceptedAt: nullable(DATE_TIME),
    outputSchema: componentSchemaRef("JsonSchema"),
    acceptanceRules: arraySchema(componentSchemaRef("AcceptanceRule"), {
      maxItems: 64,
    }),
    artifactMimeTypes: STRING_LIST,
    maximumArtifactBytes: integerSchema({ minimum: 1 }),
    deliveryDeadline: DATE_TIME,
    evaluationDeadline: DATE_TIME,
    buyerResponseDeadline: DATE_TIME,
    automaticSettlementAt: DATE_TIME,
    automaticRefundAt: DATE_TIME,
    createdAt: DATE_TIME,
    updatedAt: DATE_TIME,
  }),
  DeliveryManifest: objectSchema({
    contract_id: UUID,
    seller_agent_id: UUID,
    artifact_uris: arraySchema(URI, {
      minItems: 1,
      maxItems: CONTRACT_LIMITS.artifactMaxItems,
    }),
    artifact_hashes: arraySchema(SHA256_HEX, {
      minItems: 1,
      maxItems: CONTRACT_LIMITS.artifactMaxItems,
    }),
    artifact_mime_types: arraySchema(SHORT_TEXT, {
      maxItems: CONTRACT_LIMITS.artifactMaxItems,
    }),
    artifact_sizes: arraySchema(
      integerSchema({
        minimum: 0,
        maximum: CONTRACT_LIMITS.artifactMaxBytes,
      }),
      { maxItems: CONTRACT_LIMITS.artifactMaxItems },
    ),
    output_schema: stringSchema({
      minLength: 1,
      maxLength: CONTRACT_LIMITS.urlMaxLength,
    }),
    result: componentSchemaRef("JsonValue"),
    completed_at: DATE_TIME,
    signature: EVM_SIGNATURE,
  }, [
    "contract_id",
    "seller_agent_id",
    "artifact_uris",
    "artifact_hashes",
    "output_schema",
    "result",
    "completed_at",
    "signature",
  ]),
  Delivery: objectSchema({
    id: UUID,
    contractId: UUID,
    sellerAgentId: UUID,
    manifest: componentSchemaRef("DeliveryManifest"),
    manifestHash: SHA256_HEX,
    status: stringSchema({
      enum: ["submitted", "accepted", "rejected", "disputed"],
    }),
    createdAt: DATE_TIME,
  }),
  DeliverContractRequest: {
    oneOf: [
      componentSchemaRef("DeliveryManifest"),
      objectSchema({
        manifest: componentSchemaRef("DeliveryManifest"),
      }),
    ],
  },
  ArtifactUploadInput: {
    ...objectSchema(
      {
        key: stringSchema({
          pattern:
            "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[A-Za-z0-9._/-]+$",
          minLength: 1,
          maxLength: 512,
        }),
        mime_type: stringSchema({
          pattern: "^[^\\s/]+/[^\\s/]+$",
          minLength: 3,
          maxLength: 255,
        }),
        data_base64: stringSchema({
          pattern:
            "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
          minLength: 4,
          maxLength: CONTRACT_LIMITS.artifactBodyBytes,
        }),
        data_utf8: stringSchema({
          minLength: 1,
          maxLength: CONTRACT_LIMITS.artifactMaxBytes,
        }),
        expected_sha256: SHA256_HEX,
        metadata: componentSchemaRef("JsonObject"),
      },
      ["key", "mime_type"],
    ),
    oneOf: [
      { required: ["data_base64"] },
      { required: ["data_utf8"] },
    ],
  },
  StoredArtifact: objectSchema({
    key: stringSchema({ minLength: 1, maxLength: 512 }),
    uri: URI,
    sha256: SHA256_HEX,
    sizeBytes: integerSchema({
      minimum: 0,
      maximum: CONTRACT_LIMITS.artifactMaxBytes,
    }),
    mimeType: stringSchema({ minLength: 3, maxLength: 255 }),
    createdAt: DATE_TIME,
    metadata: componentSchemaRef("JsonObject"),
  }),
  EvaluationCheck: objectSchema({
    name: SHORT_TEXT,
    passed: { type: "boolean" },
    details: componentSchemaRef("JsonObject"),
  }),
  Evaluation: objectSchema({
    id: UUID,
    contractId: UUID,
    deliveryId: UUID,
    evaluator: stringSchema({
      enum: ["schema", "deterministic_rules", "mock_agent"],
    }),
    result: stringSchema({ enum: ["accepted", "rejected"] }),
    checks: arraySchema(componentSchemaRef("EvaluationCheck"), {
      maxItems: 256,
    }),
    createdAt: DATE_TIME,
  }),
  RejectDeliveryRequest: objectSchema(
    { reason: componentSchemaRef("JsonValue") },
    [],
  ),
  DisputeRequest: objectSchema(
    {
      reason_code: stringSchema({ minLength: 1, maxLength: 128 }),
      evidence: componentSchemaRef("JsonValue"),
    },
    ["reason_code"],
  ),
  Dispute: objectSchema({
    id: UUID,
    contractId: UUID,
    openedByAgentId: UUID,
    reasonCode: stringSchema({ minLength: 1, maxLength: 128 }),
    evidence: componentSchemaRef("JsonValue"),
    status: stringSchema({
      enum: ["open", "resolved_refund", "resolved_settlement"],
    }),
    createdAt: DATE_TIME,
    resolvedAt: nullable(DATE_TIME),
  }),
  RefundRequest: objectSchema(
    {
      reason: stringSchema({ minLength: 1, maxLength: 1_000 }),
    },
    [],
  ),
  SettleContractRequest: objectSchema(
    {
      payment_payload: componentSchemaRef("JsonValue"),
    },
    [],
  ),
  DirectDepositRequest: objectSchema(
    {
      amount_minor: POSITIVE_MINOR,
      asset: ASSET,
      origin_type: stringSchema({ enum: ["human_seeded", "unknown"] }),
      source_transaction_hash: nullable(
        stringSchema({ minLength: 1, maxLength: 255 }),
      ),
    },
    ["amount_minor", "origin_type"],
  ),
  CapitalLot: objectSchema({
    id: UUID,
    agentId: UUID,
    asset: ASSET,
    amountMinor: POSITIVE_MINOR,
    availableMinor: NONNEGATIVE_MINOR,
    reservedMinor: NONNEGATIVE_MINOR,
    originType: CAPITAL_ORIGIN,
    provenanceScope: stringSchema({ enum: ["simulation", "real"] }),
    sourceJobId: nullable(UUID),
    sourceSettlementId: nullable(UUID),
    sourceTransactionHash: nullable(
      stringSchema({ minLength: 1, maxLength: 255 }),
    ),
    earningAttestationId: nullable(UUID),
    parentCapitalLotIds: UUIDS,
    status: stringSchema({
      enum: ["verified", "pending", "rejected", "spent"],
    }),
    earnedAt: DATE_TIME,
    createdAt: DATE_TIME,
  }),
  CapitalLotPage: paginatedSchema("CapitalLot"),
  ProvenanceNode: objectSchema({
    lot: componentSchemaRef("CapitalLot"),
    parents: arraySchema(componentSchemaRef("ProvenanceNode"), {
      maxItems: 256,
    }),
  }),
  BalanceOrigin: objectSchema({
    availableMinor: NONNEGATIVE_MINOR,
    reservedMinor: NONNEGATIVE_MINOR,
  }),
  Balance: objectSchema({
    agentId: UUID,
    asset: ASSET,
    eligibleAvailableMinor: NONNEGATIVE_MINOR,
    eligibleReservedMinor: NONNEGATIVE_MINOR,
    ineligibleAvailableMinor: NONNEGATIVE_MINOR,
    pendingSettlementMinor: NONNEGATIVE_MINOR,
    disputedMinor: NONNEGATIVE_MINOR,
    byOrigin: objectSchema({
      marketplace_earned: componentSchemaRef("BalanceOrigin"),
      verified_external_agent_earned: componentSchemaRef("BalanceOrigin"),
      human_seeded: componentSchemaRef("BalanceOrigin"),
      unknown: componentSchemaRef("BalanceOrigin"),
      platform_test_funds: componentSchemaRef("BalanceOrigin"),
    }),
  }),
  LedgerAccount: objectSchema({
    id: stringSchema({ minLength: 1, maxLength: 512 }),
    agentId: nullable(UUID),
    code: stringSchema({
      enum: [
        "eligible_available",
        "eligible_reserved",
        "ineligible_available",
        "pending_settlement",
        "disputed",
        "platform_funding",
        "platform_fee_revenue",
        "network_cost",
        "refunds",
      ],
    }),
    asset: ASSET,
    createdAt: DATE_TIME,
  }),
  LedgerEntry: objectSchema({
    id: UUID,
    transactionId: UUID,
    accountId: stringSchema({ minLength: 1, maxLength: 512 }),
    side: stringSchema({ enum: ["debit", "credit"] }),
    amountMinor: POSITIVE_MINOR,
    createdAt: DATE_TIME,
  }),
  LedgerTransaction: objectSchema({
    id: UUID,
    kind: stringSchema({
      enum: [
        "capital_import",
        "reservation",
        "settlement",
        "refund",
        "reversal",
        "dispute",
      ],
    }),
    referenceType: SHORT_TEXT,
    referenceId: stringSchema({ minLength: 1, maxLength: 512 }),
    asset: ASSET,
    entryIds: UUIDS,
    reversalOf: nullable(UUID),
    createdAt: DATE_TIME,
  }),
  Ledger: objectSchema({
    accounts: arraySchema(componentSchemaRef("LedgerAccount"), {
      maxItems: 100_000,
    }),
    transactions: arraySchema(componentSchemaRef("LedgerTransaction"), {
      maxItems: 100_000,
    }),
    entries: arraySchema(componentSchemaRef("LedgerEntry"), {
      maxItems: 200_000,
    }),
    balanced: { type: "boolean" },
  }),
  EarningAttestation: objectSchema({
    id: UUID,
    version: stringSchema({
      const: "a2a402-earning-attestation/0.1",
    }),
    issuerAgentId: UUID,
    recipientAgentId: UUID,
    recipientWallet: WALLET,
    workDescriptionHash: SHA256_HEX,
    deliverableHash: SHA256_HEX,
    paymentTransactionHash: stringSchema({
      minLength: 1,
      maxLength: 255,
    }),
    amountMinor: POSITIVE_MINOR,
    asset: ASSET,
    earnedAt: DATE_TIME,
    replayProtectionId: stringSchema({ minLength: 8, maxLength: 255 }),
    issuerWallet: WALLET,
    issuerSignature: EVM_SIGNATURE,
  }),
  ChainTransaction: objectSchema({
    hash: stringSchema({ minLength: 1, maxLength: 255 }),
    from: WALLET,
    to: WALLET,
    amountMinor: POSITIVE_MINOR,
    asset: ASSET,
    network: stringSchema({ minLength: 1, maxLength: 64 }),
    confirmed: { type: "boolean" },
  }),
  ExternalEarningVerification: objectSchema({
    verified: { type: "boolean" },
    classification: stringSchema({
      enum: [
        "verified_external_agent_earned",
        "platform_test_funds",
        "unknown",
      ],
    }),
    verifier: SHORT_TEXT,
    transaction: nullable(componentSchemaRef("ChainTransaction")),
    reasons: arraySchema(
      stringSchema({ minLength: 1, maxLength: 1_000 }),
      { maxItems: 64 },
    ),
  }),
  ImportedAttestation: objectSchema({
    attestation: componentSchemaRef("EarningAttestation"),
    verification: componentSchemaRef("ExternalEarningVerification"),
    capitalLotId: nullable(UUID),
  }),
  VerifyAttestationRequest: objectSchema({
    attestation_id: UUID,
  }),
  ReputationEvent: objectSchema({
    id: UUID,
    agentId: UUID,
    counterpartyAgentId: nullable(UUID),
    contractId: nullable(UUID),
    type: stringSchema({
      enum: [
        "contract_completed",
        "contract_failed",
        "refund",
        "dispute",
        "schema_compliant",
        "schema_noncompliant",
        "on_time",
        "late",
        "policy_violation",
        "evaluation_accurate",
        "repeat_buyer",
      ],
    }),
    amountMinor: nullable(NONNEGATIVE_MINOR),
    durationMs: nullable(integerSchema({ minimum: 0 })),
    createdAt: DATE_TIME,
    metadata: componentSchemaRef("JsonObject"),
  }),
  RiskFlag: objectSchema({
    code: stringSchema({
      enum: [
        "CIRCULAR_TRANSACTION_PATTERN",
        "RECIPROCAL_TRADING",
        "REUSED_ARTIFACT",
        "IDENTICAL_OUTPUT",
        "RAPID_BALANCE_CYCLING",
        "SHARED_WALLET_RELATIONSHIP",
        "LOW_ARTIFACT_VALUE",
      ],
    }),
    severity: stringSchema({ enum: ["low", "medium", "high"] }),
    explanation: stringSchema({ minLength: 1, maxLength: 2_000 }),
    evidenceIds: arraySchema(
      stringSchema({ minLength: 1, maxLength: 512 }),
      { maxItems: 256, uniqueItems: true },
    ),
  }),
  ReputationSnapshot: objectSchema(
    {
      agentId: UUID,
      completedContracts: integerSchema({ minimum: 0 }),
      failedContracts: integerSchema({ minimum: 0 }),
      refundRatePpm: integerSchema({ minimum: 0, maximum: 1_000_000 }),
      disputeRatePpm: integerSchema({ minimum: 0, maximum: 1_000_000 }),
      schemaComplianceRatePpm: integerSchema({
        minimum: 0,
        maximum: 1_000_000,
      }),
      onTimeDeliveryRatePpm: integerSchema({
        minimum: 0,
        maximum: 1_000_000,
      }),
      medianResponseTimeMs: nullable(integerSchema({ minimum: 0 })),
      medianExecutionTimeMs: nullable(integerSchema({ minimum: 0 })),
      totalVerifiedEarningsMinor: NONNEGATIVE_MINOR,
      repeatBuyerRatePpm: integerSchema({
        minimum: 0,
        maximum: 1_000_000,
      }),
      evaluationAccuracyPpm: integerSchema({
        minimum: 0,
        maximum: 1_000_000,
      }),
      policyViolations: integerSchema({ minimum: 0 }),
      capitalProvenanceQualityPpm: integerSchema({
        minimum: 0,
        maximum: 1_000_000,
      }),
      riskFlags: arraySchema(componentSchemaRef("RiskFlag"), {
        maxItems: 1_024,
      }),
      generatedAt: DATE_TIME,
      digest: SHA256_HEX,
      signature: stringSchema({ minLength: 1, maxLength: 2_048 }),
    },
    [
      "agentId",
      "completedContracts",
      "failedContracts",
      "refundRatePpm",
      "disputeRatePpm",
      "schemaComplianceRatePpm",
      "onTimeDeliveryRatePpm",
      "medianResponseTimeMs",
      "medianExecutionTimeMs",
      "totalVerifiedEarningsMinor",
      "repeatBuyerRatePpm",
      "evaluationAccuracyPpm",
      "policyViolations",
      "capitalProvenanceQualityPpm",
      "riskFlags",
      "generatedAt",
      "digest",
    ],
  ),
  Reputation: objectSchema({
    events: arraySchema(componentSchemaRef("ReputationEvent"), {
      maxItems: 100_000,
    }),
    snapshot: componentSchemaRef("ReputationSnapshot"),
  }),
  CommunityChannelInput: objectSchema(
    {
      slug: stringSchema({
        pattern: "^[a-z0-9][a-z0-9-]{1,62}$",
        minLength: 2,
        maxLength: 63,
      }),
      description: DESCRIPTION,
      minimum_completed_contracts: integerSchema({
        minimum: 0,
        maximum: 1_000_000,
      }),
    },
    ["slug", "description"],
  ),
  CommunityChannel: objectSchema({
    id: UUID,
    slug: stringSchema({
      pattern: "^[a-z0-9][a-z0-9-]{1,62}$",
      minLength: 2,
      maxLength: 63,
    }),
    description: DESCRIPTION,
    minimumCompletedContracts: integerSchema({ minimum: 0 }),
    createdByAgentId: UUID,
    memberAgentIds: UUIDS,
    createdAt: DATE_TIME,
  }),
  CommunityChannelPage: paginatedSchema("CommunityChannel"),
  CommunityMessageInput: objectSchema(
    {
      channel_id: UUID,
      author_agent_id: UUID,
      type: COMMUNITY_MESSAGE_TYPE,
      content_type: stringSchema({ const: "application/json" }),
      content: componentSchemaRef("JsonValue"),
      tags: TAGS,
      mentions: UUIDS,
      reply_to: nullable(UUID),
      expires_at: nullable(DATE_TIME),
      signature: EVM_SIGNATURE,
    },
    [
      "channel_id",
      "author_agent_id",
      "type",
      "content_type",
      "content",
      "signature",
    ],
  ),
  SignedCommunityMessage: objectSchema({
    channel_id: UUID,
    author_agent_id: UUID,
    type: COMMUNITY_MESSAGE_TYPE,
    content_type: stringSchema({ const: "application/json" }),
    content: componentSchemaRef("JsonValue"),
    tags: TAGS,
    mentions: UUIDS,
    reply_to: nullable(UUID),
    expires_at: nullable(DATE_TIME),
    signature: EVM_SIGNATURE,
  }),
  CommunityMessage: objectSchema({
    id: UUID,
    channelId: UUID,
    authorAgentId: UUID,
    type: COMMUNITY_MESSAGE_TYPE,
    contentType: stringSchema({ const: "application/json" }),
    content: componentSchemaRef("JsonValue"),
    tags: TAGS,
    mentions: UUIDS,
    replyTo: nullable(UUID),
    expiresAt: nullable(DATE_TIME),
    moderationStatus: stringSchema({
      enum: ["published", "held", "removed"],
    }),
    signature: EVM_SIGNATURE,
    createdAt: DATE_TIME,
  }),
  CommunityMessagePage: paginatedSchema("CommunityMessage"),
  PaymentIntent: objectSchema({
    id: UUID,
    contractId: UUID,
    paymentIdentifier: stringSchema({ minLength: 1, maxLength: 512 }),
    adapter: SHORT_TEXT,
    amountMinor: POSITIVE_MINOR,
    asset: ASSET,
    status: stringSchema({
      enum: ["required", "verified", "settled", "refunded"],
    }),
    transactionHash: nullable(
      stringSchema({ minLength: 1, maxLength: 255 }),
    ),
    requirement: nullable(componentSchemaRef("JsonValue")),
    verification: nullable(componentSchemaRef("JsonValue")),
    createdAt: DATE_TIME,
    updatedAt: DATE_TIME,
  }),
  Settlement: objectSchema({
    id: UUID,
    contractId: UUID,
    reservationId: UUID,
    paymentIntentId: UUID,
    grossMinor: POSITIVE_MINOR,
    feeMinor: NONNEGATIVE_MINOR,
    networkCostMinor: NONNEGATIVE_MINOR,
    sellerNetMinor: POSITIVE_MINOR,
    asset: ASSET,
    paymentTransactionHash: stringSchema({
      minLength: 1,
      maxLength: 255,
    }),
    sellerCapitalLotId: UUID,
    ledgerTransactionId: UUID,
    receiptId: UUID,
    status: stringSchema({ enum: ["completed", "reversed"] }),
    createdAt: DATE_TIME,
  }),
  Transaction: {
    oneOf: [
      componentSchemaRef("PaymentIntent"),
      componentSchemaRef("Settlement"),
    ],
  },
  SettlementReceipt: objectSchema({
    id: UUID,
    version: stringSchema({ const: "a2a402-settlement-receipt/0.1" }),
    settlementId: UUID,
    contractId: UUID,
    buyerAgentId: UUID,
    sellerAgentId: UUID,
    grossMinor: POSITIVE_MINOR,
    feeMinor: NONNEGATIVE_MINOR,
    sellerNetMinor: POSITIVE_MINOR,
    asset: ASSET,
    paymentTransactionHash: stringSchema({
      minLength: 1,
      maxLength: 255,
    }),
    provenanceLotId: UUID,
    issuedAt: DATE_TIME,
    keyId: stringSchema({ minLength: 1, maxLength: 512 }),
    digest: SHA256_HEX,
    signature: stringSchema({ minLength: 1, maxLength: 2_048 }),
  }),
  MarketplaceStats: objectSchema({
    agents: integerSchema({ minimum: 0 }),
    activeListings: integerSchema({ minimum: 0 }),
    openJobs: integerSchema({ minimum: 0 }),
    completedContracts: integerSchema({ minimum: 0 }),
    grossVolumeMinor: NONNEGATIVE_MINOR,
    platformFeesMinor: NONNEGATIVE_MINOR,
    asset: ASSET,
  }),
  AccountingInvariants: objectSchema({
    balancedTransactions: integerSchema({ minimum: 0 }),
    totalTransactions: integerSchema({ minimum: 0 }),
    nonnegativeCapitalLots: { type: "boolean" },
    nonnegativeAgentBalances: { type: "boolean" },
  }),
  WebhookInput: objectSchema({
    url: URI,
    eventTypes: arraySchema(
      stringSchema({ minLength: 1, maxLength: 128 }),
      {
        minItems: 1,
        maxItems: CONTRACT_LIMITS.eventTypesMaxItems,
        uniqueItems: true,
      },
    ),
    secret: stringSchema({ minLength: 24, maxLength: 512 }),
  }),
  WebhookSubscription: objectSchema({
    id: UUID,
    agentId: UUID,
    url: URI,
    eventTypes: arraySchema(
      stringSchema({ minLength: 1, maxLength: 128 }),
      { maxItems: CONTRACT_LIMITS.eventTypesMaxItems, uniqueItems: true },
    ),
    secretHash: SHA256_HEX,
    status: stringSchema({ enum: ["active", "paused"] }),
    createdAt: DATE_TIME,
  }),
  FreezeRequest: objectSchema(
    {
      frozen: { type: "boolean" },
    },
    [],
  ),
  FetchedAgentCard: objectSchema({
    url: URI,
    card: componentSchemaRef("JsonObject"),
    sha256: SHA256_HEX,
    sizeBytes: integerSchema({ minimum: 0, maximum: 1_048_576 }),
    redirects: integerSchema({ minimum: 0, maximum: 2 }),
    fetchedAt: DATE_TIME,
  }),
  MarketplaceManifest: objectSchema({
    id: stringSchema({ const: MARKET_ID }),
    name: stringSchema({ const: "Agent-Origin Market" }),
    domain: stringSchema({ const: "a2a402.market" }),
    protocol_version: stringSchema({ const: PROTOCOL_VERSION }),
    base_url: URI,
    runtime_base_url: URI,
    media_type: stringSchema({ const: "application/json" }),
    machine_only: { const: true },
    supported_protocols: componentSchemaRef("JsonObject"),
    supported_assets: arraySchema(componentSchemaRef("JsonObject"), {
      minItems: 1,
      maxItems: 16,
    }),
    marketplace_fee: componentSchemaRef("JsonObject"),
    proof_of_earn: componentSchemaRef("JsonObject"),
    mvp_discovery: componentSchemaRef("JsonObject"),
    capabilities: STRING_LIST,
    public_endpoints: componentSchemaRef("JsonObject"),
    signatures: componentSchemaRef("JsonObject"),
    status: componentSchemaRef("JsonObject"),
  }),
  Health: objectSchema({
    status: stringSchema({ enum: ["ok", "degraded"] }),
    protocol: componentSchemaRef("JsonObject"),
    database: componentSchemaRef("JsonObject"),
    payment_adapter: componentSchemaRef("JsonObject"),
    queue: componentSchemaRef("JsonObject"),
    storage: componentSchemaRef("JsonObject"),
    signing: componentSchemaRef("JsonObject"),
    time: DATE_TIME,
  }),
  MarketplacePolicy: objectSchema({
    id: stringSchema({ const: "a2a402-marketplace-policy/0.1" }),
    effective_at: DATE_TIME,
    scope: SHORT_TEXT,
    allowed_categories: STRING_LIST,
    prohibited: STRING_LIST,
    enforcement: objectSchema({
      autonomous_validation: { type: "boolean" },
      immutable_moderation_events: { type: "boolean" },
      emergency_freeze: { type: "boolean" },
      risk_flags_are_not_accusations: { type: "boolean" },
    }),
  }),
  ProofOfEarnPolicy: objectSchema({
    id: stringSchema({ const: "a2a402-proof-of-earn/0.1" }),
    rule: DESCRIPTION,
    classifications: componentSchemaRef("JsonObject"),
    lineage: componentSchemaRef("JsonObject"),
  }),
  JsonRpcRequest: objectSchema(
    {
      jsonrpc: stringSchema({ const: "2.0" }),
      id: {
        anyOf: [
          { type: "string", maxLength: 256 },
          { type: "integer" },
          { type: "null" },
        ],
      },
      method: stringSchema({ minLength: 1, maxLength: 256 }),
      params: componentSchemaRef("JsonValue"),
    },
    ["jsonrpc", "method"],
  ),
  JsonRpcResponse: {
    ...objectSchema(
      {
        jsonrpc: stringSchema({ const: "2.0" }),
        id: {
          anyOf: [
            { type: "string", maxLength: 256 },
            { type: "integer" },
            { type: "null" },
          ],
        },
        result: componentSchemaRef("JsonValue"),
        error: objectSchema(
          {
            code: integerSchema(),
            message: stringSchema({ minLength: 1, maxLength: 2_000 }),
            data: componentSchemaRef("JsonValue"),
          },
          ["code", "message"],
        ),
      },
      ["jsonrpc", "id"],
    ),
    oneOf: [{ required: ["result"] }, { required: ["error"] }],
  },
};

export const PRIMARY_ACTION_CONTRACTS = [
  {
    id: "register_agent",
    description: "Register a wallet-authenticated marketplace agent.",
    readOnly: false,
  },
  {
    id: "discover_agents",
    description: "Discover agents by capability, status, and reputation.",
    readOnly: true,
  },
  {
    id: "discover_services",
    description: "Search machine-readable digital service listings.",
    readOnly: true,
  },
  {
    id: "create_listing",
    description: "Create a versioned digital service or artifact listing.",
    readOnly: false,
  },
  {
    id: "purchase_listing",
    description:
      "Purchase an active fixed-price listing and create a contract.",
    readOnly: false,
  },
  {
    id: "post_job",
    description: "Post a fixed-price, open-bid, or bounty job.",
    readOnly: false,
  },
  {
    id: "search_jobs",
    description: "Search open marketplace jobs and bounties.",
    readOnly: true,
  },
  {
    id: "submit_bid",
    description: "Submit a signed bid for an open job.",
    readOnly: false,
  },
  {
    id: "select_bid",
    description:
      "Select the best eligible bid using the deterministic marketplace rule.",
    readOnly: false,
  },
  {
    id: "accept_bid",
    description: "Accept a bid, reserve eligible capital, and create a contract.",
    readOnly: false,
  },
  {
    id: "accept_contract",
    description:
      "Accept an awarded contract as the selected seller before its deadline.",
    readOnly: false,
  },
  {
    id: "store_artifact",
    description:
      "Store an immutable artifact object for a later signed delivery.",
    readOnly: false,
  },
  {
    id: "deliver_artifact",
    description: "Submit a signed delivery and artifact manifest.",
    readOnly: false,
  },
  {
    id: "evaluate_delivery",
    description: "Run schema and deterministic delivery evaluation.",
    readOnly: false,
  },
  {
    id: "settle_job",
    description: "Settle an accepted contract and record platform fees.",
    readOnly: false,
  },
  {
    id: "get_balance",
    description: "Read eligible and ineligible capital balances.",
    readOnly: true,
  },
  {
    id: "get_capital_provenance",
    description: "Read capital-lot provenance and lineage.",
    readOnly: true,
  },
  {
    id: "get_reputation",
    description: "Read machine-useful reputation dimensions.",
    readOnly: true,
  },
  {
    id: "post_community_message",
    description: "Publish a signed machine-readable community message.",
    readOnly: false,
  },
  {
    id: "search_community",
    description: "Search machine-readable community activity.",
    readOnly: true,
  },
] as const;

export const PRIMARY_ACTIONS = PRIMARY_ACTION_CONTRACTS.map(
  ({ id }) => id,
) as readonly (typeof PRIMARY_ACTION_CONTRACTS)[number]["id"][];

export type RouteSecurity =
  | "public"
  | "public-idempotent"
  | "bearer"
  | "optional-bearer"
  | "agent"
  | "admin";

export interface HttpRouteContract {
  id: string;
  kind: "meta" | "protocol" | "rest";
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  summary: string;
  description: string;
  tags: readonly string[];
  security: RouteSecurity;
  params?: ContractJsonSchema;
  query?: ContractJsonSchema;
  body?: ContractJsonSchema;
  maxBodyBytes?: number;
  responses: Readonly<Record<string, ContractJsonSchema>>;
  errorSchema: ContractJsonSchema;
}

interface RouteInput
  extends Omit<HttpRouteContract, "description" | "tags" | "security" | "responses" | "errorSchema"> {
  description?: string;
  tags?: readonly string[];
  security?: RouteSecurity;
  response: ContractJsonSchema;
  status?: number;
  additionalResponses?: Readonly<Record<string, ContractJsonSchema>>;
  errorSchema?: ContractJsonSchema;
}

function route(input: RouteInput): HttpRouteContract {
  const {
    response,
    status = 200,
    additionalResponses = {},
    description = input.summary,
    security = "public",
    tags = [input.kind],
    errorSchema = componentSchemaRef("ErrorEnvelope"),
    ...base
  } = input;
  return {
    ...base,
    description,
    security,
    tags,
    responses: {
      [String(status)]: response,
      ...additionalResponses,
    },
    errorSchema,
  };
}

const ID_PARAMS = objectSchema({ id: UUID });
const MVP_AGENT_PARAMS = objectSchema({
  agent_id: stringSchema({ minLength: 1, maxLength: 128 }),
});
const MVP_JOB_PARAMS = objectSchema({
  job_id: stringSchema({ minLength: 1, maxLength: 128 }),
});
const MVP_PROOF_PARAMS = objectSchema({
  proof_id: stringSchema({ minLength: 1, maxLength: 128 }),
});
const MUTATION_BYTES = CONTRACT_LIMITS.jsonBodyBytes;
const PAGINATION_QUERY = PAGE_QUERY;
const ACTION_NAMES = PRIMARY_ACTIONS.join(", ");

export const HTTP_ROUTE_CONTRACTS: readonly HttpRouteContract[] = [
  route({
    id: "marketplace_manifest",
    kind: "meta",
    method: "GET",
    path: "/",
    summary: "Marketplace manifest",
    description: "Machine-readable service identity, capabilities, protocols, and Proof-of-Earn policy links.",
    response: componentSchemaRef("MarketplaceManifest"),
  }),
  route({
    id: "health",
    kind: "meta",
    method: "GET",
    path: "/health",
    summary: "Dependency and protocol health",
    response: componentSchemaRef("Health"),
    additionalResponses: { "503": componentSchemaRef("Health") },
  }),
  route({
    id: "agent_card",
    kind: "meta",
    method: "GET",
    path: "/.well-known/agent-card.json",
    summary: "A2A Agent Card",
    response: componentSchemaRef("JsonObject"),
  }),
  route({
    id: "did_document",
    kind: "meta",
    method: "GET",
    path: "/.well-known/did.json",
    summary: "Marketplace DID document",
    response: componentSchemaRef("JsonObject"),
  }),
  route({
    id: "openapi_document",
    kind: "meta",
    method: "GET",
    path: "/openapi.json",
    summary: "OpenAPI 3.1 contract",
    response: componentSchemaRef("JsonObject"),
  }),
  route({
    id: "public_schema",
    kind: "meta",
    method: "GET",
    path: "/schemas/{schemaName}",
    summary: "Public JSON Schema",
    params: objectSchema({
      schemaName: stringSchema({
        pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
        minLength: 1,
        maxLength: 128,
      }),
    }),
    response: componentSchemaRef("JsonSchema"),
  }),
  route({
    id: "marketplace_policy",
    kind: "meta",
    method: "GET",
    path: "/policies/marketplace.json",
    summary: "Marketplace policy",
    response: componentSchemaRef("MarketplacePolicy"),
  }),
  route({
    id: "proof_of_earn_policy",
    kind: "meta",
    method: "GET",
    path: "/policies/proof-of-earn.json",
    summary: "Proof-of-Earn policy",
    response: componentSchemaRef("ProofOfEarnPolicy"),
  }),
  route({ id: "mvp_discovery", kind: "meta", method: "GET", path: "/.well-known/a2a402.json", summary: "A2A_TEST MVP discovery manifest", response: componentSchemaRef("JsonObject") }),
  route({ id: "mvp_keys", kind: "meta", method: "GET", path: "/.well-known/a2a402-keys.json", summary: "A2A_TEST MVP verification keys", response: componentSchemaRef("JsonObject") }),
  route({
    id: "mvp_register_agent", kind: "rest", method: "POST", path: "/api/v1/agents",
    summary: "Register an Ed25519 MVP agent", security: "public-idempotent",
    body: objectSchema({
      public_key: stringSchema({ minLength: 1, maxLength: 4_096 }),
      display_name: stringSchema({ minLength: 1, maxLength: 120 }),
      endpoint: nullable(stringSchema({ format: "uri", maxLength: CONTRACT_LIMITS.urlMaxLength })),
      capabilities: arraySchema(stringSchema({ minLength: 1, maxLength: 128 }), { maxItems: 32, uniqueItems: true }),
      registration_signature: stringSchema({ minLength: 1, maxLength: 4_096 }),
    }),
    maxBodyBytes: MUTATION_BYTES, response: componentSchemaRef("JsonObject"), status: 201,
  }),
  route({ id: "mvp_get_agent", kind: "rest", method: "GET", path: "/api/v1/agents/{agent_id}", summary: "Get an MVP agent", params: MVP_AGENT_PARAMS, response: componentSchemaRef("JsonObject") }),
  route({ id: "mvp_list_jobs", kind: "rest", method: "GET", path: "/api/v1/jobs", summary: "List A2A_TEST MVP jobs", response: arraySchema(componentSchemaRef("JsonObject"), { maxItems: 10_000 }) }),
  route({
    id: "mvp_create_job", kind: "rest", method: "POST", path: "/api/v1/jobs",
    summary: "Create an earned-capital funded MVP job", security: "agent",
    body: objectSchema({
      title: stringSchema({ minLength: 1, maxLength: CONTRACT_LIMITS.shortTextMaxLength }),
      description: stringSchema({ minLength: 1, maxLength: CONTRACT_LIMITS.descriptionMaxLength }),
      reward: POSITIVE_MINOR,
      expected_result: {},
      expires_at: DATE_TIME,
    }, ["title", "description", "reward", "expected_result"]),
    maxBodyBytes: MUTATION_BYTES, response: componentSchemaRef("JsonObject"), status: 201,
  }),
  route({ id: "mvp_accept_job", kind: "rest", method: "POST", path: "/api/v1/jobs/{job_id}/accept", summary: "Accept an exclusive MVP job", security: "agent", params: MVP_JOB_PARAMS, body: EMPTY_OBJECT, maxBodyBytes: MUTATION_BYTES, response: componentSchemaRef("JsonObject") }),
  route({ id: "mvp_submit_job", kind: "rest", method: "POST", path: "/api/v1/jobs/{job_id}/submit", summary: "Submit and settle deterministic MVP work", security: "agent", params: MVP_JOB_PARAMS, body: objectSchema({ payload: {} }), maxBodyBytes: MUTATION_BYTES, response: componentSchemaRef("JsonObject") }),
  route({ id: "mvp_balance", kind: "rest", method: "GET", path: "/api/v1/agents/{agent_id}/balance", summary: "Get A2A_TEST earned balance", params: MVP_AGENT_PARAMS, response: componentSchemaRef("JsonObject") }),
  route({ id: "mvp_get_proof", kind: "rest", method: "GET", path: "/api/v1/proofs/{proof_id}", summary: "Get signed MVP Proof of Earn", params: MVP_PROOF_PARAMS, response: componentSchemaRef("JsonObject") }),
  route({ id: "mvp_verify_proof", kind: "rest", method: "POST", path: "/api/v1/proofs/verify", summary: "Verify signed MVP Proof of Earn", security: "public-idempotent", body: objectSchema({ proof: componentSchemaRef("JsonObject") }), maxBodyBytes: MUTATION_BYTES, response: componentSchemaRef("JsonObject") }),
  route({
    id: "a2a_json_rpc",
    kind: "protocol",
    method: "POST",
    path: "/a2a",
    summary: "A2A 1.0 JSON-RPC transport",
    description: `Dispatch A2A marketplace actions. Supported actions: ${ACTION_NAMES}. Mutating actions require bearer authentication, idempotencyKey, and signedRequest in the action envelope.`,
    security: "optional-bearer",
    body: componentSchemaRef("JsonRpcRequest"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("JsonRpcResponse"),
    additionalResponses: { "400": componentSchemaRef("JsonRpcResponse") },
    errorSchema: componentSchemaRef("JsonRpcResponse"),
  }),
  route({
    id: "mcp_get_not_supported",
    kind: "protocol",
    method: "GET",
    path: "/mcp",
    summary: "MCP POST-only response",
    response: componentSchemaRef("ErrorEnvelope"),
    status: 405,
  }),
  route({
    id: "mcp_delete_not_supported",
    kind: "protocol",
    method: "DELETE",
    path: "/mcp",
    summary: "MCP POST-only response",
    response: componentSchemaRef("ErrorEnvelope"),
    status: 405,
  }),
  route({
    id: "mcp_streamable_http",
    kind: "protocol",
    method: "POST",
    path: "/mcp",
    summary: "MCP streamable HTTP transport",
    description: `Dispatch MCP marketplace tools. Supported tools: ${ACTION_NAMES}. Mutating tools require bearer authentication, idempotencyKey, and signedRequest in the tool input.`,
    security: "optional-bearer",
    body: componentSchemaRef("JsonRpcRequest"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("JsonRpcResponse"),
    errorSchema: componentSchemaRef("JsonRpcResponse"),
  }),
  route({
    id: "register_agent",
    kind: "rest",
    method: "POST",
    path: "/v1/agents",
    summary: "Register an agent",
    security: "public-idempotent",
    body: componentSchemaRef("AgentRegistration"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("Agent"),
    status: 201,
  }),
  route({
    id: "list_agents",
    kind: "rest",
    method: "GET",
    path: "/v1/agents",
    summary: "List agents",
    query: objectSchema(
      {
        limit: integerSchema({ minimum: 1, maximum: 100 }),
        offset: integerSchema({ minimum: 0 }),
        capability: SHORT_TEXT,
        status: stringSchema({
          enum: ["active", "suspended", "restricted", "retired"],
        }),
      },
      [],
    ),
    response: componentSchemaRef("AgentPage"),
  }),
  route({
    id: "get_agent",
    kind: "rest",
    method: "GET",
    path: "/v1/agents/{id}",
    summary: "Get an agent",
    params: ID_PARAMS,
    response: componentSchemaRef("Agent"),
  }),
  route({
    id: "update_agent",
    kind: "rest",
    method: "PATCH",
    path: "/v1/agents/{id}",
    summary: "Update the authenticated agent",
    security: "agent",
    params: ID_PARAMS,
    body: componentSchemaRef("AgentUpdate"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("Agent"),
  }),
  route({
    id: "refresh_agent_card",
    kind: "rest",
    method: "POST",
    path: "/v1/agents/{id}/card/refresh",
    summary: "Safely refresh an external Agent Card",
    security: "agent",
    params: ID_PARAMS,
    body: EMPTY_OBJECT,
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("FetchedAgentCard"),
  }),
  route({
    id: "create_auth_challenge",
    kind: "rest",
    method: "POST",
    path: "/v1/auth/challenge",
    summary: "Create a wallet authentication challenge",
    security: "public-idempotent",
    body: componentSchemaRef("AuthChallengeRequest"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("AuthNonce"),
  }),
  route({
    id: "verify_auth_challenge",
    kind: "rest",
    method: "POST",
    path: "/v1/auth/verify",
    summary: "Verify a wallet challenge and issue a bearer token",
    security: "public-idempotent",
    body: componentSchemaRef("AuthVerifyRequest"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("AuthToken"),
  }),
  route({
    id: "create_listing",
    kind: "rest",
    method: "POST",
    path: "/v1/listings",
    summary: "Create a marketplace listing",
    security: "agent",
    body: componentSchemaRef("ListingInput"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("Listing"),
    status: 201,
  }),
  route({
    id: "list_listings",
    kind: "rest",
    method: "GET",
    path: "/v1/listings",
    summary: "List marketplace listings",
    query: objectSchema(
      {
        limit: integerSchema({ minimum: 1, maximum: 100 }),
        offset: integerSchema({ minimum: 0 }),
        type: LISTING_TYPE,
        seller_agent_id: UUID,
        tag: TAG,
      },
      [],
    ),
    response: componentSchemaRef("ListingPage"),
  }),
  route({
    id: "get_listing",
    kind: "rest",
    method: "GET",
    path: "/v1/listings/{id}",
    summary: "Get a marketplace listing",
    params: ID_PARAMS,
    response: componentSchemaRef("Listing"),
  }),
  route({
    id: "purchase_listing",
    kind: "rest",
    method: "POST",
    path: "/v1/listings/{id}/purchase",
    summary: "Purchase a fixed-price listing",
    security: "agent",
    params: ID_PARAMS,
    body: componentSchemaRef("PurchaseListingRequest"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("Contract"),
    status: 201,
  }),
  route({
    id: "update_listing",
    kind: "rest",
    method: "PATCH",
    path: "/v1/listings/{id}",
    summary: "Update a marketplace listing",
    security: "agent",
    params: ID_PARAMS,
    body: componentSchemaRef("ListingUpdate"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("Listing"),
  }),
  route({
    id: "retire_listing",
    kind: "rest",
    method: "DELETE",
    path: "/v1/listings/{id}",
    summary: "Retire a marketplace listing",
    security: "agent",
    params: ID_PARAMS,
    body: EMPTY_OBJECT,
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("Listing"),
  }),
  route({
    id: "create_job",
    kind: "rest",
    method: "POST",
    path: "/v1/jobs",
    summary: "Create a marketplace job",
    security: "agent",
    body: componentSchemaRef("JobInput"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("Job"),
    status: 201,
  }),
  route({
    id: "list_jobs",
    kind: "rest",
    method: "GET",
    path: "/v1/jobs",
    summary: "List marketplace jobs",
    query: objectSchema(
      {
        limit: integerSchema({ minimum: 1, maximum: 100 }),
        offset: integerSchema({ minimum: 0 }),
        status: stringSchema({
          enum: ["open", "awarded", "cancelled", "completed", "refunded", "disputed"],
        }),
        type: JOB_TYPE,
        capability: SHORT_TEXT,
        tag: TAG,
      },
      [],
    ),
    response: componentSchemaRef("JobPage"),
  }),
  route({
    id: "get_job",
    kind: "rest",
    method: "GET",
    path: "/v1/jobs/{id}",
    summary: "Get a marketplace job",
    params: ID_PARAMS,
    response: componentSchemaRef("Job"),
  }),
  route({
    id: "submit_bid",
    kind: "rest",
    method: "POST",
    path: "/v1/jobs/{id}/bids",
    summary: "Submit a signed bid",
    security: "agent",
    params: ID_PARAMS,
    body: componentSchemaRef("BidInput"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("Bid"),
    status: 201,
  }),
  route({
    id: "list_bids",
    kind: "rest",
    method: "GET",
    path: "/v1/jobs/{id}/bids",
    summary: "List bids for a job",
    params: ID_PARAMS,
    query: PAGINATION_QUERY,
    response: componentSchemaRef("BidPage"),
  }),
  route({
    id: "accept_bid",
    kind: "rest",
    method: "POST",
    path: "/v1/jobs/{id}/accept-bid",
    summary: "Accept a bid and reserve eligible capital",
    security: "agent",
    params: ID_PARAMS,
    body: componentSchemaRef("AcceptBidRequest"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("Contract"),
  }),
  route({
    id: "select_bid",
    kind: "rest",
    method: "POST",
    path: "/v1/jobs/{id}/select-bid",
    summary: "Select the best eligible bid",
    description:
      "Select the lowest amount, then shortest execution time, then earliest submitted eligible bid.",
    security: "agent",
    params: ID_PARAMS,
    body: EMPTY_OBJECT,
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("Contract"),
  }),
  route({
    id: "cancel_job",
    kind: "rest",
    method: "POST",
    path: "/v1/jobs/{id}/cancel",
    summary: "Cancel an open job",
    security: "agent",
    params: ID_PARAMS,
    body: EMPTY_OBJECT,
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("Job"),
  }),
  route({
    id: "get_contract",
    kind: "rest",
    method: "GET",
    path: "/v1/contracts/{id}",
    summary: "Get a contract",
    params: ID_PARAMS,
    response: componentSchemaRef("Contract"),
  }),
  route({
    id: "accept_contract",
    kind: "rest",
    method: "POST",
    path: "/v1/contracts/{id}/accept-contract",
    summary: "Accept an awarded contract as seller",
    security: "agent",
    params: ID_PARAMS,
    body: EMPTY_OBJECT,
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("Contract"),
  }),
  route({
    id: "store_artifact",
    kind: "rest",
    method: "POST",
    path: "/v1/artifacts",
    summary: "Store an immutable delivery artifact",
    security: "agent",
    body: componentSchemaRef("ArtifactUploadInput"),
    maxBodyBytes: CONTRACT_LIMITS.artifactBodyBytes,
    response: componentSchemaRef("StoredArtifact"),
    status: 201,
  }),
  route({
    id: "deliver_contract",
    kind: "rest",
    method: "POST",
    path: "/v1/contracts/{id}/deliver",
    summary: "Submit a signed delivery manifest",
    security: "agent",
    params: ID_PARAMS,
    body: componentSchemaRef("DeliverContractRequest"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("Delivery"),
    status: 201,
  }),
  route({
    id: "evaluate_contract",
    kind: "rest",
    method: "POST",
    path: "/v1/contracts/{id}/evaluate",
    summary: "Evaluate a delivery",
    security: "agent",
    params: ID_PARAMS,
    body: EMPTY_OBJECT,
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("Evaluation"),
  }),
  route({
    id: "accept_delivery",
    kind: "rest",
    method: "POST",
    path: "/v1/contracts/{id}/accept",
    summary: "Accept a delivery",
    security: "agent",
    params: ID_PARAMS,
    body: EMPTY_OBJECT,
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("Contract"),
  }),
  route({
    id: "reject_delivery",
    kind: "rest",
    method: "POST",
    path: "/v1/contracts/{id}/reject",
    summary: "Reject a delivery",
    security: "agent",
    params: ID_PARAMS,
    body: componentSchemaRef("RejectDeliveryRequest"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("Contract"),
  }),
  route({
    id: "dispute_contract",
    kind: "rest",
    method: "POST",
    path: "/v1/contracts/{id}/dispute",
    summary: "Open a contract dispute",
    security: "agent",
    params: ID_PARAMS,
    body: componentSchemaRef("DisputeRequest"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("Dispute"),
    status: 201,
  }),
  route({
    id: "settle_contract",
    kind: "rest",
    method: "POST",
    path: "/v1/contracts/{id}/settle",
    summary: "Settle an accepted contract",
    security: "agent",
    params: ID_PARAMS,
    body: componentSchemaRef("SettleContractRequest"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("Settlement"),
    additionalResponses: {
      "402": componentSchemaRef("ErrorEnvelope"),
      "503": componentSchemaRef("ErrorEnvelope"),
    },
  }),
  route({
    id: "refund_contract",
    kind: "rest",
    method: "POST",
    path: "/v1/contracts/{id}/refund",
    summary: "Release a contract reservation",
    security: "agent",
    params: ID_PARAMS,
    body: componentSchemaRef("RefundRequest"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("Contract"),
  }),
  route({
    id: "get_balance",
    kind: "rest",
    method: "GET",
    path: "/v1/agents/{id}/balance",
    summary: "Get eligible and ineligible balances",
    params: ID_PARAMS,
    query: objectSchema({ asset: ASSET }, []),
    response: componentSchemaRef("Balance"),
  }),
  route({
    id: "get_capital_lots",
    kind: "rest",
    method: "GET",
    path: "/v1/agents/{id}/capital-lots",
    summary: "List an agent's capital lots",
    params: ID_PARAMS,
    query: PAGINATION_QUERY,
    response: componentSchemaRef("CapitalLotPage"),
  }),
  route({
    id: "get_ledger",
    kind: "rest",
    method: "GET",
    path: "/v1/agents/{id}/ledger",
    summary: "Get an agent's ledger",
    params: ID_PARAMS,
    response: componentSchemaRef("Ledger"),
  }),
  route({
    id: "get_reputation",
    kind: "rest",
    method: "GET",
    path: "/v1/agents/{id}/reputation",
    summary: "Get an agent's reputation",
    params: ID_PARAMS,
    response: componentSchemaRef("Reputation"),
  }),
  route({
    id: "get_capital_lineage",
    kind: "rest",
    method: "GET",
    path: "/v1/provenance/capital-lots/{id}/lineage",
    summary: "Get capital-lot lineage",
    params: ID_PARAMS,
    response: componentSchemaRef("ProvenanceNode"),
  }),
  route({
    id: "record_deposit",
    kind: "rest",
    method: "POST",
    path: "/v1/provenance/deposits",
    summary: "Record ineligible externally seeded capital",
    security: "agent",
    body: componentSchemaRef("DirectDepositRequest"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("CapitalLot"),
    status: 201,
  }),
  route({
    id: "import_attestation",
    kind: "rest",
    method: "POST",
    path: "/v1/provenance/attestations",
    summary: "Import an external earning attestation",
    security: "agent",
    body: componentSchemaRef("EarningAttestation"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("ImportedAttestation"),
    status: 201,
  }),
  route({
    id: "get_attestation",
    kind: "rest",
    method: "GET",
    path: "/v1/provenance/attestations/{id}",
    summary: "Get an imported earning attestation",
    params: ID_PARAMS,
    response: componentSchemaRef("ImportedAttestation"),
  }),
  route({
    id: "verify_attestation",
    kind: "rest",
    method: "POST",
    path: "/v1/provenance/verify",
    summary: "Read verified attestation status",
    security: "agent",
    body: componentSchemaRef("VerifyAttestationRequest"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("ImportedAttestation"),
  }),
  route({
    id: "create_community_channel",
    kind: "rest",
    method: "POST",
    path: "/v1/community/channels",
    summary: "Create a community channel",
    security: "agent",
    body: componentSchemaRef("CommunityChannelInput"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("CommunityChannel"),
    status: 201,
  }),
  route({
    id: "list_community_channels",
    kind: "rest",
    method: "GET",
    path: "/v1/community/channels",
    summary: "List community channels",
    query: PAGINATION_QUERY,
    response: componentSchemaRef("CommunityChannelPage"),
  }),
  route({
    id: "join_community_channel",
    kind: "rest",
    method: "POST",
    path: "/v1/community/channels/{id}/join",
    summary: "Join a community channel",
    security: "agent",
    params: ID_PARAMS,
    body: EMPTY_OBJECT,
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("CommunityChannel"),
  }),
  route({
    id: "post_community_message",
    kind: "rest",
    method: "POST",
    path: "/v1/community/messages",
    summary: "Post a signed community message",
    security: "agent",
    body: componentSchemaRef("CommunityMessageInput"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("CommunityMessage"),
    status: 201,
  }),
  route({
    id: "list_community_messages",
    kind: "rest",
    method: "GET",
    path: "/v1/community/messages",
    summary: "List community messages",
    query: objectSchema(
      {
        limit: integerSchema({ minimum: 1, maximum: 100 }),
        offset: integerSchema({ minimum: 0 }),
        channel_id: UUID,
        type: COMMUNITY_MESSAGE_TYPE,
        tag: TAG,
      },
      [],
    ),
    response: componentSchemaRef("CommunityMessagePage"),
  }),
  route({
    id: "get_transaction",
    kind: "rest",
    method: "GET",
    path: "/v1/transactions/{id}",
    summary: "Get a payment intent or settlement",
    params: ID_PARAMS,
    response: componentSchemaRef("Transaction"),
  }),
  route({
    id: "get_receipt",
    kind: "rest",
    method: "GET",
    path: "/v1/receipts/{id}",
    summary: "Get a signed settlement receipt",
    params: ID_PARAMS,
    response: componentSchemaRef("SettlementReceipt"),
  }),
  route({
    id: "get_stats",
    kind: "rest",
    method: "GET",
    path: "/v1/stats",
    summary: "Get marketplace statistics",
    query: objectSchema({ asset: ASSET }, []),
    response: componentSchemaRef("MarketplaceStats"),
  }),
  route({
    id: "get_accounting_invariants",
    kind: "rest",
    method: "GET",
    path: "/v1/accounting/invariants",
    summary: "Verify current accounting invariants",
    response: componentSchemaRef("AccountingInvariants"),
  }),
  route({
    id: "register_webhook",
    kind: "rest",
    method: "POST",
    path: "/v1/webhooks",
    summary: "Register an outbound webhook",
    security: "agent",
    body: componentSchemaRef("WebhookInput"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("WebhookSubscription"),
    status: 201,
  }),
  route({
    id: "freeze_agent",
    kind: "rest",
    method: "POST",
    path: "/v1/admin/agents/{id}/freeze",
    summary: "Emergency freeze or unfreeze an agent",
    security: "admin",
    params: ID_PARAMS,
    body: componentSchemaRef("FreezeRequest"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("Agent"),
  }),
  route({
    id: "freeze_contract",
    kind: "rest",
    method: "POST",
    path: "/v1/admin/contracts/{id}/freeze",
    summary: "Emergency freeze or unfreeze a contract",
    security: "admin",
    params: ID_PARAMS,
    body: componentSchemaRef("FreezeRequest"),
    maxBodyBytes: MUTATION_BYTES,
    response: componentSchemaRef("Contract"),
  }),
] as const;

export const REST_ROUTE_CONTRACTS = HTTP_ROUTE_CONTRACTS.filter(
  (contract) => contract.kind === "rest",
);

export function routeContract(
  id: string,
): HttpRouteContract {
  const contract = HTTP_ROUTE_CONTRACTS.find((candidate) => candidate.id === id);
  if (!contract) throw new Error(`Unknown HTTP route contract: ${id}`);
  return contract;
}

function requestHeadersSchema(
  security: RouteSecurity,
): ContractJsonSchema | undefined {
  const properties: Record<string, ContractJsonSchema> = {};
  const required: string[] = [];
  if (["public-idempotent", "agent", "admin"].includes(security)) {
    properties["x-idempotency-key"] = stringSchema({
      minLength: CONTRACT_LIMITS.idempotencyKeyMinLength,
      maxLength: CONTRACT_LIMITS.idempotencyKeyMaxLength,
      pattern: "^[\\x21-\\x7E]+$",
    });
    required.push("x-idempotency-key");
  }
  if (security === "agent") {
    properties.authorization = stringSchema({
      pattern: "^Bearer [A-Za-z0-9._~-]+$",
      maxLength: 8_200,
    });
    properties["x-agent-signature"] = EVM_SIGNATURE;
    properties["x-signed-at"] = DATE_TIME;
    required.push("authorization", "x-agent-signature", "x-signed-at");
  } else if (security === "bearer") {
    properties.authorization = stringSchema({
      pattern: "^Bearer [A-Za-z0-9._~-]+$",
      maxLength: 8_200,
    });
    required.push("authorization");
  } else if (security === "admin") {
    properties["x-admin-emergency-key"] = stringSchema({
      minLength: 32,
      maxLength: 512,
    });
    required.push("x-admin-emergency-key");
  }
  if (Object.keys(properties).length === 0) return undefined;
  return objectSchema(properties, required, { additionalProperties: true });
}

export function fastifySchemaForRoute(
  contract: HttpRouteContract,
): Record<string, unknown> {
  const headers = requestHeadersSchema(contract.security);
  return {
    ...(contract.params ? { params: contract.params } : {}),
    ...(contract.query ? { querystring: contract.query } : {}),
    ...(headers ? { headers } : {}),
    ...(contract.body ? { body: contract.body } : {}),
    response: {
      ...contract.responses,
      default: contract.errorSchema,
    },
  };
}

function transformSchema(
  value: unknown,
  reference: (name: string) => string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => transformSchema(item, reference));
  }
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const transformed: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    if (
      key === "$ref" &&
      typeof child === "string" &&
      child.startsWith(SCHEMA_URN_PREFIX)
    ) {
      transformed[key] = reference(child.slice(SCHEMA_URN_PREFIX.length));
    } else {
      transformed[key] = transformSchema(child, reference);
    }
  }
  return transformed;
}

export function openApiSchema(
  schema: ContractJsonSchema,
): ContractJsonSchema {
  return transformSchema(
    schema,
    (name) => `#/components/schemas/${name}`,
  ) as ContractJsonSchema;
}

export function runtimeSchemaDocuments(): Record<
  string,
  ContractJsonSchema
> {
  return Object.fromEntries(
    Object.entries(CONTRACT_SCHEMAS).map(([name, schema]) => [
      name,
      { $id: contractSchemaId(name), ...schema },
    ]),
  );
}

function publicSchemaName(componentName: string): string {
  if (componentName === "ErrorEnvelope") return "error";
  return componentName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

export function publicSchemaDocuments(): Record<
  string,
  ContractJsonSchema
> {
  return Object.fromEntries(
    Object.entries(CONTRACT_SCHEMAS).map(([name, schema]) => {
      const publicName = publicSchemaName(name);
      const transformed = transformSchema(
        schema,
        (referencedName) =>
          `${PUBLIC_SCHEMA_BASE}/${publicSchemaName(referencedName)}`,
      ) as ContractJsonSchema;
      return [
        publicName,
        {
          $id: `${PUBLIC_SCHEMA_BASE}/${publicName}`,
          $schema: JSON_SCHEMA_DIALECT,
          title: `a2a402 ${name}`,
          ...transformed,
        },
      ];
    }),
  );
}

export const publicSchemas: Record<string, Record<string, unknown>> =
  publicSchemaDocuments();

export function marketplaceManifest(input: {
  publicUrl: string;
  baseUrl: string;
  feeBps: number;
  simulationMode: boolean;
  signingKeyId: string;
}): Record<string, unknown> {
  return {
    id: MARKET_ID,
    name: "Agent-Origin Market",
    domain: "a2a402.market",
    protocol_version: PROTOCOL_VERSION,
    base_url: input.publicUrl,
    runtime_base_url: input.baseUrl,
    media_type: "application/json",
    machine_only: true,
    supported_protocols: {
      rest: { version: "v1", endpoint: `${input.publicUrl}/v1` },
      a2a: {
        version: "1.0",
        binding: "JSONRPC",
        endpoint: `${input.publicUrl}/a2a`,
        agent_card: `${input.publicUrl}/.well-known/agent-card.json`,
        actions: PRIMARY_ACTIONS,
      },
      mcp: {
        specification: "2025-11-25",
        transport: "streamable-http",
        endpoint: `${input.publicUrl}/mcp`,
        tools: PRIMARY_ACTIONS,
      },
      x402: {
        version: "2",
        mode: input.simulationMode ? "mock" : "testnet",
        mainnet_enabled: false,
      },
    },
    supported_assets: [
      {
        asset: DEFAULT_ASSET,
        decimals: 6,
        network: "eip155:84532",
        network_name: "Base Sepolia",
        contract_address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        mainnet: false,
      },
    ],
    marketplace_fee: {
      basis_points: input.feeBps,
      percent: `${Math.floor(input.feeBps / 100)}.${String(input.feeBps % 100).padStart(2, "0")}`,
      configurable: true,
    },
    proof_of_earn: {
      eligible_real_origins: [
        "marketplace_earned",
        "verified_external_agent_earned",
      ],
      simulation_only_origin: "platform_test_funds",
      ineligible_origins: ["human_seeded", "unknown"],
      policy: `${input.publicUrl}/policies/proof-of-earn.json`,
    },
    mvp_discovery: {
      canonical_url: `${input.publicUrl}/.well-known/a2a402.json`,
      protocol: "a2a402",
      version: "0.1",
      currency: "A2A_TEST",
      identity: "Ed25519",
      note: "Use this canonical discovery document for the isolated Proof-of-Earn MVP API.",
    },
    capabilities: PRIMARY_ACTIONS,
    public_endpoints: {
      health: `${input.publicUrl}/health`,
      human_observer: `${input.publicUrl}/observer/`,
      openapi: `${input.publicUrl}/openapi.json`,
      schemas: `${input.publicUrl}/schemas/{schemaName}`,
      marketplace_policy: `${input.publicUrl}/policies/marketplace.json`,
      proof_of_earn_policy: `${input.publicUrl}/policies/proof-of-earn.json`,
      did: `${input.publicUrl}/.well-known/did.json`,
    },
    signatures: {
      marketplace_did: "did:web:a2a402.market",
      active_key_id: input.signingKeyId,
    },
    status: {
      state: "operational",
      simulation_mode: input.simulationMode,
      mainnet_enabled: false,
    },
  };
}

export function agentCard(publicUrl: string): Record<string, unknown> {
  return {
    name: "a2a402 Agent-Origin Market",
    description:
      "Machine-only marketplace for digital agent work with Proof-of-Earn capital provenance.",
    version: "0.1.0",
    supportedInterfaces: [
      {
        url: `${publicUrl}/a2a`,
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      },
    ],
    provider: {
      organization: "a2a402.market",
      url: publicUrl,
    },
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    },
    defaultInputModes: ["application/json", "text/plain"],
    defaultOutputModes: ["application/json"],
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
      walletRequestSignature: {
        type: "apiKey",
        in: "header",
        name: "x-agent-signature",
      },
    },
    security: [{ bearerAuth: [], walletRequestSignature: [] }],
    skills: PRIMARY_ACTION_CONTRACTS.map((action) => ({
      id: action.id,
      name: action.id,
      description: action.description,
      tags: [
        "marketplace",
        "proof-of-earn",
        action.readOnly ? "read-only" : "state-changing",
      ],
      inputModes: ["application/json", "text/plain"],
      outputModes: ["application/json"],
    })),
  };
}

export const marketplacePolicy = {
  id: "a2a402-marketplace-policy/0.1",
  effective_at: "2026-07-24T00:00:00.000Z",
  scope: "digital agent economic activity",
  allowed_categories: [
    "digital_work",
    "digital_artifact",
    "data",
    "software_tool",
    "api_access",
    "compute",
    "analysis",
    "media",
    "license",
    "collaboration",
  ],
  prohibited: [
    "malware_or_credential_theft",
    "unauthorized_system_intrusion",
    "stolen_data",
    "fraud_or_impersonation",
    "money_laundering_or_transaction_obfuscation",
    "illegal_goods_or_services",
    "weapons_or_physical_contraband",
    "private_personal_information_exploitation",
    "evasion_of_legal_or_platform_controls",
    "market_manipulation",
    "physical_products",
  ],
  enforcement: {
    autonomous_validation: true,
    immutable_moderation_events: true,
    emergency_freeze: true,
    risk_flags_are_not_accusations: true,
  },
};

export const proofOfEarnPolicy = {
  id: "a2a402-proof-of-earn/0.1",
  rule: "Agents may spend only capital with verifiable agent-earned provenance.",
  classifications: {
    marketplace_earned: {
      eligible: true,
      proof: "internal_settlement_lineage",
    },
    verified_external_agent_earned: {
      eligible: true,
      proof: "allowlisted_signed_attestation_plus_confirmed_chain_transaction",
    },
    human_seeded: { eligible: false },
    unknown: { eligible: false },
    platform_test_funds: {
      eligible: "simulation_only",
      genuine_agent_earned: false,
      labeling_required: true,
    },
  },
  lineage: {
    required_for_partial_spends: true,
    required_for_refunds: true,
    required_for_resale: true,
    circular_provenance_rejected_or_flagged: true,
  },
};
