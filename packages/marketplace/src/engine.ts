import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { Ajv } from "ajv";
import { verifyMessage } from "viem";
import {
  canonicalJson,
  DEFAULT_ASSET,
  ArtifactStorageError,
  MARKET_ID,
  MarketplaceError,
  nowIso,
  parseMinor,
  PROTOCOL_VERSION,
  secureEqual,
  sha256,
  uuid,
  type CapitalOrigin,
  type JsonValue,
} from "@a2a402/shared";
import type { ArtifactStorage, StoredArtifact } from "@a2a402/shared";
import type {
  EvaluationInput as AdapterEvaluationInput,
  EvaluationResult as AdapterEvaluationResult,
  EvaluatorAdapter,
} from "@a2a402/evaluation";
import {
  PaymentAdapterError,
  type PaymentAdapter,
  type PaymentRequirement,
  type PaymentVerification,
} from "@a2a402/payments";
import type {
  EarningAttestation,
  ExternalEarningVerifier,
} from "@a2a402/provenance";
import {
  computeReputation,
  createReputationEvent,
  type ReputationEvent,
  type RiskFlag,
} from "@a2a402/reputation";
import { PlatformSigner } from "./signer.js";
import type {
  AcceptanceRule,
  Agent,
  AgentRegistration,
  Artifact,
  ArtifactUploadInput,
  AuditEvent,
  AuthNonce,
  BalanceView,
  Bid,
  CapitalAllocation,
  CapitalLot,
  CapitalReservation,
  CanonicalSeededGenesisDesignation,
  CommunityChannel,
  CommunityMessage,
  Contract,
  Delivery,
  DiscoveryEvidence,
  DiscoverySource,
  Dispute,
  Evaluation,
  EvaluationCheck,
  ImportedAttestation,
  GenesisAgentRecord,
  Job,
  JsonSchema,
  LedgerAccount,
  LedgerAccountCode,
  LedgerEntry,
  LedgerTransaction,
  MarketplaceConfig,
  MarketplaceStateView,
  MarketplaceStats,
  OperationalMetricName,
  OperationalMetrics,
  OutboxEvent,
  PaymentIntent,
  PlatformFee,
  ReputationView,
  ServiceListing,
  Settlement,
  SignedDeliveryManifest,
  SignedReceipt,
  WebhookSubscription,
  WebhookDelivery,
} from "./types.js";

const DEFAULT_TIMEOUTS = {
  bidExpirationSeconds: 3_600,
  sellerAcceptanceSeconds: 900,
  deliverySeconds: 86_400,
  evaluationSeconds: 900,
  buyerResponseSeconds: 3_600,
  automaticRefundSeconds: 172_800,
  automaticSettlementSeconds: 86_400,
};

const POLICY_PATTERNS: Array<[RegExp, string]> = [
  [
    /\b(malware|ransomware|credential\s*(theft|steal)|keylogger)\b/i,
    "MALICIOUS_SOFTWARE",
  ],
  [
    /\b(unauthori[sz]ed\s+(access|intrusion)|hack\s+into)\b/i,
    "UNAUTHORIZED_INTRUSION",
  ],
  [/\b(stolen\s+data|stolen\s+credentials)\b/i, "STOLEN_DATA"],
  [
    /\b(money\s+launder|transaction\s+obfuscat|mixer\s+service)\b/i,
    "MONEY_LAUNDERING",
  ],
  [/\b(weapon|firearm|physical\s+contraband)\b/i, "PHYSICAL_CONTRABAND"],
  [/\b(doxx|private\s+personal\s+information)\b/i, "PRIVACY_EXPLOITATION"],
  [/\b(market\s+manipulat|wash\s+trade\s+service)\b/i, "MARKET_MANIPULATION"],
];

const ELIGIBLE_REAL_ORIGINS = new Set<CapitalOrigin>([
  "marketplace_earned",
  "verified_external_agent_earned",
]);

interface TokenPayload {
  sub: string;
  wallet: string;
  iat: number;
  exp: number;
  jti: string;
}

interface IdempotencyRecord {
  hash: string;
  result?: unknown;
  pending?: Promise<unknown>;
  expiresAt: number;
  persist: boolean;
}

interface LedgerPosting {
  accountId: string;
  side: "debit" | "credit";
  amountMinor: bigint;
}

interface JobInput {
  listing_id?: string | null;
  type: Job["type"];
  title: string;
  description: string;
  input?: JsonValue;
  input_schema?: JsonSchema;
  output_schema: JsonSchema;
  maximum_execution_seconds?: number;
  budget_minor: string | number | bigint;
  asset?: string;
  required_reputation?: Record<string, number>;
  required_capabilities?: string[];
  acceptance_rules?: AcceptanceRule[];
  artifact_mime_types?: string[];
  maximum_artifact_bytes?: number;
  license_terms?: string;
  refund_rules?: Record<string, JsonValue>;
  timeout_rules?: Partial<Job["timeoutRules"]>;
  tags?: string[];
  policy_category?: string;
}

interface ListingInput {
  type: ServiceListing["type"];
  title: string;
  description: string;
  input_schema?: JsonSchema;
  output_schema: JsonSchema;
  maximum_execution_seconds?: number;
  price_minor: string | number | bigint;
  asset?: string;
  required_reputation?: Record<string, number>;
  required_capabilities?: string[];
  acceptance_rules?: AcceptanceRule[];
  artifact_mime_types?: string[];
  license_terms?: string;
  refund_rules?: Record<string, JsonValue>;
  timeout_rules?: Record<string, JsonValue>;
  tags?: string[];
  policy_category?: string;
  seller_a2a_endpoint?: string | null;
  seller_webhook_endpoint?: string | null;
}

interface BidInput {
  amount_minor: string | number | bigint;
  asset?: string;
  execution_seconds: number;
  proposal?: JsonValue;
  expires_at?: string;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function plusSeconds(date: string, seconds: number): string {
  return new Date(new Date(date).getTime() + seconds * 1_000).toISOString();
}

function assertFuture(value: string, code = "VALIDATION_ERROR"): void {
  if (!Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.now()) {
    throw new MarketplaceError(
      code as "VALIDATION_ERROR",
      "Timestamp must be a valid future ISO-8601 time.",
      400,
    );
  }
}

function asJson(value: unknown): JsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, child) =>
      typeof child === "bigint" ? child.toString() : child,
    ),
  ) as JsonValue;
}

function safePublicUrl(raw: string, allowLocal: boolean): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MarketplaceError(
      "VALIDATION_ERROR",
      "Endpoint URL is malformed.",
    );
  }
  if (!["https:", ...(allowLocal ? ["http:"] : [])].includes(url.protocol)) {
    throw new MarketplaceError(
      "VALIDATION_ERROR",
      "Endpoint URL must use HTTPS.",
    );
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const blocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.startsWith("169.254.") ||
    host === "metadata.google.internal";
  if (blocked && !allowLocal) {
    throw new MarketplaceError(
      "VALIDATION_ERROR",
      "Private-network endpoints are prohibited.",
    );
  }
  url.username = "";
  url.password = "";
  return url.toString();
}

function policyCheck(value: unknown): void {
  const serialized = canonicalJson(value);
  for (const [pattern, category] of POLICY_PATTERNS) {
    if (pattern.test(serialized)) {
      throw new MarketplaceError(
        "POLICY_VIOLATION",
        "Content conflicts with marketplace policy.",
        422,
        { category },
      );
    }
  }
}

function getPath(root: JsonValue, path: string): JsonValue | undefined {
  const parts = path
    .replace(/^\$\.?/, "")
    .split(".")
    .filter(Boolean);
  let current: JsonValue | undefined = root;
  for (const part of parts) {
    if (!current || Array.isArray(current) || typeof current !== "object")
      return undefined;
    current = current[part];
  }
  return current;
}

function evaluateRule(result: JsonValue, rule: AcceptanceRule): boolean {
  const actual = getPath(result, rule.path);
  switch (rule.operator) {
    case "present":
      return actual !== undefined && actual !== null;
    case "equals":
      return canonicalJson(actual) === canonicalJson(rule.value);
    case "not_equals":
      return canonicalJson(actual) !== canonicalJson(rule.value);
    case "gte":
      return (
        typeof actual === "number" &&
        typeof rule.value === "number" &&
        actual >= rule.value
      );
    case "lte":
      return (
        typeof actual === "number" &&
        typeof rule.value === "number" &&
        actual <= rule.value
      );
    case "matches":
      return (
        typeof actual === "string" &&
        typeof rule.value === "string" &&
        new RegExp(rule.value, "u").test(actual)
      );
  }
}

export function registrationMessage(
  registration: Omit<AgentRegistration, "registration_signature">,
): string {
  return [
    `${MARKET_ID} agent registration`,
    `Protocol: ${PROTOCOL_VERSION}`,
    canonicalJson(registration),
  ].join("\n");
}

export function deliveryManifestMessage(
  manifest: Omit<SignedDeliveryManifest, "signature">,
): string {
  return [`${MARKET_ID} signed delivery`, canonicalJson(manifest)].join("\n");
}

export function communityMessageToSign(input: {
  channel_id: string;
  author_agent_id: string;
  type: CommunityMessage["type"];
  content_type: "application/json";
  content: JsonValue;
  tags: string[];
  mentions: string[];
  reply_to: string | null;
  expires_at: string | null;
}): string {
  return [`${MARKET_ID} community message`, canonicalJson(input)].join("\n");
}

export function signedRequestMessage(input: {
  domain: string;
  agentId: string;
  method: string;
  path: string;
  idempotencyKey: string;
  signedAt: string;
  body: unknown;
}): string {
  return [
    `${MARKET_ID} signed request`,
    input.domain.toLowerCase(),
    input.agentId,
    input.method.toUpperCase(),
    input.path,
    input.idempotencyKey,
    input.signedAt,
    sha256(canonicalJson(input.body)),
  ].join("\n");
}

export function marketplaceJobDefinitionDigest(
  job: Pick<
    Job,
    | "listingId"
    | "type"
    | "title"
    | "description"
    | "input"
    | "inputSchema"
    | "outputSchema"
    | "maximumExecutionSeconds"
    | "budgetMinor"
    | "asset"
    | "requiredReputation"
    | "requiredCapabilities"
    | "acceptanceRules"
    | "artifactMimeTypes"
    | "maximumArtifactBytes"
    | "licenseTerms"
    | "refundRules"
    | "timeoutRules"
    | "tags"
    | "policyCategory"
  >,
): string {
  return sha256(
    canonicalJson({
      listing_id: job.listingId,
      type: job.type,
      title: job.title,
      description: job.description,
      input: job.input,
      input_schema: job.inputSchema,
      output_schema: job.outputSchema,
      maximum_execution_seconds: job.maximumExecutionSeconds,
      budget_minor: job.budgetMinor.toString(),
      asset: job.asset,
      required_reputation: job.requiredReputation,
      required_capabilities: job.requiredCapabilities,
      acceptance_rules: job.acceptanceRules,
      artifact_mime_types: job.artifactMimeTypes,
      maximum_artifact_bytes: job.maximumArtifactBytes,
      license_terms: job.licenseTerms,
      refund_rules: job.refundRules,
      timeout_rules: job.timeoutRules,
      tags: job.tags,
      policy_category: job.policyCategory,
    }),
  );
}

export const CANONICAL_SEEDED_GENESIS_DEFINITION_VERSION =
  "a2a402.seeded-genesis/1";
export const CANONICAL_SEEDED_GENESIS_BUYER_WALLET =
  "0x17c5185167401ed00cf5f5b2fc97d9bbfdb7d025";
export const CANONICAL_SEEDED_GENESIS_BUYER_CAPABILITY = "a2a402_seed_buyer";
export function canonicalSeededGenesisDefinition(
  maximumArtifactBytes = 10_000_000,
): Parameters<typeof marketplaceJobDefinitionDigest>[0] {
  return {
    listingId: null,
    type: "open_bid",
    title: "Genesis: verify autonomous marketplace discovery",
    description:
      "Return a JSON report showing the discovery endpoints inspected, the canonical registration path used, and the TEST-only safeguards observed.",
    input: {
      discovery: "https://a2a402.market/api/discovery",
      onboarding: "https://a2a402.market/onboarding.json",
    },
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    maximumExecutionSeconds: 86_400,
    budgetMinor: 400_000n,
    asset: "USDC",
    requiredReputation: {},
    requiredCapabilities: ["protocol_analysis"],
    acceptanceRules: [],
    artifactMimeTypes: ["application/json"],
    maximumArtifactBytes,
    licenseTerms: "Marketplace output license",
    refundRules: {},
    timeoutRules: {
      bidExpirationSeconds: 31_536_000,
      sellerAcceptanceSeconds: 86_400,
      deliverySeconds: 604_800,
      evaluationSeconds: 86_400,
      buyerResponseSeconds: 86_400,
      automaticRefundSeconds: 1_209_600,
      automaticSettlementSeconds: 604_800,
    },
    tags: ["discovery", "genesis", "seeded-test-job"],
    policyCategory: "analysis",
  };
}

export function canonicalSeededGenesisDefinitionDigest(
  maximumArtifactBytes = 10_000_000,
): string {
  return marketplaceJobDefinitionDigest(
    canonicalSeededGenesisDefinition(maximumArtifactBytes),
  );
}

export class MarketplaceEngine {
  readonly config: MarketplaceConfig;
  readonly signer: PlatformSigner;

  private readonly agents = new Map<string, Agent>();
  private readonly agentsByWallet = new Map<string, string>();
  private readonly nonces = new Map<string, AuthNonce>();
  private readonly listings = new Map<string, ServiceListing>();
  private readonly jobs = new Map<string, Job>();
  private readonly bids = new Map<string, Bid>();
  private readonly contracts = new Map<string, Contract>();
  private readonly deliveries = new Map<string, Delivery>();
  private readonly artifacts = new Map<string, Artifact>();
  private readonly evaluations = new Map<string, Evaluation>();
  private readonly capitalLots = new Map<string, CapitalLot>();
  private readonly reservations = new Map<string, CapitalReservation>();
  private readonly ledgerAccounts = new Map<string, LedgerAccount>();
  private readonly ledgerTransactions: LedgerTransaction[] = [];
  private readonly ledgerEntries: LedgerEntry[] = [];
  private readonly settlements = new Map<string, Settlement>();
  private readonly paymentIntents = new Map<string, PaymentIntent>();
  private readonly platformFees: PlatformFee[] = [];
  private readonly receipts = new Map<string, SignedReceipt>();
  private readonly disputes = new Map<string, Dispute>();
  private readonly attestations = new Map<string, ImportedAttestation>();
  private readonly usedPaymentTransactions = new Set<string>();
  private readonly usedReplayProtectionIds = new Set<string>();
  private readonly reputationEvents: ReputationEvent[] = [];
  private readonly riskFlags = new Map<string, RiskFlag[]>();
  private readonly channels = new Map<string, CommunityChannel>();
  private readonly messages = new Map<string, CommunityMessage>();
  private readonly recentMessageTimes = new Map<string, number[]>();
  private readonly audits: AuditEvent[] = [];
  private readonly outbox: OutboxEvent[] = [];
  private readonly webhookSubscriptions = new Map<
    string,
    WebhookSubscription
  >();
  private readonly webhookSecretCiphertexts = new Map<string, string>();
  private readonly webhookDeliveries = new Map<string, WebhookDelivery>();
  private readonly discoveryEvidence = new Map<string, DiscoveryEvidence>();
  private readonly genesisAgents = new Map<string, GenesisAgentRecord>();
  private canonicalSeededGenesisDesignation: CanonicalSeededGenesisDesignation | null =
    null;
  private operationalMetrics: OperationalMetrics = {
    counts: {
      discovery_visits: 0,
      onboarding_views: 0,
      failed_registrations: 0,
      successful_registrations: 0,
      bids: 0,
      completed_bounties: 0,
      notification_failures: 0,
    },
    updatedAt: null,
  };
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly paymentAdapter: PaymentAdapter | null;
  private readonly artifactStorage: ArtifactStorage | null;
  private readonly evaluators: EvaluatorAdapter[];
  private persistenceHook: ((snapshot: unknown) => Promise<void>) | null = null;
  private sequence = 0;

  constructor(config: Partial<MarketplaceConfig> = {}) {
    const defaults: MarketplaceConfig = {
      baseUrl: "http://localhost:3000",
      publicMarketUrl: "https://a2a402.market",
      domain: "a2a402.market",
      simulationMode: true,
      platformFeeBps: 500,
      jwtSecret: "development-only-change-me-at-least-32-bytes",
      nonceTtlSeconds: 300,
      tokenTtlSeconds: 900,
      maxJobAmountMinor: 100_000_000n,
      maxAgentDailySpendMinor: 250_000_000n,
      maxArtifactBytes: 10_000_000,
      communityMessagesPerMinute: 30,
    };
    this.config = { ...defaults, ...config };
    this.paymentAdapter = this.config.paymentAdapter ?? null;
    this.artifactStorage = this.config.artifactStorage ?? null;
    this.evaluators = [...(this.config.evaluators ?? [])];
    if (this.config.platformFeeBps < 0 || this.config.platformFeeBps > 10_000) {
      throw new Error("platformFeeBps must be between 0 and 10000");
    }
    if (
      !this.config.simulationMode &&
      this.config.jwtSecret.startsWith("development-")
    ) {
      throw new Error(
        "A production JWT secret is required outside simulation mode.",
      );
    }
    this.signer = new PlatformSigner(
      this.config.signingPrivateKeyPem,
      this.config.signingKeyId,
    );
  }

  async withIdempotency<T>(
    agentId: string,
    scope: string,
    key: string,
    input: unknown,
    action: () => Promise<T> | T,
  ): Promise<T> {
    const recordKey = `${agentId}:${scope}:${key}`;
    const hash = sha256(canonicalJson(input));
    let existing = this.idempotency.get(recordKey);
    if (existing && existing.expiresAt <= Date.now()) {
      this.idempotency.delete(recordKey);
      existing = undefined;
    }
    if (existing) {
      if (existing.hash !== hash) {
        throw new MarketplaceError(
          "IDEMPOTENCY_CONFLICT",
          "The idempotency key was already used with a different request.",
          409,
        );
      }
      if (existing.pending) return clone((await existing.pending) as T);
      return clone(existing.result as T);
    }
    const beforeMutation = this.exportSnapshot();
    const pending = Promise.resolve().then(action);
    const expiresAt =
      Date.now() +
      (scope.includes("auth_verify")
        ? this.config.tokenTtlSeconds * 1_000
        : 24 * 60 * 60 * 1_000);
    const persist = !scope.includes("auth_verify");
    this.idempotency.set(recordKey, {
      hash,
      pending,
      expiresAt,
      persist,
    });
    let result: T;
    try {
      result = await pending;
    } catch (error) {
      this.idempotency.delete(recordKey);
      if (
        !(error instanceof MarketplaceError) ||
        error.code !== "PAYMENT_REQUIRED"
      ) {
        this.restoreSnapshot(beforeMutation);
      }
      throw error;
    }
    this.idempotency.set(recordKey, {
      hash,
      result: clone(result),
      expiresAt,
      persist,
    });
    try {
      await this.flushPersistence();
    } catch (error) {
      this.restoreSnapshot(beforeMutation);
      throw error;
    }
    return clone(result);
  }

  setPersistenceHook(
    hook: ((snapshot: unknown) => Promise<void>) | null,
  ): void {
    this.persistenceHook = hook;
  }

  async flushPersistence(): Promise<void> {
    if (this.persistenceHook) await this.persistenceHook(this.exportSnapshot());
  }

  private async withLock<T>(
    key: string,
    action: () => Promise<T> | T,
  ): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release = (): void => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.locks.set(key, queued);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.locks.get(key) === queued) this.locks.delete(key);
    }
  }

  private requiredAgent(agentId: string): Agent {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "Agent was not found.",
        404,
        {
          agent_id: agentId,
        },
      );
    }
    return agent;
  }

  private activeAgent(agentId: string): Agent {
    const agent = this.requiredAgent(agentId);
    if (agent.status !== "active") {
      throw new MarketplaceError("FORBIDDEN", "Agent is not active.", 403, {
        agent_id: agentId,
        status: agent.status,
      });
    }
    return agent;
  }

  async registerAgent(input: AgentRegistration): Promise<Agent> {
    policyCheck(input.capabilities);
    const address = input.wallet_address.toLowerCase() as `0x${string}`;
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      throw new MarketplaceError(
        "VALIDATION_ERROR",
        "wallet_address must be an EVM address.",
      );
    }
    if (this.agentsByWallet.has(address)) {
      throw new MarketplaceError(
        "CONFLICT",
        "Wallet is already registered.",
        409,
      );
    }
    const externalUrl = input.external_agent_card_url
      ? safePublicUrl(input.external_agent_card_url, this.config.simulationMode)
      : null;
    const unsigned: Omit<AgentRegistration, "registration_signature"> = {
      wallet_address: address,
      signing_key: input.signing_key ?? address,
      external_agent_card_url: externalUrl,
      capabilities: [...new Set(input.capabilities)].sort(),
      input_modalities: [
        ...new Set(input.input_modalities ?? ["application/json"]),
      ].sort(),
      output_modalities: [
        ...new Set(input.output_modalities ?? ["application/json"]),
      ].sort(),
    };
    const valid = await verifyMessage({
      address,
      message: registrationMessage(unsigned),
      signature: input.registration_signature,
    }).catch(() => false);
    if (!valid) {
      throw new MarketplaceError(
        "SIGNATURE_INVALID",
        "Registration signature is invalid.",
        401,
      );
    }
    const createdAt = nowIso();
    const agent: Agent = {
      id: uuid(),
      walletAddress: address,
      signingKey: unsigned.signing_key ?? address,
      externalAgentCardUrl: externalUrl,
      capabilities: unsigned.capabilities,
      inputModalities: unsigned.input_modalities ?? ["application/json"],
      outputModalities: unsigned.output_modalities ?? ["application/json"],
      status: "active",
      spendLimitMinor: null,
      earnLimitMinor: null,
      createdAt,
      updatedAt: createdAt,
    };
    this.agents.set(agent.id, agent);
    this.agentsByWallet.set(address, agent.id);
    this.audit(agent.id, "agent.registered", "agent", agent.id, agent);
    this.emit("agent.registered", "agent", agent.id, {
      agent_id: agent.id,
      wallet_address: agent.walletAddress,
      capabilities: agent.capabilities,
    });
    return clone(agent);
  }

  recordDiscoveryEvidence(input: {
    firstLandingEndpoint: string;
    source: DiscoverySource;
    sourceEvidence: DiscoveryEvidence["sourceEvidence"];
    referrerOrigin?: string | null;
    campaignSource?: string | null;
    userAgentFamily?: string | null;
    agentFramework?: string | null;
    discoveryDocument?: string | null;
    selfReportedSource?: string | null;
  }): DiscoveryEvidence {
    const createdAt = nowIso();
    const evidence: DiscoveryEvidence = {
      id: uuid(),
      firstLandingEndpoint: input.firstLandingEndpoint,
      source: input.source,
      sourceEvidence: input.sourceEvidence,
      referrerOrigin: input.referrerOrigin ?? null,
      campaignSource: input.campaignSource ?? null,
      userAgentFamily: input.userAgentFamily ?? null,
      agentFramework: input.agentFramework ?? null,
      discoveryDocument: input.discoveryDocument ?? null,
      selfReportedSource: input.selfReportedSource ?? null,
      agentId: null,
      firstAuthenticatedAction: null,
      createdAt,
      linkedAt: null,
    };
    this.discoveryEvidence.set(evidence.id, evidence);
    return clone(evidence);
  }

  linkDiscoveryEvidence(
    evidenceId: string,
    agentId: string,
    firstMarketplaceAction = "agent.registered",
  ): GenesisAgentRecord {
    this.requiredAgent(agentId);
    const evidence = this.discoveryEvidence.get(evidenceId);
    if (!evidence) {
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "Discovery evidence was not found.",
        404,
      );
    }
    if (evidence.agentId && evidence.agentId !== agentId) {
      throw new MarketplaceError(
        "CONFLICT",
        "Discovery evidence is already linked to another agent.",
        409,
      );
    }
    const linkedAt = nowIso();
    evidence.agentId = agentId;
    evidence.firstAuthenticatedAction ??= firstMarketplaceAction;
    evidence.linkedAt ??= linkedAt;
    const existing = this.genesisAgents.get(agentId);
    if (existing) return clone(existing);
    const record: GenesisAgentRecord = {
      agentId,
      sequence: this.genesisAgents.size + 1,
      discoveryEvidenceId: evidence.id,
      discoveryTimestamp: evidence.createdAt,
      firstDiscoveredEndpoint: evidence.firstLandingEndpoint,
      discoverySource: evidence.source,
      agentFramework: evidence.agentFramework,
      humanDirectedDiscovery: "unknown",
      proofOfEarnStatus: "unverified",
      firstMarketplaceAction,
      createdAt: linkedAt,
    };
    this.genesisAgents.set(agentId, record);
    this.audit(agentId, "discovery.genesis_assigned", "agent", agentId, {
      genesis_sequence: record.sequence,
      discovery_evidence_id: evidence.id,
    });
    return clone(record);
  }

  getDiscoveryEvidence(evidenceId: string): DiscoveryEvidence {
    const evidence = this.discoveryEvidence.get(evidenceId);
    if (!evidence) {
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "Discovery evidence was not found.",
        404,
      );
    }
    return clone(evidence);
  }

  listGenesisAgents(): GenesisAgentRecord[] {
    return [...this.genesisAgents.values()]
      .sort((left, right) => left.sequence - right.sequence)
      .map(clone);
  }

  listAgents(
    filters: {
      capability?: string;
      status?: Agent["status"];
    } = {},
  ): Agent[] {
    return [...this.agents.values()]
      .filter(
        (agent) =>
          !filters.capability ||
          agent.capabilities.includes(filters.capability),
      )
      .filter((agent) =>
        filters.status
          ? agent.status === filters.status
          : agent.status !== "retired",
      )
      .map(clone);
  }

  getAgent(agentId: string): Agent {
    return clone(this.requiredAgent(agentId));
  }

  updateAgent(
    actorAgentId: string,
    targetAgentId: string,
    patch: {
      capabilities?: string[];
      external_agent_card_url?: string | null;
      input_modalities?: string[];
      output_modalities?: string[];
      spend_limit_minor?: string | number | bigint | null;
      earn_limit_minor?: string | number | bigint | null;
    },
  ): Agent {
    if (actorAgentId !== targetAgentId) {
      throw new MarketplaceError(
        "FORBIDDEN",
        "Agents may update only themselves.",
        403,
      );
    }
    const agent = this.activeAgent(targetAgentId);
    if (patch.capabilities) {
      policyCheck(patch.capabilities);
      agent.capabilities = [...new Set(patch.capabilities)].sort();
    }
    if (patch.external_agent_card_url !== undefined) {
      agent.externalAgentCardUrl = patch.external_agent_card_url
        ? safePublicUrl(
            patch.external_agent_card_url,
            this.config.simulationMode,
          )
        : null;
    }
    if (patch.input_modalities)
      agent.inputModalities = [...new Set(patch.input_modalities)].sort();
    if (patch.output_modalities)
      agent.outputModalities = [...new Set(patch.output_modalities)].sort();
    if (patch.spend_limit_minor !== undefined) {
      agent.spendLimitMinor =
        patch.spend_limit_minor === null
          ? null
          : parseMinor(patch.spend_limit_minor, "spend_limit_minor");
    }
    if (patch.earn_limit_minor !== undefined) {
      agent.earnLimitMinor =
        patch.earn_limit_minor === null
          ? null
          : parseMinor(patch.earn_limit_minor, "earn_limit_minor");
    }
    agent.updatedAt = nowIso();
    this.audit(actorAgentId, "agent.updated", "agent", targetAgentId, patch);
    return clone(agent);
  }

  retireAgent(
    actorAgentId: string,
    targetAgentId: string,
    reasonCode = "agent_requested",
  ): Agent {
    if (actorAgentId !== targetAgentId) {
      throw new MarketplaceError(
        "FORBIDDEN",
        "Agents may revoke only their own registration.",
        403,
      );
    }
    const agent = this.activeAgent(targetAgentId);
    const unresolvedContract = [...this.contracts.values()].find(
      (contract) =>
        (contract.buyerAgentId === targetAgentId ||
          contract.sellerAgentId === targetAgentId) &&
        !["settled", "refunded"].includes(contract.status),
    );
    if (unresolvedContract) {
      throw new MarketplaceError(
        "CONFLICT",
        "Agent registration cannot be revoked while a contract is unresolved.",
        409,
        { contract_id: unresolvedContract.id },
      );
    }
    const activeJob = [...this.jobs.values()].find(
      (job) =>
        job.buyerAgentId === targetAgentId &&
        ["open", "awarded"].includes(job.status),
    );
    if (activeJob) {
      throw new MarketplaceError(
        "CONFLICT",
        "Agent registration cannot be revoked while a job is open or awarded.",
        409,
        { job_id: activeJob.id },
      );
    }
    const activeListing = [...this.listings.values()].find(
      (listing) =>
        listing.sellerAgentId === targetAgentId && listing.status === "active",
    );
    if (activeListing) {
      throw new MarketplaceError(
        "CONFLICT",
        "Agent registration cannot be revoked while a listing is active.",
        409,
        { listing_id: activeListing.id },
      );
    }
    agent.status = "retired";
    agent.capabilities = [];
    agent.inputModalities = [];
    agent.outputModalities = [];
    agent.externalAgentCardUrl = null;
    agent.updatedAt = nowIso();
    for (const nonce of this.nonces.values()) {
      if (nonce.agentId === targetAgentId && !nonce.consumedAt) {
        nonce.consumedAt = agent.updatedAt;
      }
    }
    this.audit(
      actorAgentId,
      "agent.registration_revoked",
      "agent",
      targetAgentId,
      {
        reason_code: reasonCode.slice(0, 64),
        retained_fields: [
          "id",
          "wallet_address",
          "status",
          "created_at",
          "updated_at",
          "economic_and_audit_records",
        ],
      },
    );
    this.emit("agent.registration_revoked", "agent", targetAgentId, {
      agent_id: targetAgentId,
      reason_code: reasonCode.slice(0, 64),
    });
    return clone(agent);
  }

  recordOperationalMetric(name: OperationalMetricName): OperationalMetrics {
    this.operationalMetrics.counts[name] += 1;
    this.operationalMetrics.updatedAt = nowIso();
    return clone(this.operationalMetrics);
  }

  getOperationalMetrics(): OperationalMetrics {
    return clone(this.operationalMetrics);
  }

  createAuthChallenge(agentId: string): AuthNonce {
    const agent = this.activeAgent(agentId);
    const nonce = randomBytes(16).toString("base64url");
    const issuedAt = nowIso();
    const expiresAt = plusSeconds(issuedAt, this.config.nonceTtlSeconds);
    const challenge = [
      `${this.config.domain} wants you to sign in with your Ethereum account:`,
      agent.walletAddress,
      "",
      "Authenticate an autonomous marketplace agent.",
      "",
      `URI: ${this.config.baseUrl}`,
      "Version: 1",
      "Chain ID: 84532",
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt}`,
      `Expiration Time: ${expiresAt}`,
      `Request ID: ${agent.id}`,
      "Resources:",
      `- urn:a2a402:protocol:${PROTOCOL_VERSION}`,
    ].join("\n");
    const record: AuthNonce = {
      id: uuid(),
      agentId,
      walletAddress: agent.walletAddress,
      nonce,
      challenge,
      expiresAt,
      consumedAt: null,
      createdAt: issuedAt,
    };
    this.nonces.set(record.id, record);
    return clone(record);
  }

  async verifyAuthChallenge(
    nonceId: string,
    signature: `0x${string}`,
  ): Promise<{
    access_token: string;
    token_type: "Bearer";
    expires_in: number;
    agent_id: string;
  }> {
    return this.withLock(`nonce:${nonceId}`, async () => {
      const nonce = this.nonces.get(nonceId);
      if (!nonce) {
        throw new MarketplaceError(
          "AUTH_INVALID",
          "Authentication nonce was not found.",
          401,
        );
      }
      if (nonce.consumedAt) {
        throw new MarketplaceError(
          "AUTH_NONCE_REPLAYED",
          "Authentication nonce has already been consumed.",
          409,
        );
      }
      if (Date.parse(nonce.expiresAt) <= Date.now()) {
        throw new MarketplaceError(
          "AUTH_NONCE_EXPIRED",
          "Authentication nonce has expired.",
          401,
        );
      }
      const valid = await verifyMessage({
        address: nonce.walletAddress,
        message: nonce.challenge,
        signature,
      }).catch(() => false);
      if (!valid) {
        throw new MarketplaceError(
          "SIGNATURE_INVALID",
          "Challenge signature is invalid.",
          401,
        );
      }
      nonce.consumedAt = nowIso();
      const now = Math.floor(Date.now() / 1_000);
      const payload: TokenPayload = {
        sub: nonce.agentId,
        wallet: nonce.walletAddress,
        iat: now,
        exp: now + this.config.tokenTtlSeconds,
        jti: uuid(),
      };
      const token = this.signToken(payload);
      this.audit(nonce.agentId, "auth.verified", "auth_nonce", nonce.id, {
        nonce_id: nonce.id,
      });
      return {
        access_token: token,
        token_type: "Bearer",
        expires_in: this.config.tokenTtlSeconds,
        agent_id: nonce.agentId,
      };
    });
  }

  private signToken(payload: TokenPayload): string {
    const header = Buffer.from(
      canonicalJson({ alg: "HS256", typ: "JWT" }),
    ).toString("base64url");
    const body = Buffer.from(canonicalJson(payload)).toString("base64url");
    const signature = createHmac("sha256", this.config.jwtSecret)
      .update(`${header}.${body}`)
      .digest("base64url");
    return `${header}.${body}.${signature}`;
  }

  authenticate(token: string): Agent {
    const [header, body, signature, extra] = token.split(".");
    if (!header || !body || !signature || extra) {
      throw new MarketplaceError(
        "AUTH_INVALID",
        "Access token is malformed.",
        401,
      );
    }
    const expected = createHmac("sha256", this.config.jwtSecret)
      .update(`${header}.${body}`)
      .digest("base64url");
    if (!secureEqual(signature, expected)) {
      throw new MarketplaceError(
        "AUTH_INVALID",
        "Access token signature is invalid.",
        401,
      );
    }
    let payload: TokenPayload;
    try {
      payload = JSON.parse(
        Buffer.from(body, "base64url").toString("utf8"),
      ) as TokenPayload;
    } catch {
      throw new MarketplaceError(
        "AUTH_INVALID",
        "Access token payload is invalid.",
        401,
      );
    }
    if (!payload.sub || payload.exp <= Math.floor(Date.now() / 1_000)) {
      throw new MarketplaceError(
        "AUTH_INVALID",
        "Access token has expired.",
        401,
      );
    }
    const agent = this.activeAgent(payload.sub);
    if (agent.walletAddress.toLowerCase() !== payload.wallet.toLowerCase()) {
      throw new MarketplaceError(
        "AUTH_INVALID",
        "Access token wallet does not match agent.",
        401,
      );
    }
    return clone(agent);
  }

  async verifySignedRequest(input: {
    agentId: string;
    method: string;
    path: string;
    idempotencyKey: string;
    signedAt: string;
    body: unknown;
    signature: `0x${string}`;
  }): Promise<void> {
    const agent = this.activeAgent(input.agentId);
    const timestamp = Date.parse(input.signedAt);
    if (
      !Number.isFinite(timestamp) ||
      Math.abs(Date.now() - timestamp) > 5 * 60 * 1_000
    ) {
      throw new MarketplaceError(
        "SIGNATURE_INVALID",
        "Signed request timestamp is stale.",
        401,
      );
    }
    const valid = await verifyMessage({
      address: agent.signingKey,
      message: signedRequestMessage({
        ...input,
        domain: this.config.domain,
      }),
      signature: input.signature,
    }).catch(() => false);
    if (!valid) {
      throw new MarketplaceError(
        "SIGNATURE_INVALID",
        "Signed request is invalid.",
        401,
      );
    }
  }

  createListing(sellerAgentId: string, input: ListingInput): ServiceListing {
    this.activeAgent(sellerAgentId);
    policyCheck(input);
    const amount = parseMinor(input.price_minor, "price_minor");
    if (amount <= 0n) {
      throw new MarketplaceError(
        "VALIDATION_ERROR",
        "Listing price must be positive.",
      );
    }
    const createdAt = nowIso();
    const listing: ServiceListing = {
      id: uuid(),
      sellerAgentId,
      type: input.type,
      version: 1,
      status: "active",
      title: input.title,
      description: input.description,
      inputSchema: input.input_schema ?? { type: "object" },
      outputSchema: input.output_schema,
      maximumExecutionSeconds: input.maximum_execution_seconds ?? 86_400,
      priceMinor: amount,
      asset: input.asset ?? DEFAULT_ASSET,
      requiredReputation: input.required_reputation ?? {},
      requiredCapabilities: input.required_capabilities ?? [],
      acceptanceRules: input.acceptance_rules ?? [],
      artifactMimeTypes: input.artifact_mime_types ?? ["application/json"],
      licenseTerms:
        input.license_terms ?? "Marketplace single-use output license",
      refundRules: input.refund_rules ?? {},
      timeoutRules: input.timeout_rules ?? {},
      tags: [...new Set(input.tags ?? [])].sort(),
      policyCategory: input.policy_category ?? "general_digital_work",
      sellerA2aEndpoint: input.seller_a2a_endpoint
        ? safePublicUrl(input.seller_a2a_endpoint, this.config.simulationMode)
        : null,
      sellerWebhookEndpoint: input.seller_webhook_endpoint
        ? safePublicUrl(
            input.seller_webhook_endpoint,
            this.config.simulationMode,
          )
        : null,
      createdAt,
      updatedAt: createdAt,
    };
    this.listings.set(listing.id, listing);
    this.audit(
      sellerAgentId,
      "listing.created",
      "listing",
      listing.id,
      listing,
    );
    this.emit("listing.created", "listing", listing.id, {
      listing_id: listing.id,
      seller_agent_id: sellerAgentId,
      price_minor: amount.toString(),
      asset: listing.asset,
    });
    return clone(listing);
  }

  listListings(
    filters: {
      type?: ServiceListing["type"];
      sellerAgentId?: string;
      capability?: string;
      tag?: string;
      status?: ServiceListing["status"];
    } = {},
  ): ServiceListing[] {
    return [...this.listings.values()]
      .filter((listing) => !filters.type || listing.type === filters.type)
      .filter(
        (listing) =>
          !filters.sellerAgentId ||
          listing.sellerAgentId === filters.sellerAgentId,
      )
      .filter((listing) =>
        !filters.capability
          ? true
          : listing.requiredCapabilities.includes(filters.capability),
      )
      .filter((listing) => !filters.tag || listing.tags.includes(filters.tag))
      .filter((listing) => !filters.status || listing.status === filters.status)
      .map(clone);
  }

  getListing(listingId: string): ServiceListing {
    const listing = this.listings.get(listingId);
    if (!listing)
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "Listing was not found.",
        404,
      );
    return clone(listing);
  }

  updateListing(
    actorAgentId: string,
    listingId: string,
    patch: Partial<Omit<ListingInput, "type">> & {
      status?: ServiceListing["status"];
    },
  ): ServiceListing {
    const listing = this.listings.get(listingId);
    if (!listing)
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "Listing was not found.",
        404,
      );
    if (listing.sellerAgentId !== actorAgentId) {
      throw new MarketplaceError(
        "FORBIDDEN",
        "Only the seller may update the listing.",
        403,
      );
    }
    policyCheck(patch);
    if (patch.title !== undefined) listing.title = patch.title;
    if (patch.description !== undefined)
      listing.description = patch.description;
    if (patch.input_schema !== undefined)
      listing.inputSchema = patch.input_schema;
    if (patch.output_schema !== undefined)
      listing.outputSchema = patch.output_schema;
    if (patch.price_minor !== undefined) {
      const price = parseMinor(patch.price_minor, "price_minor");
      if (price <= 0n)
        throw new MarketplaceError(
          "VALIDATION_ERROR",
          "Price must be positive.",
        );
      listing.priceMinor = price;
    }
    if (patch.status !== undefined) listing.status = patch.status;
    if (patch.tags !== undefined)
      listing.tags = [...new Set(patch.tags)].sort();
    if (patch.acceptance_rules !== undefined)
      listing.acceptanceRules = patch.acceptance_rules;
    listing.version += 1;
    listing.updatedAt = nowIso();
    this.audit(actorAgentId, "listing.updated", "listing", listingId, patch);
    return clone(listing);
  }

  deleteListing(actorAgentId: string, listingId: string): ServiceListing {
    return this.updateListing(actorAgentId, listingId, { status: "retired" });
  }

  createJob(buyerAgentId: string, input: JobInput): Job {
    const buyer = this.activeAgent(buyerAgentId);
    policyCheck(input);
    const budget = parseMinor(input.budget_minor, "budget_minor");
    if (budget <= 0n || budget > this.config.maxJobAmountMinor) {
      throw new MarketplaceError(
        "VALIDATION_ERROR",
        "Job budget is outside platform limits.",
        422,
        {
          max_job_amount_minor: this.config.maxJobAmountMinor.toString(),
        },
      );
    }
    if (buyer.spendLimitMinor !== null && budget > buyer.spendLimitMinor) {
      throw new MarketplaceError(
        "FORBIDDEN",
        "Job exceeds the agent spending limit.",
        403,
      );
    }
    let listing: ServiceListing | null = null;
    if (input.listing_id) {
      listing = this.listings.get(input.listing_id) ?? null;
      if (!listing || listing.status !== "active") {
        throw new MarketplaceError(
          "RESOURCE_NOT_FOUND",
          "Active listing was not found.",
          404,
        );
      }
      if (listing.asset !== (input.asset ?? DEFAULT_ASSET)) {
        throw new MarketplaceError(
          "VALIDATION_ERROR",
          "Job and listing assets differ.",
        );
      }
    }
    const timeouts = { ...DEFAULT_TIMEOUTS, ...(input.timeout_rules ?? {}) };
    const createdAt = nowIso();
    const job: Job = {
      id: uuid(),
      buyerAgentId,
      listingId: listing?.id ?? null,
      type: input.type,
      status: "open",
      title: input.title,
      description: input.description,
      input: input.input ?? {},
      inputSchema: input.input_schema ??
        listing?.inputSchema ?? { type: "object" },
      outputSchema: input.output_schema ??
        listing?.outputSchema ?? { type: "object" },
      maximumExecutionSeconds:
        input.maximum_execution_seconds ??
        listing?.maximumExecutionSeconds ??
        86_400,
      budgetMinor: budget,
      asset: input.asset ?? DEFAULT_ASSET,
      requiredReputation:
        input.required_reputation ?? listing?.requiredReputation ?? {},
      requiredCapabilities:
        input.required_capabilities ?? listing?.requiredCapabilities ?? [],
      acceptanceRules: input.acceptance_rules ?? listing?.acceptanceRules ?? [],
      artifactMimeTypes: input.artifact_mime_types ??
        listing?.artifactMimeTypes ?? ["application/json"],
      maximumArtifactBytes: Math.min(
        input.maximum_artifact_bytes ?? this.config.maxArtifactBytes,
        this.config.maxArtifactBytes,
      ),
      licenseTerms:
        input.license_terms ??
        listing?.licenseTerms ??
        "Marketplace output license",
      refundRules: input.refund_rules ?? listing?.refundRules ?? {},
      timeoutRules: timeouts,
      tags: [...new Set(input.tags ?? listing?.tags ?? [])].sort(),
      policyCategory:
        input.policy_category ??
        listing?.policyCategory ??
        "general_digital_work",
      bidDeadline: plusSeconds(createdAt, timeouts.bidExpirationSeconds),
      createdAt,
      updatedAt: createdAt,
    };
    const validateInput = new Ajv({ strict: false, allErrors: true }).compile(
      job.inputSchema,
    );
    if (!validateInput(job.input)) {
      throw new MarketplaceError(
        "SCHEMA_VALIDATION_FAILED",
        "Job input does not satisfy input_schema.",
        422,
        { errors: asJson(validateInput.errors ?? []) },
      );
    }
    this.jobs.set(job.id, job);
    this.audit(buyerAgentId, "job.created", "job", job.id, job);
    this.emit("job.created", "job", job.id, {
      job_id: job.id,
      buyer_agent_id: buyerAgentId,
      budget_minor: budget.toString(),
      asset: job.asset,
    });
    return clone(job);
  }

  listJobs(
    filters: {
      status?: Job["status"];
      type?: Job["type"];
      buyerAgentId?: string;
      capability?: string;
      tag?: string;
    } = {},
  ): Job[] {
    return [...this.jobs.values()]
      .filter((job) => !filters.status || job.status === filters.status)
      .filter((job) => !filters.type || job.type === filters.type)
      .filter(
        (job) =>
          !filters.buyerAgentId || job.buyerAgentId === filters.buyerAgentId,
      )
      .filter((job) =>
        !filters.capability
          ? true
          : job.requiredCapabilities.includes(filters.capability),
      )
      .filter((job) => !filters.tag || job.tags.includes(filters.tag))
      .map(clone);
  }

  getJob(jobId: string): Job {
    const job = this.jobs.get(jobId);
    if (!job)
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "Job was not found.",
        404,
      );
    return clone(job);
  }

  setCanonicalSeededGenesisJob(
    designation: CanonicalSeededGenesisDesignation,
  ): Job {
    if (!this.config.simulationMode) {
      throw new MarketplaceError(
        "FORBIDDEN",
        "A canonical seeded Genesis job may only be designated in simulation mode.",
        403,
      );
    }
    const job = this.jobs.get(designation.jobId);
    if (!job) {
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "The canonical seeded Genesis job was not found.",
        404,
      );
    }
    const buyer = this.agents.get(designation.buyerAgentId);
    const expectedDefinitionDigest = canonicalSeededGenesisDefinitionDigest(
      this.config.maxArtifactBytes,
    );
    if (
      designation.definitionVersion !==
        CANONICAL_SEEDED_GENESIS_DEFINITION_VERSION ||
      designation.definitionDigest !== expectedDefinitionDigest ||
      job.buyerAgentId !== designation.buyerAgentId ||
      marketplaceJobDefinitionDigest(job) !== expectedDefinitionDigest ||
      buyer?.walletAddress !== CANONICAL_SEEDED_GENESIS_BUYER_WALLET ||
      !buyer.capabilities.includes(CANONICAL_SEEDED_GENESIS_BUYER_CAPABILITY)
    ) {
      throw new MarketplaceError(
        "VALIDATION_ERROR",
        "The canonical seeded Genesis designation does not match the job definition.",
        422,
      );
    }
    if (
      this.canonicalSeededGenesisDesignation &&
      canonicalJson(this.canonicalSeededGenesisDesignation) !==
        canonicalJson(designation)
    ) {
      throw new MarketplaceError(
        "CONFLICT",
        "A different canonical seeded Genesis job is already designated.",
        409,
        {
          canonical_job_id: this.canonicalSeededGenesisDesignation.jobId,
        },
      );
    }
    if (!this.canonicalSeededGenesisDesignation) {
      this.canonicalSeededGenesisDesignation = clone(designation);
      this.audit(
        null,
        "simulation.genesis_job_designated",
        "job",
        designation.jobId,
        designation,
      );
      this.emit("simulation.genesis_job_designated", "job", designation.jobId, {
        job_id: designation.jobId,
        buyer_agent_id: designation.buyerAgentId,
        definition_version: designation.definitionVersion,
        definition_digest: designation.definitionDigest,
      });
    }
    return clone(job);
  }

  getCanonicalSeededGenesisDesignation(): CanonicalSeededGenesisDesignation | null {
    return this.canonicalSeededGenesisDesignation
      ? clone(this.canonicalSeededGenesisDesignation)
      : null;
  }

  submitBid(sellerAgentId: string, jobId: string, input: BidInput): Bid {
    const seller = this.activeAgent(sellerAgentId);
    const job = this.jobs.get(jobId);
    if (!job)
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "Job was not found.",
        404,
      );
    if (job.status !== "open" || Date.parse(job.bidDeadline) <= Date.now()) {
      throw new MarketplaceError(
        "INVALID_STATE_TRANSITION",
        "Job is not accepting bids.",
        409,
      );
    }
    if (job.buyerAgentId === sellerAgentId) {
      throw new MarketplaceError(
        "FORBIDDEN",
        "An agent cannot bid on its own job.",
        403,
      );
    }
    const missing = job.requiredCapabilities.filter(
      (capability) => !seller.capabilities.includes(capability),
    );
    if (missing.length > 0) {
      throw new MarketplaceError(
        "FORBIDDEN",
        "Seller does not have all required capabilities.",
        403,
        { missing_capabilities: missing },
      );
    }
    const reputation = this.getReputation(sellerAgentId).snapshot;
    const completedRequired = job.requiredReputation.completed_contracts ?? 0;
    if (reputation.completedContracts < completedRequired) {
      throw new MarketplaceError(
        "FORBIDDEN",
        "Seller does not satisfy the required reputation.",
        403,
        {
          required_completed_contracts: completedRequired,
          actual_completed_contracts: reputation.completedContracts,
        },
      );
    }
    const amount = parseMinor(input.amount_minor, "amount_minor");
    if (amount <= 0n || amount > job.budgetMinor) {
      throw new MarketplaceError(
        "VALIDATION_ERROR",
        "Bid amount exceeds job budget.",
        422,
      );
    }
    if (input.asset && input.asset !== job.asset) {
      throw new MarketplaceError(
        "VALIDATION_ERROR",
        "Bid asset differs from job asset.",
      );
    }
    if (
      input.execution_seconds <= 0 ||
      input.execution_seconds > job.maximumExecutionSeconds
    ) {
      throw new MarketplaceError(
        "VALIDATION_ERROR",
        "Bid execution time is outside job limits.",
      );
    }
    const expiresAt = input.expires_at ?? job.bidDeadline;
    assertFuture(expiresAt);
    const bid: Bid = {
      id: uuid(),
      jobId,
      sellerAgentId,
      amountMinor: amount,
      asset: job.asset,
      executionSeconds: input.execution_seconds,
      proposal: input.proposal ?? {},
      status: "submitted",
      expiresAt,
      createdAt: nowIso(),
    };
    this.bids.set(bid.id, bid);
    this.audit(sellerAgentId, "bid.submitted", "bid", bid.id, bid);
    this.emit("bid.submitted", "bid", bid.id, {
      bid_id: bid.id,
      job_id: jobId,
      seller_agent_id: sellerAgentId,
      amount_minor: amount.toString(),
    });
    return clone(bid);
  }

  listBids(jobId: string): Bid[] {
    this.getJob(jobId);
    return [...this.bids.values()]
      .filter((bid) => bid.jobId === jobId)
      .map(clone);
  }

  async selectBestBid(buyerAgentId: string, jobId: string): Promise<Contract> {
    const job = this.getJob(jobId);
    if (job.buyerAgentId !== buyerAgentId) {
      throw new MarketplaceError(
        "FORBIDDEN",
        "Only the job buyer may run automatic bid selection.",
        403,
      );
    }
    const now = Date.now();
    const candidates = this.listBids(jobId)
      .filter(
        (bid) =>
          bid.status === "submitted" &&
          Date.parse(bid.expiresAt) > now &&
          this.agents.get(bid.sellerAgentId)?.status === "active",
      )
      .sort(
        (left, right) =>
          (left.amountMinor < right.amountMinor
            ? -1
            : left.amountMinor > right.amountMinor
              ? 1
              : 0) ||
          left.executionSeconds - right.executionSeconds ||
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      );
    const selected = candidates[0];
    if (!selected) {
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "No currently eligible bid is available for automatic selection.",
        404,
      );
    }
    this.audit(buyerAgentId, "bid.automatically_selected", "bid", selected.id, {
      job_id: jobId,
      rule: "lowest_amount_then_execution_time_then_fifo",
      candidate_count: candidates.length,
    });
    return this.acceptBid(buyerAgentId, jobId, selected.id);
  }

  async purchaseListing(
    buyerAgentId: string,
    listingId: string,
    input: JsonValue = {},
  ): Promise<Contract> {
    this.activeAgent(buyerAgentId);
    const listing = this.getListing(listingId);
    if (listing.status !== "active") {
      throw new MarketplaceError(
        "INVALID_STATE_TRANSITION",
        "Listing is not available for purchase.",
        409,
      );
    }
    this.activeAgent(listing.sellerAgentId);
    if (listing.sellerAgentId === buyerAgentId) {
      throw new MarketplaceError(
        "FORBIDDEN",
        "An agent cannot purchase its own listing.",
        403,
      );
    }
    const job = this.createJob(buyerAgentId, {
      listing_id: listing.id,
      type: "fixed_price",
      title: listing.title,
      description: `Purchase of listing ${listing.id}: ${listing.description}`,
      input,
      input_schema: listing.inputSchema,
      output_schema: listing.outputSchema,
      maximum_execution_seconds: listing.maximumExecutionSeconds,
      budget_minor: listing.priceMinor,
      asset: listing.asset,
      required_reputation: listing.requiredReputation,
      required_capabilities: listing.requiredCapabilities,
      acceptance_rules: listing.acceptanceRules,
      artifact_mime_types: listing.artifactMimeTypes,
      license_terms: listing.licenseTerms,
      refund_rules: listing.refundRules,
      timeout_rules: listing.timeoutRules as Partial<Job["timeoutRules"]>,
      tags: listing.tags,
      policy_category: listing.policyCategory,
    });
    const bid: Bid = {
      id: uuid(),
      jobId: job.id,
      sellerAgentId: listing.sellerAgentId,
      amountMinor: listing.priceMinor,
      asset: listing.asset,
      executionSeconds: listing.maximumExecutionSeconds,
      proposal: {
        source: "standing_listing_offer",
        listing_id: listing.id,
        listing_version: listing.version,
      },
      status: "submitted",
      expiresAt: job.bidDeadline,
      createdAt: nowIso(),
    };
    this.bids.set(bid.id, bid);
    this.audit(
      listing.sellerAgentId,
      "listing.purchase_offer_materialized",
      "bid",
      bid.id,
      {
        listing_id: listing.id,
        listing_version: listing.version,
        job_id: job.id,
      },
    );
    this.emit("bid.submitted", "bid", bid.id, {
      bid_id: bid.id,
      job_id: job.id,
      seller_agent_id: bid.sellerAgentId,
      amount_minor: bid.amountMinor.toString(),
      source: "standing_listing_offer",
    });
    return this.acceptBid(buyerAgentId, job.id, bid.id);
  }

  async acceptBid(
    buyerAgentId: string,
    jobId: string,
    bidId: string,
  ): Promise<Contract> {
    return this.withLock(`agent-spend:${buyerAgentId}`, () =>
      this.withLock(`job:${jobId}`, async () => {
        const buyer = this.activeAgent(buyerAgentId);
        const job = this.jobs.get(jobId);
        const bid = this.bids.get(bidId);
        if (!job)
          throw new MarketplaceError(
            "RESOURCE_NOT_FOUND",
            "Job was not found.",
            404,
          );
        if (!bid || bid.jobId !== jobId) {
          throw new MarketplaceError(
            "RESOURCE_NOT_FOUND",
            "Bid was not found for this job.",
            404,
          );
        }
        this.activeAgent(bid.sellerAgentId);
        if (job.buyerAgentId !== buyerAgentId) {
          throw new MarketplaceError(
            "FORBIDDEN",
            "Only the buyer may accept a bid.",
            403,
          );
        }
        if (job.status !== "open" || bid.status !== "submitted") {
          throw new MarketplaceError(
            "INVALID_STATE_TRANSITION",
            "Job or bid is not in an acceptable state.",
            409,
          );
        }
        if (Date.parse(bid.expiresAt) <= Date.now()) {
          bid.status = "expired";
          throw new MarketplaceError(
            "INVALID_STATE_TRANSITION",
            "Bid has expired.",
            409,
          );
        }
        const spentToday = this.agentSpendSince(
          buyerAgentId,
          Date.now() - 86_400_000,
        );
        if (
          spentToday + bid.amountMinor >
          this.config.maxAgentDailySpendMinor
        ) {
          throw new MarketplaceError(
            "FORBIDDEN",
            "Agent daily spending limit would be exceeded.",
            403,
            {
              max_agent_daily_spend_minor:
                this.config.maxAgentDailySpendMinor.toString(),
              spent_minor: spentToday.toString(),
              requested_minor: bid.amountMinor.toString(),
            },
          );
        }
        if (
          buyer.spendLimitMinor !== null &&
          spentToday + bid.amountMinor > buyer.spendLimitMinor
        ) {
          throw new MarketplaceError(
            "FORBIDDEN",
            "Configured agent spending limit would be exceeded.",
            403,
          );
        }
        const reservation = this.reserveCapitalUnlocked(
          buyerAgentId,
          job.id,
          bid.amountMinor,
          job.asset,
        );
        const createdAt = nowIso();
        const contract: Contract = {
          id: uuid(),
          jobId,
          bidId,
          buyerAgentId,
          sellerAgentId: bid.sellerAgentId,
          reservationId: reservation.id,
          amountMinor: bid.amountMinor,
          asset: job.asset,
          platformFeeBps: this.config.platformFeeBps,
          status: "active",
          frozen: false,
          statusBeforeFreeze: null,
          sellerAcceptanceDeadline: plusSeconds(
            createdAt,
            job.timeoutRules.sellerAcceptanceSeconds,
          ),
          // A seller-authored bid is itself an explicit offer to perform the
          // work, so accepting that bid also records seller acceptance.
          sellerAcceptedAt: createdAt,
          outputSchema: clone(job.outputSchema),
          acceptanceRules: clone(job.acceptanceRules),
          artifactMimeTypes: [...job.artifactMimeTypes],
          maximumArtifactBytes: job.maximumArtifactBytes,
          deliveryDeadline: plusSeconds(
            createdAt,
            Math.min(job.timeoutRules.deliverySeconds, bid.executionSeconds),
          ),
          evaluationDeadline: plusSeconds(
            plusSeconds(
              createdAt,
              Math.min(job.timeoutRules.deliverySeconds, bid.executionSeconds),
            ),
            job.timeoutRules.evaluationSeconds,
          ),
          buyerResponseDeadline: plusSeconds(
            plusSeconds(
              createdAt,
              Math.min(job.timeoutRules.deliverySeconds, bid.executionSeconds),
            ),
            job.timeoutRules.buyerResponseSeconds,
          ),
          automaticSettlementAt: plusSeconds(
            createdAt,
            job.timeoutRules.automaticSettlementSeconds,
          ),
          automaticRefundAt: plusSeconds(
            createdAt,
            job.timeoutRules.automaticRefundSeconds,
          ),
          createdAt,
          updatedAt: createdAt,
        };
        reservation.contractId = contract.id;
        job.status = "awarded";
        job.updatedAt = createdAt;
        bid.status = "accepted";
        for (const other of this.bids.values()) {
          if (
            other.jobId === jobId &&
            other.id !== bidId &&
            other.status === "submitted"
          ) {
            other.status = "rejected";
          }
        }
        this.contracts.set(contract.id, contract);
        this.audit(buyerAgentId, "bid.accepted", "contract", contract.id, {
          job_id: jobId,
          bid_id: bidId,
          reservation_id: reservation.id,
        });
        this.emit("bid.accepted", "bid", bidId, {
          bid_id: bidId,
          job_id: jobId,
        });
        this.emit("contract.created", "contract", contract.id, {
          contract_id: contract.id,
          job_id: jobId,
          buyer_agent_id: buyerAgentId,
          seller_agent_id: bid.sellerAgentId,
          amount_minor: bid.amountMinor.toString(),
        });
        return clone(contract);
      }),
    );
  }

  cancelJob(actorAgentId: string, jobId: string): Job {
    const job = this.jobs.get(jobId);
    if (!job)
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "Job was not found.",
        404,
      );
    if (job.buyerAgentId !== actorAgentId) {
      throw new MarketplaceError(
        "FORBIDDEN",
        "Only the buyer may cancel the job.",
        403,
      );
    }
    if (job.status !== "open") {
      throw new MarketplaceError(
        "INVALID_STATE_TRANSITION",
        "Only open jobs may be cancelled.",
        409,
      );
    }
    job.status = "cancelled";
    job.updatedAt = nowIso();
    this.audit(actorAgentId, "job.cancelled", "job", jobId, {});
    return clone(job);
  }

  getContract(contractId: string): Contract {
    const contract = this.contracts.get(contractId);
    if (!contract) {
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "Contract was not found.",
        404,
      );
    }
    return clone(contract);
  }

  acceptContract(sellerAgentId: string, contractId: string): Contract {
    this.activeAgent(sellerAgentId);
    const contract = this.contracts.get(contractId);
    if (!contract) {
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "Contract was not found.",
        404,
      );
    }
    if (contract.sellerAgentId !== sellerAgentId) {
      throw new MarketplaceError(
        "FORBIDDEN",
        "Only the contract seller may accept the contract.",
        403,
      );
    }
    if (contract.sellerAcceptedAt) return clone(contract);
    if (contract.status !== "pending_seller_acceptance") {
      throw new MarketplaceError(
        "INVALID_STATE_TRANSITION",
        "Contract is not awaiting seller acceptance.",
        409,
      );
    }
    if (Date.parse(contract.sellerAcceptanceDeadline) <= Date.now()) {
      throw new MarketplaceError(
        "INVALID_STATE_TRANSITION",
        "Seller acceptance deadline has passed.",
        409,
      );
    }
    contract.sellerAcceptedAt = nowIso();
    contract.status = "active";
    contract.updatedAt = contract.sellerAcceptedAt;
    this.audit(
      sellerAgentId,
      "contract.seller_accepted",
      "contract",
      contractId,
      {},
    );
    this.emit("contract.seller_accepted", "contract", contractId, {
      contract_id: contractId,
      seller_agent_id: sellerAgentId,
    });
    return clone(contract);
  }

  listContracts(agentId?: string): Contract[] {
    return [...this.contracts.values()]
      .filter(
        (contract) =>
          !agentId ||
          contract.buyerAgentId === agentId ||
          contract.sellerAgentId === agentId,
      )
      .map(clone);
  }

  private accountId(
    agentId: string | null,
    code: LedgerAccountCode,
    asset: string,
  ): string {
    return `${agentId ?? "platform"}:${code}:${asset}`;
  }

  private getOrCreateAccount(
    agentId: string | null,
    code: LedgerAccountCode,
    asset: string,
  ): LedgerAccount {
    const id = this.accountId(agentId, code, asset);
    let account = this.ledgerAccounts.get(id);
    if (!account) {
      account = { id, agentId, code, asset, createdAt: nowIso() };
      this.ledgerAccounts.set(id, account);
    }
    return account;
  }

  private postLedger(
    kind: LedgerTransaction["kind"],
    referenceType: string,
    referenceId: string,
    asset: string,
    postings: LedgerPosting[],
    reversalOf: string | null = null,
  ): LedgerTransaction {
    if (postings.length < 2) {
      throw new MarketplaceError(
        "INTERNAL_ERROR",
        "Ledger transaction needs at least two entries.",
        500,
      );
    }
    const debits = postings
      .filter((posting) => posting.side === "debit")
      .reduce((sum, posting) => sum + posting.amountMinor, 0n);
    const credits = postings
      .filter((posting) => posting.side === "credit")
      .reduce((sum, posting) => sum + posting.amountMinor, 0n);
    if (
      debits <= 0n ||
      debits !== credits ||
      postings.some((posting) => posting.amountMinor <= 0n)
    ) {
      throw new MarketplaceError(
        "INTERNAL_ERROR",
        "Ledger transaction is not balanced.",
        500,
        {
          debits_minor: debits.toString(),
          credits_minor: credits.toString(),
        },
      );
    }
    for (const posting of postings) {
      const account = this.ledgerAccounts.get(posting.accountId);
      if (!account || account.asset !== asset) {
        throw new MarketplaceError(
          "INTERNAL_ERROR",
          "Ledger account is invalid.",
          500,
        );
      }
    }
    const transactionId = uuid();
    const createdAt = nowIso();
    const entries = postings.map<LedgerEntry>((posting) => ({
      id: uuid(),
      transactionId,
      accountId: posting.accountId,
      side: posting.side,
      amountMinor: posting.amountMinor,
      createdAt,
    }));
    const transaction: LedgerTransaction = {
      id: transactionId,
      kind,
      referenceType,
      referenceId,
      asset,
      entryIds: entries.map((entry) => entry.id),
      reversalOf,
      createdAt,
    };
    this.ledgerEntries.push(...entries);
    this.ledgerTransactions.push(transaction);
    return transaction;
  }

  private accountBalance(accountId: string): bigint {
    return this.ledgerEntries
      .filter((entry) => entry.accountId === accountId)
      .reduce(
        (sum, entry) =>
          sum +
          (entry.side === "credit" ? entry.amountMinor : -entry.amountMinor),
        0n,
      );
  }

  private isEligibleLot(
    lot: Pick<CapitalLot, "originType" | "provenanceScope">,
  ): boolean {
    if (lot.provenanceScope === "simulation" && !this.config.simulationMode) {
      return false;
    }
    return (
      ELIGIBLE_REAL_ORIGINS.has(lot.originType) ||
      (lot.originType === "platform_test_funds" &&
        lot.provenanceScope === "simulation" &&
        this.config.simulationMode)
    );
  }

  importCapital(input: {
    agentId: string;
    amountMinor: string | number | bigint;
    asset?: string;
    originType: CapitalOrigin;
    sourceTransactionHash?: string | null;
    earningAttestationId?: string | null;
    parentCapitalLotIds?: string[];
    earnedAt?: string;
    provenanceScope?: "simulation" | "real";
  }): CapitalLot {
    this.activeAgent(input.agentId);
    const amount = parseMinor(input.amountMinor);
    if (amount <= 0n)
      throw new MarketplaceError(
        "VALIDATION_ERROR",
        "Capital amount must be positive.",
      );
    if (
      input.originType === "verified_external_agent_earned" &&
      !input.earningAttestationId
    ) {
      throw new MarketplaceError(
        "PROVENANCE_INVALID",
        "Verified external capital requires a verified earning attestation.",
      );
    }
    if (
      input.originType === "platform_test_funds" &&
      !this.config.simulationMode
    ) {
      throw new MarketplaceError(
        "PROVENANCE_INVALID",
        "Platform test funds are disabled outside simulation mode.",
      );
    }
    const parents = [...new Set(input.parentCapitalLotIds ?? [])];
    let parentIsSimulationScoped = false;
    for (const parentId of parents) {
      const parent = this.capitalLots.get(parentId);
      if (!parent) {
        throw new MarketplaceError(
          "PROVENANCE_INVALID",
          "Parent capital lot does not exist.",
        );
      }
      parentIsSimulationScoped ||= parent.provenanceScope === "simulation";
      if (this.hasAncestor(parentId, parentId, new Set())) {
        throw new MarketplaceError(
          "PROVENANCE_CIRCULAR",
          "Circular capital lineage was detected.",
        );
      }
    }
    const provenanceScope =
      input.originType === "platform_test_funds" ||
      parentIsSimulationScoped ||
      this.config.simulationMode
        ? "simulation"
        : (input.provenanceScope ?? "real");
    if (
      input.provenanceScope === "real" &&
      (this.config.simulationMode ||
        input.originType === "platform_test_funds" ||
        parentIsSimulationScoped)
    ) {
      throw new MarketplaceError(
        "PROVENANCE_INVALID",
        "Simulation-tainted capital cannot be promoted to real provenance.",
        422,
      );
    }
    const createdAt = nowIso();
    const lot: CapitalLot = {
      id: uuid(),
      agentId: input.agentId,
      asset: input.asset ?? DEFAULT_ASSET,
      amountMinor: amount,
      availableMinor: amount,
      reservedMinor: 0n,
      originType: input.originType,
      provenanceScope,
      sourceJobId: null,
      sourceSettlementId: null,
      sourceTransactionHash: input.sourceTransactionHash ?? null,
      earningAttestationId: input.earningAttestationId ?? null,
      parentCapitalLotIds: parents,
      status: "verified",
      earnedAt: input.earnedAt ?? createdAt,
      createdAt,
    };
    this.capitalLots.set(lot.id, lot);
    const accountCode: LedgerAccountCode = this.isEligibleLot(lot)
      ? "eligible_available"
      : "ineligible_available";
    const funding = this.getOrCreateAccount(
      null,
      "platform_funding",
      lot.asset,
    );
    const destination = this.getOrCreateAccount(
      lot.agentId,
      accountCode,
      lot.asset,
    );
    const ledger = this.postLedger(
      "capital_import",
      "capital_lot",
      lot.id,
      lot.asset,
      [
        { accountId: funding.id, side: "debit", amountMinor: amount },
        { accountId: destination.id, side: "credit", amountMinor: amount },
      ],
    );
    this.audit(null, "capital.imported", "capital_lot", lot.id, {
      origin_type: lot.originType,
      amount_minor: amount.toString(),
      ledger_transaction_id: ledger.id,
    });
    this.emit("capital_lot.created", "capital_lot", lot.id, {
      capital_lot_id: lot.id,
      agent_id: lot.agentId,
      origin_type: lot.originType,
      amount_minor: amount.toString(),
      simulation_only: lot.provenanceScope === "simulation",
    });
    return clone(lot);
  }

  private hasAncestor(
    currentId: string,
    targetId: string,
    visited: Set<string>,
  ): boolean {
    if (visited.has(currentId)) return true;
    visited.add(currentId);
    const current = this.capitalLots.get(currentId);
    if (!current) return false;
    for (const parentId of current.parentCapitalLotIds) {
      if (
        parentId === targetId ||
        this.hasAncestor(parentId, targetId, new Set(visited))
      ) {
        return true;
      }
    }
    return false;
  }

  private reserveCapitalUnlocked(
    agentId: string,
    jobId: string,
    amountMinor: bigint,
    asset: string,
  ): CapitalReservation {
    const eligible = [...this.capitalLots.values()]
      .filter(
        (lot) =>
          lot.agentId === agentId &&
          lot.asset === asset &&
          lot.status === "verified" &&
          this.isEligibleLot(lot) &&
          lot.availableMinor > 0n,
      )
      .sort(
        (left, right) =>
          Date.parse(left.earnedAt) - Date.parse(right.earnedAt) ||
          left.id.localeCompare(right.id),
      );
    const totalEligible = eligible.reduce(
      (sum, lot) => sum + lot.availableMinor,
      0n,
    );
    const ineligible = [...this.capitalLots.values()]
      .filter(
        (lot) =>
          lot.agentId === agentId &&
          lot.asset === asset &&
          !this.isEligibleLot(lot),
      )
      .reduce((sum, lot) => sum + lot.availableMinor, 0n);
    if (totalEligible < amountMinor) {
      throw new MarketplaceError(
        "INSUFFICIENT_ELIGIBLE_CAPITAL",
        "Wallet balance exists, but eligible agent-earned capital is insufficient.",
        402,
        {
          required_minor: amountMinor.toString(),
          eligible_minor: totalEligible.toString(),
          ineligible_minor: ineligible.toString(),
          platform_test_funds_eligible: this.config.simulationMode,
        },
      );
    }
    let remaining = amountMinor;
    const allocations: CapitalAllocation[] = [];
    for (const lot of eligible) {
      if (remaining === 0n) break;
      const selected =
        remaining < lot.availableMinor ? remaining : lot.availableMinor;
      lot.availableMinor -= selected;
      lot.reservedMinor += selected;
      allocations.push({ capitalLotId: lot.id, amountMinor: selected });
      remaining -= selected;
    }
    const reservation: CapitalReservation = {
      id: uuid(),
      agentId,
      jobId,
      contractId: null,
      amountMinor,
      asset,
      allocations,
      status: "active",
      createdAt: nowIso(),
      resolvedAt: null,
    };
    this.reservations.set(reservation.id, reservation);
    const available = this.getOrCreateAccount(
      agentId,
      "eligible_available",
      asset,
    );
    const reserved = this.getOrCreateAccount(
      agentId,
      "eligible_reserved",
      asset,
    );
    const ledger = this.postLedger(
      "reservation",
      "capital_reservation",
      reservation.id,
      asset,
      [
        { accountId: available.id, side: "debit", amountMinor },
        { accountId: reserved.id, side: "credit", amountMinor },
      ],
    );
    this.audit(
      agentId,
      "capital.reserved",
      "capital_reservation",
      reservation.id,
      {
        job_id: jobId,
        allocations: allocations.map((item) => ({
          capital_lot_id: item.capitalLotId,
          amount_minor: item.amountMinor.toString(),
        })),
        ledger_transaction_id: ledger.id,
      },
    );
    this.emit("capital.reserved", "capital_reservation", reservation.id, {
      reservation_id: reservation.id,
      agent_id: agentId,
      amount_minor: amountMinor.toString(),
      capital_lot_ids: allocations.map((allocation) => allocation.capitalLotId),
    });
    return clone(reservation);
  }

  getBalance(agentId: string, asset: string = DEFAULT_ASSET): BalanceView {
    this.requiredAgent(agentId);
    const balance = (code: LedgerAccountCode): bigint =>
      this.accountBalance(this.accountId(agentId, code, asset));
    const origins: CapitalOrigin[] = [
      "marketplace_earned",
      "verified_external_agent_earned",
      "human_seeded",
      "unknown",
      "platform_test_funds",
    ];
    const byOrigin = Object.fromEntries(
      origins.map((origin) => {
        const lots = [...this.capitalLots.values()].filter(
          (lot) =>
            lot.agentId === agentId &&
            lot.asset === asset &&
            lot.originType === origin,
        );
        return [
          origin,
          {
            availableMinor: lots.reduce(
              (sum, lot) => sum + lot.availableMinor,
              0n,
            ),
            reservedMinor: lots.reduce(
              (sum, lot) => sum + lot.reservedMinor,
              0n,
            ),
          },
        ];
      }),
    ) as BalanceView["byOrigin"];
    return {
      agentId,
      asset,
      eligibleAvailableMinor: balance("eligible_available"),
      eligibleReservedMinor: balance("eligible_reserved"),
      ineligibleAvailableMinor: balance("ineligible_available"),
      pendingSettlementMinor: balance("pending_settlement"),
      disputedMinor: balance("disputed"),
      byOrigin,
    };
  }

  getCapitalLots(agentId: string): CapitalLot[] {
    this.requiredAgent(agentId);
    return [...this.capitalLots.values()]
      .filter((lot) => lot.agentId === agentId)
      .map(clone);
  }

  getLedger(agentId: string): {
    accounts: LedgerAccount[];
    transactions: LedgerTransaction[];
    entries: LedgerEntry[];
    balanced: boolean;
  } {
    this.requiredAgent(agentId);
    const accounts = [...this.ledgerAccounts.values()].filter(
      (account) => account.agentId === agentId,
    );
    const accountIds = new Set(accounts.map((account) => account.id));
    const entries = this.ledgerEntries.filter((entry) =>
      accountIds.has(entry.accountId),
    );
    const transactionIds = new Set(entries.map((entry) => entry.transactionId));
    const transactions = this.ledgerTransactions.filter((transaction) =>
      transactionIds.has(transaction.id),
    );
    return {
      accounts: accounts.map(clone),
      transactions: transactions.map(clone),
      entries: entries.map(clone),
      balanced: transactions.every((transaction) =>
        this.isLedgerTransactionBalanced(transaction.id),
      ),
    };
  }

  isLedgerTransactionBalanced(transactionId: string): boolean {
    const entries = this.ledgerEntries.filter(
      (entry) => entry.transactionId === transactionId,
    );
    const debits = entries
      .filter((entry) => entry.side === "debit")
      .reduce((sum, entry) => sum + entry.amountMinor, 0n);
    const credits = entries
      .filter((entry) => entry.side === "credit")
      .reduce((sum, entry) => sum + entry.amountMinor, 0n);
    return entries.length >= 2 && debits > 0n && debits === credits;
  }

  private agentSpendSince(agentId: string, sinceEpochMs: number): bigint {
    const settled = [...this.settlements.values()]
      .filter((settlement) => {
        const contract = this.contracts.get(settlement.contractId);
        return (
          contract?.buyerAgentId === agentId &&
          Date.parse(settlement.createdAt) >= sinceEpochMs &&
          settlement.status === "completed"
        );
      })
      .reduce((sum, settlement) => sum + settlement.grossMinor, 0n);
    const reserved = [...this.reservations.values()]
      .filter(
        (reservation) =>
          reservation.agentId === agentId &&
          reservation.status === "active" &&
          Date.parse(reservation.createdAt) >= sinceEpochMs,
      )
      .reduce((sum, reservation) => sum + reservation.amountMinor, 0n);
    return settled + reserved;
  }

  async storeArtifact(
    agentId: string,
    input: ArtifactUploadInput,
  ): Promise<StoredArtifact> {
    this.activeAgent(agentId);
    if (!this.artifactStorage) {
      throw new MarketplaceError(
        "INVALID_STATE_TRANSITION",
        "Artifact storage is not configured.",
        503,
        {},
        true,
      );
    }
    if ((input.data_base64 === undefined) === (input.data_utf8 === undefined)) {
      throw new MarketplaceError(
        "VALIDATION_ERROR",
        "Exactly one of data_base64 or data_utf8 is required.",
      );
    }
    let data: Uint8Array | string;
    if (input.data_base64 !== undefined) {
      if (
        input.data_base64.length === 0 ||
        input.data_base64.length % 4 !== 0 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          input.data_base64,
        )
      ) {
        throw new MarketplaceError(
          "VALIDATION_ERROR",
          "data_base64 must be canonical Base64.",
        );
      }
      data = Buffer.from(input.data_base64, "base64");
    } else {
      data = input.data_utf8 as string;
    }
    try {
      const stored = await this.artifactStorage.put({
        key: input.key,
        data,
        mimeType: input.mime_type,
        ...(input.expected_sha256
          ? { expectedSha256: input.expected_sha256 }
          : {}),
        metadata: {
          ...(input.metadata ?? {}),
          uploader_agent_id: agentId,
        },
      });
      this.audit(agentId, "artifact.stored", "artifact_object", stored.sha256, {
        key: stored.key,
        uri: stored.uri,
        sha256: stored.sha256,
        size_bytes: stored.sizeBytes,
        mime_type: stored.mimeType,
      });
      return stored;
    } catch (error) {
      if (error instanceof ArtifactStorageError) {
        const code =
          error.code === "ARTIFACT_TOO_LARGE"
            ? "ARTIFACT_TOO_LARGE"
            : error.code === "ARTIFACT_HASH_MISMATCH"
              ? "ARTIFACT_HASH_MISMATCH"
              : error.code === "ARTIFACT_ALREADY_EXISTS"
                ? "CONFLICT"
                : "VALIDATION_ERROR";
        throw new MarketplaceError(code, error.message, 422, error.details);
      }
      throw error;
    }
  }

  async submitDelivery(
    sellerAgentId: string,
    contractId: string,
    manifest: SignedDeliveryManifest,
  ): Promise<Delivery> {
    const seller = this.activeAgent(sellerAgentId);
    const contract = this.contracts.get(contractId);
    if (!contract) {
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "Contract was not found.",
        404,
      );
    }
    if (contract.sellerAgentId !== sellerAgentId) {
      throw new MarketplaceError(
        "FORBIDDEN",
        "Only the contract seller may deliver.",
        403,
      );
    }
    if (contract.frozen || contract.status === "frozen") {
      throw new MarketplaceError("FORBIDDEN", "Contract is frozen.", 423);
    }
    if (contract.status !== "active") {
      throw new MarketplaceError(
        "INVALID_STATE_TRANSITION",
        "Contract is not accepting a delivery.",
        409,
      );
    }
    if (
      manifest.contract_id !== contractId ||
      manifest.seller_agent_id !== sellerAgentId
    ) {
      throw new MarketplaceError(
        "VALIDATION_ERROR",
        "Delivery manifest identities do not match.",
      );
    }
    const receivedAt = nowIso();
    if (
      !Number.isFinite(Date.parse(manifest.completed_at)) ||
      Date.parse(manifest.completed_at) > Date.now() + 60_000 ||
      Date.parse(manifest.completed_at) < Date.parse(contract.createdAt)
    ) {
      throw new MarketplaceError(
        "VALIDATION_ERROR",
        "completed_at is invalid.",
      );
    }
    if (
      Date.parse(receivedAt) > Date.parse(contract.deliveryDeadline) ||
      Date.parse(manifest.completed_at) > Date.parse(contract.deliveryDeadline)
    ) {
      throw new MarketplaceError(
        "INVALID_STATE_TRANSITION",
        "Delivery missed the contract deadline.",
        409,
      );
    }
    if (manifest.artifact_uris.length !== manifest.artifact_hashes.length) {
      throw new MarketplaceError(
        "VALIDATION_ERROR",
        "artifact_uris and artifact_hashes must have equal lengths.",
      );
    }
    if (
      manifest.artifact_mime_types &&
      manifest.artifact_mime_types.length !== manifest.artifact_uris.length
    ) {
      throw new MarketplaceError(
        "VALIDATION_ERROR",
        "Artifact MIME metadata is incomplete.",
      );
    }
    if (
      manifest.artifact_sizes &&
      manifest.artifact_sizes.length !== manifest.artifact_uris.length
    ) {
      throw new MarketplaceError(
        "VALIDATION_ERROR",
        "Artifact size metadata is incomplete.",
      );
    }
    const unsigned = { ...manifest };
    delete (unsigned as Partial<SignedDeliveryManifest>).signature;
    const signatureValid = await verifyMessage({
      address: seller.signingKey,
      message: deliveryManifestMessage(
        unsigned as Omit<SignedDeliveryManifest, "signature">,
      ),
      signature: manifest.signature,
    }).catch(() => false);
    if (!signatureValid) {
      throw new MarketplaceError(
        "SIGNATURE_INVALID",
        "Delivery signature is invalid.",
        401,
      );
    }
    const resultHash = sha256(canonicalJson(manifest.result));
    if (
      manifest.artifact_hashes.length === 0 ||
      !manifest.artifact_hashes.some(
        (hash) => hash.toLowerCase() === resultHash,
      )
    ) {
      throw new MarketplaceError(
        "ARTIFACT_HASH_MISMATCH",
        "At least one artifact hash must match the canonical result.",
        422,
        { canonical_result_sha256: resultHash },
      );
    }
    const artifactRows: Artifact[] = [];
    for (const [index, uri] of manifest.artifact_uris.entries()) {
      const mimeType =
        manifest.artifact_mime_types?.[index] ?? "application/json";
      const declaredSize = manifest.artifact_sizes?.[index];
      if (!contract.artifactMimeTypes.includes(mimeType)) {
        throw new MarketplaceError(
          "SCHEMA_VALIDATION_FAILED",
          "Artifact MIME type is not allowed by the contract.",
          422,
          { mime_type: mimeType, allowed: contract.artifactMimeTypes },
        );
      }
      if (
        declaredSize !== undefined &&
        (declaredSize < 0 ||
          !Number.isSafeInteger(declaredSize) ||
          declaredSize > contract.maximumArtifactBytes)
      ) {
        throw new MarketplaceError(
          "ARTIFACT_TOO_LARGE",
          "Artifact exceeds the contract size limit.",
          413,
          {
            maximum_bytes: contract.maximumArtifactBytes,
            actual_bytes: declaredSize,
          },
        );
      }
      const hash = manifest.artifact_hashes[index];
      if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
        throw new MarketplaceError(
          "VALIDATION_ERROR",
          "Artifact hash must be SHA-256 hex.",
        );
      }
      let verified: StoredArtifact | null = null;
      if (this.artifactStorage) {
        try {
          // Fetch and hash the immutable bytes. Object metadata alone is
          // insufficient because storage corruption/tampering must fail the
          // delivery even when a stale sidecar or HEAD response still
          // advertises the original digest.
          verified = await this.artifactStorage.getByUri(uri);
        } catch (error) {
          if (
            !this.config.simulationMode ||
            !(error instanceof ArtifactStorageError)
          ) {
            throw new MarketplaceError(
              "ARTIFACT_HASH_MISMATCH",
              error instanceof Error
                ? error.message
                : "Artifact URI could not be verified.",
              422,
            );
          }
        }
      }
      const canonicalResultBytes = Buffer.from(
        canonicalJson(manifest.result),
        "utf8",
      );
      if (
        !verified &&
        this.artifactStorage &&
        hash.toLowerCase() === resultHash
      ) {
        if (!this.config.simulationMode) {
          throw new MarketplaceError(
            "ARTIFACT_HASH_MISMATCH",
            "Every production artifact URI must reference bytes already stored by the marketplace.",
            422,
            { uri },
          );
        }
        verified = await this.artifactStorage.put({
          key: `simulation/${contract.id}/${hash.toLowerCase()}.json`,
          data: canonicalResultBytes,
          mimeType,
          expectedSha256: hash,
          metadata: { contract_id: contract.id },
        });
      }
      if (!verified) {
        if (!this.config.simulationMode || hash.toLowerCase() !== resultHash) {
          throw new MarketplaceError(
            "ARTIFACT_HASH_MISMATCH",
            "Artifact bytes are unavailable for verification.",
            422,
            { uri },
          );
        }
        verified = {
          key: `inline/${contract.id}/${hash.toLowerCase()}`,
          uri,
          sha256: resultHash,
          sizeBytes: canonicalResultBytes.byteLength,
          mimeType,
          createdAt: receivedAt,
          metadata: { simulation_inline: true },
        };
      }
      if (
        verified.sha256.toLowerCase() !== hash.toLowerCase() ||
        verified.mimeType !== mimeType ||
        (declaredSize !== undefined && verified.sizeBytes !== declaredSize)
      ) {
        throw new MarketplaceError(
          "ARTIFACT_HASH_MISMATCH",
          "Stored artifact bytes do not match the signed manifest metadata.",
          422,
          {
            uri,
            expected_sha256: hash.toLowerCase(),
            actual_sha256: verified.sha256,
            expected_mime_type: mimeType,
            actual_mime_type: verified.mimeType,
            expected_size_bytes: declaredSize ?? null,
            actual_size_bytes: verified.sizeBytes,
          },
        );
      }
      if (verified.sizeBytes > contract.maximumArtifactBytes) {
        throw new MarketplaceError(
          "ARTIFACT_TOO_LARGE",
          "Verified artifact exceeds the contract size limit.",
          413,
          {
            maximum_bytes: contract.maximumArtifactBytes,
            actual_bytes: verified.sizeBytes,
          },
        );
      }
      artifactRows.push({
        id: uuid(),
        deliveryId: "",
        uri: verified.uri,
        sha256: verified.sha256,
        mimeType: verified.mimeType,
        sizeBytes: verified.sizeBytes,
        createdAt: verified.createdAt,
      });
    }
    const delivery: Delivery = {
      id: uuid(),
      contractId,
      sellerAgentId,
      manifest: clone(manifest),
      manifestHash: sha256(canonicalJson(unsigned)),
      status: "submitted",
      createdAt: receivedAt,
    };
    for (const artifact of artifactRows) {
      artifact.deliveryId = delivery.id;
      this.artifacts.set(artifact.id, artifact);
    }
    this.deliveries.set(delivery.id, delivery);
    contract.status = "delivered";
    contract.updatedAt = nowIso();
    this.audit(sellerAgentId, "delivery.submitted", "delivery", delivery.id, {
      contract_id: contractId,
      manifest_hash: delivery.manifestHash,
      artifact_ids: artifactRows.map((artifact) => artifact.id),
    });
    this.emit("delivery.submitted", "delivery", delivery.id, {
      delivery_id: delivery.id,
      contract_id: contractId,
      manifest_hash: delivery.manifestHash,
    });
    return clone(delivery);
  }

  getDeliveryForContract(contractId: string): Delivery | null {
    const delivery = [...this.deliveries.values()].find(
      (candidate) => candidate.contractId === contractId,
    );
    return delivery ? clone(delivery) : null;
  }

  evaluateDelivery(actorAgentId: string, contractId: string): Evaluation {
    const contract = this.contracts.get(contractId);
    if (!contract) {
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "Contract was not found.",
        404,
      );
    }
    if (
      ![contract.buyerAgentId, contract.sellerAgentId].includes(actorAgentId)
    ) {
      throw new MarketplaceError(
        "FORBIDDEN",
        "Only a contract party may request evaluation.",
        403,
      );
    }
    if (contract.status !== "delivered") {
      throw new MarketplaceError(
        "INVALID_STATE_TRANSITION",
        "Contract has no submitted delivery to evaluate.",
        409,
      );
    }
    const delivery = [...this.deliveries.values()].find(
      (candidate) => candidate.contractId === contractId,
    );
    if (!delivery) {
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "Delivery was not found.",
        404,
      );
    }
    const existing = [...this.evaluations.values()].find(
      (evaluation) => evaluation.deliveryId === delivery.id,
    );
    if (existing) return clone(existing);
    const checks: EvaluationCheck[] = [];
    const ajv = new Ajv({ allErrors: true, strict: false });
    let schemaPassed = false;
    try {
      const validate = ajv.compile(contract.outputSchema);
      schemaPassed = Boolean(validate(delivery.manifest.result));
      checks.push({
        name: "json_schema",
        passed: schemaPassed,
        details: {
          errors: asJson(validate.errors ?? []),
        },
      });
    } catch (error) {
      checks.push({
        name: "json_schema",
        passed: false,
        details: {
          errors: [
            {
              message:
                error instanceof Error ? error.message : "Invalid schema",
            },
          ],
        },
      });
    }
    for (const rule of contract.acceptanceRules) {
      const passed = evaluateRule(delivery.manifest.result, rule);
      checks.push({
        name: `acceptance_rule:${rule.path}:${rule.operator}`,
        passed,
        details: {
          path: rule.path,
          operator: rule.operator,
          expected: rule.value ?? null,
          actual: getPath(delivery.manifest.result, rule.path) ?? null,
        },
      });
    }
    const artifacts = [...this.artifacts.values()].filter(
      (artifact) => artifact.deliveryId === delivery.id,
    );
    checks.push({
      name: "artifact_presence",
      passed: artifacts.length > 0,
      details: { artifact_count: artifacts.length },
    });
    checks.push({
      name: "artifact_hash",
      passed: artifacts.some(
        (artifact) =>
          artifact.sha256 === sha256(canonicalJson(delivery.manifest.result)),
      ),
      details: {},
    });
    checks.push({
      name: "deadline",
      passed:
        Date.parse(delivery.manifest.completed_at) <=
        Date.parse(contract.deliveryDeadline),
      details: {
        completed_at: delivery.manifest.completed_at,
        deadline: contract.deliveryDeadline,
      },
    });
    const accepted = checks.every((check) => check.passed);
    const evaluation: Evaluation = {
      id: uuid(),
      contractId,
      deliveryId: delivery.id,
      evaluator:
        contract.acceptanceRules.length > 0 ? "deterministic_rules" : "schema",
      result: accepted ? "accepted" : "rejected",
      checks,
      createdAt: nowIso(),
    };
    this.evaluations.set(evaluation.id, evaluation);
    this.reputationEvents.push(
      createReputationEvent({
        agentId: contract.sellerAgentId,
        counterpartyAgentId: contract.buyerAgentId,
        contractId,
        type: schemaPassed ? "schema_compliant" : "schema_noncompliant",
        amountMinor: null,
        durationMs: null,
        metadata: { evaluation_id: evaluation.id },
      }),
    );
    this.audit(
      actorAgentId,
      "delivery.evaluated",
      "evaluation",
      evaluation.id,
      evaluation,
    );
    return clone(evaluation);
  }

  async evaluateDeliveryWithAdapters(
    actorAgentId: string,
    contractId: string,
  ): Promise<Evaluation> {
    const base = this.evaluateDelivery(actorAgentId, contractId);
    if (this.evaluators.length === 0) return base;
    const contract = this.contracts.get(contractId);
    const delivery = this.getDeliveryForContract(contractId);
    if (!contract || !delivery) {
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "Contract delivery was not found.",
        404,
      );
    }
    const artifacts = [...this.artifacts.values()].filter(
      (artifact) => artifact.deliveryId === delivery.id,
    );
    const input: AdapterEvaluationInput = {
      delivery: {
        contractId,
        sellerAgentId: delivery.sellerAgentId,
        artifactUris: artifacts.map((artifact) => artifact.uri),
        artifactHashes: artifacts.map((artifact) => artifact.sha256),
        outputSchema: delivery.manifest.output_schema,
        result: delivery.manifest.result,
        completedAt: delivery.manifest.completed_at,
        signature: delivery.manifest.signature,
      },
      requirements: {
        outputJsonSchema: contract.outputSchema,
        allowedMimeTypes: contract.artifactMimeTypes,
        maxArtifactBytes: contract.maximumArtifactBytes,
        deliveryDeadline: contract.deliveryDeadline,
        requireSignatureVerified: true,
      },
      artifacts: artifacts.map((artifact) => ({
        uri: artifact.uri,
        present: true,
        sha256: artifact.sha256,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
      })),
      signatureVerified: true,
      evaluatedAt: nowIso(),
      metadata: {
        marketplace_contract_id: contractId,
      },
    };
    const adapterResults: Array<{
      adapter: EvaluatorAdapter;
      result: AdapterEvaluationResult;
    }> = [];
    for (const adapter of this.evaluators) {
      adapterResults.push({
        adapter,
        result: await adapter.evaluate(input),
      });
    }
    const stored = this.evaluations.get(base.id);
    if (!stored) return base;
    for (const { adapter, result } of adapterResults) {
      stored.checks.push({
        name: `evaluator_adapter:${adapter.name}`,
        passed: result.accepted,
        details: {
          deterministic: result.deterministic,
          findings: asJson(result.findings),
          metrics: result.metrics,
        },
      });
    }
    stored.result = stored.checks.every((check) => check.passed)
      ? "accepted"
      : "rejected";
    this.audit(
      actorAgentId,
      "delivery.adapter_evaluated",
      "evaluation",
      stored.id,
      {
        adapters: adapterResults.map(({ adapter, result }) => ({
          name: adapter.name,
          deterministic: adapter.deterministic,
          accepted: result.accepted,
        })),
      },
    );
    return clone(stored);
  }

  acceptDelivery(buyerAgentId: string, contractId: string): Contract {
    const contract = this.contracts.get(contractId);
    if (!contract) {
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "Contract was not found.",
        404,
      );
    }
    if (contract.buyerAgentId !== buyerAgentId) {
      throw new MarketplaceError(
        "FORBIDDEN",
        "Only the buyer may accept delivery.",
        403,
      );
    }
    if (contract.status !== "delivered") {
      throw new MarketplaceError(
        "INVALID_STATE_TRANSITION",
        "Contract is not delivered.",
        409,
      );
    }
    const delivery = [...this.deliveries.values()].find(
      (candidate) => candidate.contractId === contractId,
    );
    const evaluation = delivery
      ? [...this.evaluations.values()].find(
          (candidate) => candidate.deliveryId === delivery.id,
        )
      : null;
    if (!evaluation || evaluation.result !== "accepted") {
      throw new MarketplaceError(
        "SCHEMA_VALIDATION_FAILED",
        "A passing deterministic evaluation is required before acceptance.",
        422,
      );
    }
    contract.status = "accepted";
    contract.updatedAt = nowIso();
    if (delivery) delivery.status = "accepted";
    this.audit(buyerAgentId, "delivery.accepted", "contract", contractId, {
      evaluation_id: evaluation.id,
    });
    this.emit("delivery.accepted", "contract", contractId, {
      contract_id: contractId,
      evaluation_id: evaluation.id,
    });
    return clone(contract);
  }

  rejectDelivery(
    buyerAgentId: string,
    contractId: string,
    reason: JsonValue,
  ): Contract {
    const contract = this.contracts.get(contractId);
    if (!contract) {
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "Contract was not found.",
        404,
      );
    }
    if (contract.buyerAgentId !== buyerAgentId) {
      throw new MarketplaceError(
        "FORBIDDEN",
        "Only the buyer may reject delivery.",
        403,
      );
    }
    if (contract.status !== "delivered") {
      throw new MarketplaceError(
        "INVALID_STATE_TRANSITION",
        "Contract is not delivered.",
        409,
      );
    }
    const delivery = [...this.deliveries.values()].find(
      (candidate) => candidate.contractId === contractId,
    );
    const evaluation = delivery
      ? [...this.evaluations.values()].find(
          (candidate) => candidate.deliveryId === delivery.id,
        )
      : null;
    if (evaluation?.result === "accepted") {
      throw new MarketplaceError(
        "INVALID_STATE_TRANSITION",
        "A passing deterministic delivery must be accepted or disputed with evidence.",
        409,
      );
    }
    contract.status = "rejected";
    contract.updatedAt = nowIso();
    if (delivery) delivery.status = "rejected";
    this.reputationEvents.push(
      createReputationEvent({
        agentId: contract.sellerAgentId,
        counterpartyAgentId: contract.buyerAgentId,
        contractId,
        type: "contract_failed",
        amountMinor: contract.amountMinor,
        durationMs: null,
        metadata: { reason },
      }),
    );
    this.audit(buyerAgentId, "delivery.rejected", "contract", contractId, {
      reason,
    });
    this.emit("delivery.rejected", "contract", contractId, {
      contract_id: contractId,
      reason,
    });
    return clone(contract);
  }

  disputeContract(
    actorAgentId: string,
    contractId: string,
    reasonCode: string,
    evidence: JsonValue,
  ): Dispute {
    const contract = this.contracts.get(contractId);
    if (!contract) {
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "Contract was not found.",
        404,
      );
    }
    if (
      ![contract.buyerAgentId, contract.sellerAgentId].includes(actorAgentId)
    ) {
      throw new MarketplaceError(
        "FORBIDDEN",
        "Only a contract party may open a dispute.",
        403,
      );
    }
    if (!["delivered", "accepted", "rejected"].includes(contract.status)) {
      throw new MarketplaceError(
        "INVALID_STATE_TRANSITION",
        "Contract cannot be disputed now.",
        409,
      );
    }
    const reservation = this.reservations.get(contract.reservationId);
    if (!reservation || reservation.status !== "active") {
      throw new MarketplaceError(
        "INVALID_STATE_TRANSITION",
        "Contract funds are not reserved.",
        409,
      );
    }
    const reserved = this.getOrCreateAccount(
      contract.buyerAgentId,
      "eligible_reserved",
      contract.asset,
    );
    const disputed = this.getOrCreateAccount(
      contract.buyerAgentId,
      "disputed",
      contract.asset,
    );
    this.postLedger("dispute", "contract", contract.id, contract.asset, [
      {
        accountId: reserved.id,
        side: "debit",
        amountMinor: contract.amountMinor,
      },
      {
        accountId: disputed.id,
        side: "credit",
        amountMinor: contract.amountMinor,
      },
    ]);
    const dispute: Dispute = {
      id: uuid(),
      contractId,
      openedByAgentId: actorAgentId,
      reasonCode,
      evidence,
      status: "open",
      createdAt: nowIso(),
      resolvedAt: null,
    };
    this.disputes.set(dispute.id, dispute);
    contract.status = "disputed";
    contract.updatedAt = nowIso();
    const delivery = [...this.deliveries.values()].find(
      (candidate) => candidate.contractId === contractId,
    );
    if (delivery) delivery.status = "disputed";
    this.reputationEvents.push(
      createReputationEvent({
        agentId: contract.sellerAgentId,
        counterpartyAgentId: contract.buyerAgentId,
        contractId,
        type: "dispute",
        amountMinor: contract.amountMinor,
        durationMs: null,
        metadata: { dispute_id: dispute.id, reason_code: reasonCode },
      }),
    );
    this.audit(
      actorAgentId,
      "contract.disputed",
      "dispute",
      dispute.id,
      dispute,
    );
    this.emit("contract.disputed", "dispute", dispute.id, {
      dispute_id: dispute.id,
      contract_id: contractId,
      reason_code: reasonCode,
    });
    return clone(dispute);
  }

  async settleContract(
    actorAgentId: string,
    contractId: string,
    paymentPayload?: unknown,
  ): Promise<Settlement> {
    return this.withLock(`contract:${contractId}`, async () => {
      const contract = this.contracts.get(contractId);
      if (!contract) {
        throw new MarketplaceError(
          "RESOURCE_NOT_FOUND",
          "Contract was not found.",
          404,
        );
      }
      if (
        ![contract.buyerAgentId, contract.sellerAgentId].includes(actorAgentId)
      ) {
        throw new MarketplaceError(
          "FORBIDDEN",
          "Only a contract party may request settlement.",
          403,
        );
      }
      if (contract.frozen || contract.status === "frozen") {
        throw new MarketplaceError("FORBIDDEN", "Contract is frozen.", 423);
      }
      const existing = [...this.settlements.values()].find(
        (settlement) =>
          settlement.contractId === contractId &&
          settlement.status === "completed",
      );
      if (existing) return clone(existing);
      if (!["accepted", "disputed"].includes(contract.status)) {
        throw new MarketplaceError(
          "INVALID_STATE_TRANSITION",
          "Contract must be accepted before settlement.",
          409,
        );
      }
      if (contract.status === "disputed") {
        const dispute = [...this.disputes.values()].find(
          (candidate) =>
            candidate.contractId === contractId && candidate.status === "open",
        );
        if (dispute) {
          throw new MarketplaceError(
            "INVALID_STATE_TRANSITION",
            "An open dispute must be resolved before settlement.",
            409,
          );
        }
      }
      const reservation = this.reservations.get(contract.reservationId);
      if (!reservation || reservation.status !== "active") {
        throw new MarketplaceError(
          "INVALID_STATE_TRANSITION",
          "Reservation is not active.",
          409,
        );
      }
      const seller = this.activeAgent(contract.sellerAgentId);
      this.activeAgent(contract.buyerAgentId);
      const gross = contract.amountMinor;
      const fee = (gross * BigInt(contract.platformFeeBps)) / 10_000n;
      const networkCost = 0n;
      const net = gross - fee - networkCost;
      if (net <= 0n) {
        throw new MarketplaceError(
          "INTERNAL_ERROR",
          "Settlement net amount is not positive.",
          500,
        );
      }
      if (seller.earnLimitMinor !== null) {
        const earned = this.getBalance(
          seller.id,
          contract.asset,
        ).eligibleAvailableMinor;
        if (earned + net > seller.earnLimitMinor) {
          throw new MarketplaceError(
            "FORBIDDEN",
            "Seller earning limit would be exceeded.",
            403,
          );
        }
      }
      let paymentIntent = [...this.paymentIntents.values()].find(
        (intent) => intent.contractId === contractId,
      );
      if (!paymentIntent) {
        const createdAt = nowIso();
        paymentIntent = {
          id: uuid(),
          contractId,
          paymentIdentifier: `a2a402:${contractId}`,
          adapter: this.config.simulationMode
            ? "mock"
            : (this.paymentAdapter?.mode ?? "x402_testnet"),
          amountMinor: gross,
          asset: contract.asset,
          status: this.config.simulationMode ? "verified" : "required",
          transactionHash: this.config.simulationMode ? `mock:${uuid()}` : null,
          requirement: null,
          verification: null,
          createdAt,
          updatedAt: createdAt,
        };
        this.paymentIntents.set(paymentIntent.id, paymentIntent);
      }
      if (!this.config.simulationMode) {
        if (
          !this.paymentAdapter ||
          this.paymentAdapter.mode !== "x402_testnet" ||
          !this.config.platformSettlementAddress
        ) {
          throw new MarketplaceError(
            "PAYMENT_ADAPTER_UNAVAILABLE",
            "The Base Sepolia x402 payment adapter is not configured.",
            503,
            {
              payment_adapter: "x402-testnet",
              mainnet_enabled: false,
            },
            true,
          );
        }
        let requirement =
          paymentIntent.requirement as PaymentRequirement | null;
        try {
          requirement ??= await this.paymentAdapter.createPaymentRequirement({
            idempotencyKey: `requirement:${contractId}`,
            amountMinor: gross,
            asset: contract.asset,
            payTo: this.config.platformSettlementAddress,
            resource: {
              url: `${this.config.baseUrl}/v1/contracts/${contractId}/settle`,
              description: `Exact settlement for a2a402 contract ${contractId}`,
              mimeType: "application/json",
            },
            expiresAt: plusSeconds(nowIso(), 900),
            metadata: {
              contract_id: contractId,
              reservation_id: contract.reservationId,
              proof_of_earn: true,
            },
          });
          paymentIntent.requirement = asJson(requirement);
          paymentIntent.updatedAt = nowIso();
          if (paymentPayload === undefined) {
            await this.flushPersistence();
            throw new MarketplaceError(
              "PAYMENT_REQUIRED",
              "A valid x402 payment payload is required for testnet settlement.",
              402,
              {
                payment_intent_id: paymentIntent.id,
                payment_required: asJson(requirement.http.body),
                payment_required_header:
                  requirement.http.headers["PAYMENT-REQUIRED"] ?? "",
                expires_at: requirement.expiresAt,
              },
            );
          }
          const verification = await this.paymentAdapter.verifyPayment({
            paymentId: paymentIntent.paymentIdentifier,
            requirement,
            payload: paymentPayload,
          });
          paymentIntent.verification = asJson(verification);
          paymentIntent.status = verification.valid ? "verified" : "required";
          paymentIntent.updatedAt = nowIso();
          if (!verification.valid) {
            throw new MarketplaceError(
              "PAYMENT_INVALID",
              verification.reason ?? "The x402 payment payload was rejected.",
              402,
              {
                payment_intent_id: paymentIntent.id,
                verification_id: verification.id,
              },
            );
          }
          const adapterSettlement = await this.paymentAdapter.settlePayment({
            idempotencyKey: `settlement:${contractId}`,
            requirement,
            verification,
          });
          paymentIntent.transactionHash = adapterSettlement.transactionHash;
          paymentIntent.status = "settled";
          paymentIntent.updatedAt = nowIso();
        } catch (error) {
          if (error instanceof MarketplaceError) throw error;
          if (error instanceof PaymentAdapterError) {
            throw new MarketplaceError(
              error.code === "PAYMENT_REPLAYED"
                ? "PAYMENT_REPLAYED"
                : error.code === "PAYMENT_ADAPTER_UNAVAILABLE"
                  ? "PAYMENT_ADAPTER_UNAVAILABLE"
                  : "PAYMENT_INVALID",
              error.message,
              error.retryable ? 503 : 402,
              error.details,
              error.retryable,
            );
          }
          throw error;
        }
      }
      if (!paymentIntent.transactionHash) {
        throw new MarketplaceError(
          "PAYMENT_INVALID",
          "Payment settlement did not produce a transaction hash.",
          502,
        );
      }
      if (this.usedPaymentTransactions.has(paymentIntent.transactionHash)) {
        throw new MarketplaceError(
          "PAYMENT_REPLAYED",
          "Payment transaction was already used.",
          409,
        );
      }
      this.usedPaymentTransactions.add(paymentIntent.transactionHash);
      this.paymentIntents.set(paymentIntent.id, paymentIntent);
      this.emit("payment.verified", "payment_intent", paymentIntent.id, {
        payment_intent_id: paymentIntent.id,
        contract_id: contractId,
        payment_identifier: paymentIntent.paymentIdentifier,
      });

      const sourceCode: LedgerAccountCode =
        contract.status === "disputed" ? "disputed" : "eligible_reserved";
      const buyerReserved = this.getOrCreateAccount(
        contract.buyerAgentId,
        sourceCode,
        contract.asset,
      );
      if (this.accountBalance(buyerReserved.id) < gross) {
        throw new MarketplaceError(
          "INTERNAL_ERROR",
          "Reserved ledger balance is insufficient.",
          500,
        );
      }
      const sellerAvailable = this.getOrCreateAccount(
        contract.sellerAgentId,
        "eligible_available",
        contract.asset,
      );
      const feeRevenue = this.getOrCreateAccount(
        null,
        "platform_fee_revenue",
        contract.asset,
      );
      const postings: LedgerPosting[] = [
        { accountId: buyerReserved.id, side: "debit", amountMinor: gross },
        { accountId: sellerAvailable.id, side: "credit", amountMinor: net },
      ];
      if (fee > 0n)
        postings.push({
          accountId: feeRevenue.id,
          side: "credit",
          amountMinor: fee,
        });
      if (networkCost > 0n) {
        const network = this.getOrCreateAccount(
          null,
          "network_cost",
          contract.asset,
        );
        postings.push({
          accountId: network.id,
          side: "credit",
          amountMinor: networkCost,
        });
      }
      const settlementId = uuid();
      const receiptId = uuid();
      const ledger = this.postLedger(
        "settlement",
        "settlement",
        settlementId,
        contract.asset,
        postings,
      );
      for (const allocation of reservation.allocations) {
        const lot = this.capitalLots.get(allocation.capitalLotId);
        if (!lot || lot.reservedMinor < allocation.amountMinor) {
          throw new MarketplaceError(
            "INTERNAL_ERROR",
            "Capital allocation is inconsistent.",
            500,
          );
        }
        lot.reservedMinor -= allocation.amountMinor;
        if (lot.availableMinor === 0n && lot.reservedMinor === 0n)
          lot.status = "spent";
      }
      const createdAt = nowIso();
      const sellerLot: CapitalLot = {
        id: uuid(),
        agentId: contract.sellerAgentId,
        asset: contract.asset,
        amountMinor: net,
        availableMinor: net,
        reservedMinor: 0n,
        originType: "marketplace_earned",
        provenanceScope:
          this.config.simulationMode ||
          reservation.allocations.some(
            (allocation) =>
              this.capitalLots.get(allocation.capitalLotId)?.provenanceScope ===
              "simulation",
          )
            ? "simulation"
            : "real",
        sourceJobId: contract.jobId,
        sourceSettlementId: settlementId,
        sourceTransactionHash: paymentIntent.transactionHash,
        earningAttestationId: null,
        parentCapitalLotIds: reservation.allocations.map(
          (allocation) => allocation.capitalLotId,
        ),
        status: "verified",
        earnedAt: createdAt,
        createdAt,
      };
      this.capitalLots.set(sellerLot.id, sellerLot);
      reservation.status = "settled";
      reservation.resolvedAt = createdAt;
      const settlement: Settlement = {
        id: settlementId,
        contractId,
        reservationId: reservation.id,
        paymentIntentId: paymentIntent.id,
        grossMinor: gross,
        feeMinor: fee,
        networkCostMinor: networkCost,
        sellerNetMinor: net,
        asset: contract.asset,
        paymentTransactionHash: paymentIntent.transactionHash as string,
        sellerCapitalLotId: sellerLot.id,
        ledgerTransactionId: ledger.id,
        receiptId,
        status: "completed",
        createdAt,
      };
      this.settlements.set(settlement.id, settlement);
      paymentIntent.status = "settled";
      paymentIntent.updatedAt = createdAt;
      if (fee > 0n) {
        const platformFee: PlatformFee = {
          id: uuid(),
          settlementId: settlement.id,
          contractId,
          amountMinor: fee,
          basisPoints: contract.platformFeeBps,
          asset: contract.asset,
          ledgerTransactionId: ledger.id,
          createdAt,
        };
        this.platformFees.push(platformFee);
        this.emit("platform_fee.recorded", "platform_fee", platformFee.id, {
          platform_fee_id: platformFee.id,
          settlement_id: settlement.id,
          amount_minor: fee.toString(),
          basis_points: contract.platformFeeBps,
        });
      }
      contract.status = "settled";
      contract.updatedAt = createdAt;
      const job = this.jobs.get(contract.jobId);
      if (job) {
        job.status = "completed";
        job.updatedAt = createdAt;
      }
      const completedAt =
        this.getDeliveryForContract(contractId)?.manifest.completed_at;
      const executionMs = completedAt
        ? Date.parse(completedAt) - Date.parse(contract.createdAt)
        : null;
      this.reputationEvents.push(
        createReputationEvent({
          agentId: contract.sellerAgentId,
          counterpartyAgentId: contract.buyerAgentId,
          contractId,
          type: "contract_completed",
          amountMinor: net,
          durationMs: executionMs,
          metadata: { settlement_id: settlement.id },
        }),
        createReputationEvent({
          agentId: contract.sellerAgentId,
          counterpartyAgentId: contract.buyerAgentId,
          contractId,
          type:
            completedAt &&
            Date.parse(completedAt) <= Date.parse(contract.deliveryDeadline)
              ? "on_time"
              : "late",
          amountMinor: null,
          durationMs: executionMs,
          metadata: {},
        }),
        createReputationEvent({
          agentId: contract.buyerAgentId,
          counterpartyAgentId: contract.sellerAgentId,
          contractId,
          type: "evaluation_accurate",
          amountMinor: null,
          durationMs: null,
          metadata: {},
        }),
      );
      const receiptBase = {
        id: receiptId,
        version: "a2a402-settlement-receipt/0.1" as const,
        settlementId: settlement.id,
        contractId,
        buyerAgentId: contract.buyerAgentId,
        sellerAgentId: contract.sellerAgentId,
        grossMinor: gross,
        feeMinor: fee,
        sellerNetMinor: net,
        asset: contract.asset,
        paymentTransactionHash: settlement.paymentTransactionHash,
        provenanceLotId: sellerLot.id,
        issuedAt: createdAt,
      };
      const signed = this.signer.sign(receiptBase);
      const receipt: SignedReceipt = {
        ...receiptBase,
        keyId: signed.keyId,
        digest: signed.digest,
        signature: signed.signature,
      };
      this.receipts.set(receipt.id, receipt);
      this.detectRiskSignals(
        contract,
        deliveryHashFor(this.deliveries, contractId),
      );
      this.audit(
        actorAgentId,
        "settlement.completed",
        "settlement",
        settlement.id,
        {
          contract_id: contractId,
          gross_minor: gross.toString(),
          fee_minor: fee.toString(),
          seller_net_minor: net.toString(),
          capital_lot_id: sellerLot.id,
          parent_capital_lot_ids: sellerLot.parentCapitalLotIds,
        },
      );
      this.emit("settlement.completed", "settlement", settlement.id, {
        settlement_id: settlement.id,
        contract_id: contractId,
        gross_minor: gross.toString(),
        fee_minor: fee.toString(),
        seller_net_minor: net.toString(),
        receipt_id: receipt.id,
      });
      this.emit("capital_lot.created", "capital_lot", sellerLot.id, {
        capital_lot_id: sellerLot.id,
        agent_id: sellerLot.agentId,
        origin_type: sellerLot.originType,
        amount_minor: net.toString(),
        parent_capital_lot_ids: sellerLot.parentCapitalLotIds,
      });
      this.emit("reputation.updated", "agent", contract.sellerAgentId, {
        agent_id: contract.sellerAgentId,
        snapshot_digest: this.getReputation(contract.sellerAgentId).snapshot
          .digest,
      });
      return clone(settlement);
    });
  }

  async refundContract(
    actorAgentId: string,
    contractId: string,
    reason: string,
  ): Promise<Contract> {
    return this.withLock(`contract:${contractId}`, () => {
      const contract = this.contracts.get(contractId);
      if (!contract) {
        throw new MarketplaceError(
          "RESOURCE_NOT_FOUND",
          "Contract was not found.",
          404,
        );
      }
      if (
        actorAgentId !== contract.buyerAgentId &&
        actorAgentId !== contract.sellerAgentId
      ) {
        throw new MarketplaceError(
          "FORBIDDEN",
          "Only a contract party may request refund.",
          403,
        );
      }
      if (
        ![
          "pending_seller_acceptance",
          "rejected",
          "disputed",
          "active",
        ].includes(contract.status)
      ) {
        throw new MarketplaceError(
          "INVALID_STATE_TRANSITION",
          "Contract cannot be refunded.",
          409,
        );
      }
      const reservation = this.reservations.get(contract.reservationId);
      if (!reservation || reservation.status !== "active") {
        throw new MarketplaceError(
          "INVALID_STATE_TRANSITION",
          "Reservation is not active.",
          409,
        );
      }
      for (const allocation of reservation.allocations) {
        const lot = this.capitalLots.get(allocation.capitalLotId);
        if (!lot || lot.reservedMinor < allocation.amountMinor) {
          throw new MarketplaceError(
            "INTERNAL_ERROR",
            "Capital allocation is inconsistent.",
            500,
          );
        }
        lot.reservedMinor -= allocation.amountMinor;
        lot.availableMinor += allocation.amountMinor;
        lot.status = "verified";
      }
      const sourceCode: LedgerAccountCode =
        contract.status === "disputed" ? "disputed" : "eligible_reserved";
      const source = this.getOrCreateAccount(
        contract.buyerAgentId,
        sourceCode,
        contract.asset,
      );
      const available = this.getOrCreateAccount(
        contract.buyerAgentId,
        "eligible_available",
        contract.asset,
      );
      this.postLedger("refund", "contract", contractId, contract.asset, [
        {
          accountId: source.id,
          side: "debit",
          amountMinor: contract.amountMinor,
        },
        {
          accountId: available.id,
          side: "credit",
          amountMinor: contract.amountMinor,
        },
      ]);
      reservation.status = "refunded";
      reservation.resolvedAt = nowIso();
      contract.status = "refunded";
      contract.updatedAt = nowIso();
      const job = this.jobs.get(contract.jobId);
      if (job) {
        job.status = "refunded";
        job.updatedAt = nowIso();
      }
      const dispute = [...this.disputes.values()].find(
        (candidate) =>
          candidate.contractId === contractId && candidate.status === "open",
      );
      if (dispute) {
        dispute.status = "resolved_refund";
        dispute.resolvedAt = nowIso();
      }
      this.reputationEvents.push(
        createReputationEvent({
          agentId: contract.sellerAgentId,
          counterpartyAgentId: contract.buyerAgentId,
          contractId,
          type: "refund",
          amountMinor: contract.amountMinor,
          durationMs: null,
          metadata: { reason },
        }),
      );
      this.audit(actorAgentId, "contract.refunded", "contract", contractId, {
        reason,
      });
      return clone(contract);
    });
  }

  private detectRiskSignals(
    contract: Contract,
    artifactHash: string | null,
  ): void {
    const earlier = [...this.settlements.values()]
      .filter((settlement) => settlement.contractId !== contract.id)
      .map((settlement) => ({
        settlement,
        contract: this.contracts.get(settlement.contractId),
      }))
      .filter(({ contract: previous }) => Boolean(previous));
    const reciprocal = earlier.find(
      ({ contract: previous }) =>
        previous?.buyerAgentId === contract.sellerAgentId &&
        previous.sellerAgentId === contract.buyerAgentId,
    );
    if (reciprocal) {
      this.addRiskFlag(contract.buyerAgentId, {
        code: "RECIPROCAL_TRADING",
        severity: "low",
        explanation:
          "A reciprocal trade relationship was observed. This is a signal for review, not an accusation.",
        evidenceIds: [contract.id, reciprocal.contract?.id ?? ""].filter(
          Boolean,
        ),
      });
      this.addRiskFlag(contract.sellerAgentId, {
        code: "RECIPROCAL_TRADING",
        severity: "low",
        explanation:
          "A reciprocal trade relationship was observed. This is a signal for review, not an accusation.",
        evidenceIds: [contract.id, reciprocal.contract?.id ?? ""].filter(
          Boolean,
        ),
      });
    }
    const reservation = this.reservations.get(contract.reservationId);
    const lineageAgents = new Set<string>();
    const walkLineage = (lotId: string, visited: Set<string>): void => {
      if (visited.has(lotId)) return;
      visited.add(lotId);
      const lot = this.capitalLots.get(lotId);
      if (!lot) return;
      lineageAgents.add(lot.agentId);
      for (const parentId of lot.parentCapitalLotIds)
        walkLineage(parentId, visited);
    };
    for (const allocation of reservation?.allocations ?? []) {
      walkLineage(allocation.capitalLotId, new Set());
    }
    if (lineageAgents.has(contract.sellerAgentId)) {
      const flag: RiskFlag = {
        code: "CIRCULAR_TRANSACTION_PATTERN",
        severity: "medium",
        explanation:
          "Capital returned to an agent present in its own provenance ancestry. This may be legitimate collaboration and is flagged for review only.",
        evidenceIds: [
          contract.id,
          ...(reciprocal?.contract?.id ? [reciprocal.contract.id] : []),
          ...(reservation?.allocations.map(
            (allocation) => allocation.capitalLotId,
          ) ?? []),
        ],
      };
      this.addRiskFlag(contract.buyerAgentId, flag);
      this.addRiskFlag(contract.sellerAgentId, flag);
    }
    if (artifactHash) {
      const reused = [...this.deliveries.values()].filter(
        (delivery) =>
          delivery.contractId !== contract.id &&
          delivery.manifest.artifact_hashes.includes(artifactHash),
      );
      if (reused.length > 0) {
        this.addRiskFlag(contract.sellerAgentId, {
          code: "REUSED_ARTIFACT",
          severity: "medium",
          explanation:
            "An artifact hash appeared in more than one contract. Reuse may be legitimate but is reviewable.",
          evidenceIds: [
            contract.id,
            ...reused.map((delivery) => delivery.contractId),
          ],
        });
      }
    }
  }

  private addRiskFlag(agentId: string, flag: RiskFlag): void {
    const current = this.riskFlags.get(agentId) ?? [];
    if (
      !current.some(
        (existing) =>
          existing.code === flag.code &&
          canonicalJson(existing.evidenceIds) ===
            canonicalJson(flag.evidenceIds),
      )
    ) {
      current.push(flag);
      this.riskFlags.set(agentId, current);
    }
  }

  async importEarningAttestation(
    actorAgentId: string,
    attestation: EarningAttestation,
    verifier: ExternalEarningVerifier,
  ): Promise<ImportedAttestation> {
    return this.withLock("provenance-import", async () => {
      this.activeAgent(actorAgentId);
      const recipient = this.activeAgent(attestation.recipientAgentId);
      this.requiredAgent(attestation.issuerAgentId);
      if (
        recipient.walletAddress.toLowerCase() !==
        attestation.recipientWallet.toLowerCase()
      ) {
        throw new MarketplaceError(
          "PROVENANCE_INVALID",
          "Attestation recipient wallet does not match the registered agent.",
        );
      }
      if (attestation.issuerAgentId === attestation.recipientAgentId) {
        throw new MarketplaceError(
          "PROVENANCE_INVALID",
          "Self-attestation is prohibited.",
          422,
        );
      }
      if (
        this.usedReplayProtectionIds.has(attestation.replayProtectionId) ||
        this.usedPaymentTransactions.has(attestation.paymentTransactionHash)
      ) {
        throw new MarketplaceError(
          "PAYMENT_REPLAYED",
          "Attestation replay identifier or payment transaction was already used.",
          409,
        );
      }
      const verification = await verifier.verify(attestation);
      let capitalLotId: string | null = null;
      if (verification.verified) {
        this.usedReplayProtectionIds.add(attestation.replayProtectionId);
        this.usedPaymentTransactions.add(attestation.paymentTransactionHash);
        const lot = this.importCapital({
          agentId: attestation.recipientAgentId,
          amountMinor: attestation.amountMinor,
          asset: attestation.asset,
          originType: verification.classification,
          sourceTransactionHash: attestation.paymentTransactionHash,
          earningAttestationId: attestation.id,
          earnedAt: attestation.earnedAt,
        });
        capitalLotId = lot.id;
      } else {
        const lot = this.importCapital({
          agentId: attestation.recipientAgentId,
          amountMinor: attestation.amountMinor,
          asset: attestation.asset,
          originType: "unknown",
          sourceTransactionHash: attestation.paymentTransactionHash,
          earningAttestationId: null,
          earnedAt: attestation.earnedAt,
        });
        capitalLotId = lot.id;
      }
      const imported: ImportedAttestation = {
        attestation: clone(attestation),
        verification: clone(verification),
        capitalLotId,
      };
      this.attestations.set(attestation.id, imported);
      this.audit(
        actorAgentId,
        "provenance.attestation_verified",
        "earning_attestation",
        attestation.id,
        {
          verified: verification.verified,
          classification: verification.classification,
          verifier: verification.verifier,
          capital_lot_id: capitalLotId,
        },
      );
      return clone(imported);
    });
  }

  getAttestation(attestationId: string): ImportedAttestation {
    const imported = this.attestations.get(attestationId);
    if (!imported) {
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "Earning attestation was not found.",
        404,
      );
    }
    return clone(imported);
  }

  getProvenanceLineage(capitalLotId: string): {
    lot: CapitalLot;
    parents: Array<{ lot: CapitalLot; parents: unknown[] }>;
  } {
    const build = (
      id: string,
      seen: Set<string>,
    ): { lot: CapitalLot; parents: unknown[] } => {
      const lot = this.capitalLots.get(id);
      if (!lot) {
        throw new MarketplaceError(
          "RESOURCE_NOT_FOUND",
          "Capital lot was not found.",
          404,
        );
      }
      if (seen.has(id)) {
        throw new MarketplaceError(
          "PROVENANCE_CIRCULAR",
          "Circular provenance was detected.",
          409,
        );
      }
      const next = new Set(seen);
      next.add(id);
      return {
        lot: clone(lot),
        parents: lot.parentCapitalLotIds.map((parentId) =>
          build(parentId, next),
        ),
      };
    };
    return build(capitalLotId, new Set()) as {
      lot: CapitalLot;
      parents: Array<{ lot: CapitalLot; parents: unknown[] }>;
    };
  }

  getReputation(agentId: string): ReputationView {
    this.requiredAgent(agentId);
    const events = this.reputationEvents.filter(
      (event) => event.agentId === agentId,
    );
    const unsigned = computeReputation(
      agentId,
      events,
      this.riskFlags.get(agentId) ?? [],
    );
    const signature = this.signer.sign(unsigned).signature;
    return {
      events: events.map(clone),
      snapshot: { ...unsigned, signature },
    };
  }

  createCommunityChannel(
    actorAgentId: string,
    input: {
      slug: string;
      description: string;
      minimum_completed_contracts?: number;
    },
  ): CommunityChannel {
    this.activeAgent(actorAgentId);
    policyCheck(input);
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(input.slug)) {
      throw new MarketplaceError(
        "VALIDATION_ERROR",
        "Channel slug must be 2-63 lowercase alphanumeric or hyphen characters.",
      );
    }
    if (
      [...this.channels.values()].some((channel) => channel.slug === input.slug)
    ) {
      throw new MarketplaceError(
        "CONFLICT",
        "Channel slug is already in use.",
        409,
      );
    }
    const channel: CommunityChannel = {
      id: uuid(),
      slug: input.slug,
      description: input.description,
      minimumCompletedContracts: Math.max(
        0,
        input.minimum_completed_contracts ?? 0,
      ),
      createdByAgentId: actorAgentId,
      memberAgentIds: [actorAgentId],
      createdAt: nowIso(),
    };
    this.channels.set(channel.id, channel);
    this.audit(
      actorAgentId,
      "community.channel_created",
      "community_channel",
      channel.id,
      channel,
    );
    return clone(channel);
  }

  joinCommunityChannel(
    actorAgentId: string,
    channelId: string,
  ): CommunityChannel {
    this.activeAgent(actorAgentId);
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "Community channel was not found.",
        404,
      );
    }
    const reputation = this.getReputation(actorAgentId).snapshot;
    if (reputation.completedContracts < channel.minimumCompletedContracts) {
      throw new MarketplaceError(
        "FORBIDDEN",
        "Agent reputation is below the channel threshold.",
        403,
      );
    }
    if (!channel.memberAgentIds.includes(actorAgentId)) {
      channel.memberAgentIds.push(actorAgentId);
    }
    return clone(channel);
  }

  listCommunityChannels(): CommunityChannel[] {
    return [...this.channels.values()].map(clone);
  }

  async postCommunityMessage(
    actorAgentId: string,
    input: {
      channel_id: string;
      author_agent_id: string;
      type: CommunityMessage["type"];
      content_type: "application/json";
      content: JsonValue;
      tags?: string[];
      mentions?: string[];
      reply_to?: string | null;
      expires_at?: string | null;
      signature: `0x${string}`;
    },
  ): Promise<CommunityMessage> {
    const agent = this.activeAgent(actorAgentId);
    if (input.author_agent_id !== actorAgentId) {
      throw new MarketplaceError(
        "VALIDATION_ERROR",
        "Community message author must match the authenticated agent.",
      );
    }
    policyCheck(input.content);
    const channel = this.channels.get(input.channel_id);
    if (!channel) {
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "Community channel was not found.",
        404,
      );
    }
    if (!channel.memberAgentIds.includes(actorAgentId)) {
      throw new MarketplaceError(
        "FORBIDDEN",
        "Agent is not a channel member.",
        403,
      );
    }
    const now = Date.now();
    const recent = (this.recentMessageTimes.get(actorAgentId) ?? []).filter(
      (timestamp) => timestamp > now - 60_000,
    );
    if (recent.length >= this.config.communityMessagesPerMinute) {
      throw new MarketplaceError(
        "RATE_LIMITED",
        "Community posting rate limit exceeded.",
        429,
        {},
        true,
      );
    }
    if (input.expires_at) assertFuture(input.expires_at);
    if (input.reply_to) {
      const parent = this.messages.get(input.reply_to);
      if (!parent || parent.channelId !== input.channel_id) {
        throw new MarketplaceError(
          "RESOURCE_NOT_FOUND",
          "Reply target was not found in channel.",
          404,
        );
      }
    }
    for (const mentioned of input.mentions ?? []) this.requiredAgent(mentioned);
    const signedInput = {
      channel_id: input.channel_id,
      author_agent_id: input.author_agent_id,
      type: input.type,
      content_type: input.content_type,
      content: input.content,
      tags: [...new Set(input.tags ?? [])].sort(),
      mentions: [...new Set(input.mentions ?? [])].sort(),
      reply_to: input.reply_to ?? null,
      expires_at: input.expires_at ?? null,
    };
    const valid = await verifyMessage({
      address: agent.signingKey,
      message: communityMessageToSign(signedInput),
      signature: input.signature,
    }).catch(() => false);
    if (!valid) {
      throw new MarketplaceError(
        "SIGNATURE_INVALID",
        "Community message signature is invalid.",
        401,
      );
    }
    const message: CommunityMessage = {
      id: uuid(),
      channelId: input.channel_id,
      authorAgentId: actorAgentId,
      type: input.type,
      contentType: input.content_type,
      content: clone(input.content),
      tags: signedInput.tags,
      mentions: signedInput.mentions,
      replyTo: signedInput.reply_to,
      expiresAt: signedInput.expires_at,
      moderationStatus: "published",
      signature: input.signature,
      createdAt: nowIso(),
    };
    this.messages.set(message.id, message);
    recent.push(now);
    this.recentMessageTimes.set(actorAgentId, recent);
    this.audit(
      actorAgentId,
      "community.message_created",
      "community_message",
      message.id,
      {
        channel_id: message.channelId,
        type: message.type,
        content_hash: sha256(canonicalJson(message.content)),
      },
    );
    this.emit("community.message_created", "community_message", message.id, {
      message_id: message.id,
      channel_id: message.channelId,
      author_agent_id: actorAgentId,
      type: message.type,
    });
    return clone(message);
  }

  listCommunityMessages(
    filters: {
      channelId?: string;
      type?: CommunityMessage["type"];
      tag?: string;
      authorAgentId?: string;
    } = {},
  ): CommunityMessage[] {
    const now = Date.now();
    return [...this.messages.values()]
      .filter((message) => message.moderationStatus === "published")
      .filter(
        (message) => !message.expiresAt || Date.parse(message.expiresAt) > now,
      )
      .filter(
        (message) =>
          !filters.channelId || message.channelId === filters.channelId,
      )
      .filter((message) => !filters.type || message.type === filters.type)
      .filter((message) => !filters.tag || message.tags.includes(filters.tag))
      .filter(
        (message) =>
          !filters.authorAgentId ||
          message.authorAgentId === filters.authorAgentId,
      )
      .map(clone);
  }

  registerWebhook(
    agentId: string,
    input: { url: string; eventTypes: string[]; secret: string },
  ): WebhookSubscription {
    this.activeAgent(agentId);
    if (input.secret.length < 24) {
      throw new MarketplaceError(
        "VALIDATION_ERROR",
        "Webhook secret must be at least 24 characters.",
      );
    }
    const subscription: WebhookSubscription = {
      id: uuid(),
      agentId,
      url: safePublicUrl(input.url, this.config.simulationMode),
      eventTypes: [...new Set(input.eventTypes)].sort(),
      secretHash: sha256(input.secret),
      status: "active",
      createdAt: nowIso(),
    };
    this.webhookSubscriptions.set(subscription.id, subscription);
    if (this.config.protectWebhookSecret) {
      this.webhookSecretCiphertexts.set(
        subscription.id,
        this.config.protectWebhookSecret(input.secret),
      );
    }
    this.audit(
      agentId,
      "webhook.registered",
      "webhook_subscription",
      subscription.id,
      {
        url: subscription.url,
        event_types: subscription.eventTypes,
      },
    );
    return clone(subscription);
  }

  resolveWebhookSecret(subscriptionId: string): string | null {
    const ciphertext = this.webhookSecretCiphertexts.get(subscriptionId);
    if (!ciphertext || !this.config.unprotectWebhookSecret) return null;
    try {
      const secret = this.config.unprotectWebhookSecret(ciphertext);
      const subscription = this.webhookSubscriptions.get(subscriptionId);
      return subscription && sha256(secret) === subscription.secretHash
        ? secret
        : null;
    } catch {
      return null;
    }
  }

  listOutboxEvents(status?: OutboxEvent["status"]): OutboxEvent[] {
    return this.outbox
      .filter((event) => !status || event.status === status)
      .map(clone);
  }

  listWebhookDeliveries(status?: WebhookDelivery["status"]): WebhookDelivery[] {
    return [...this.webhookDeliveries.values()]
      .filter((delivery) => !status || delivery.status === status)
      .map(clone);
  }

  async dispatchOutbox(
    deliver: (input: {
      subscription: WebhookSubscription;
      event: OutboxEvent;
      deliveryId: string;
      timestamp: string;
      signature: string;
    }) => Promise<boolean>,
    secretResolver: (subscriptionId: string) => string | null,
  ): Promise<{ delivered: number; failed: number; deadLettered: number }> {
    let delivered = 0;
    let failed = 0;
    let deadLettered = 0;
    for (const event of this.outbox.filter(
      (candidate) =>
        candidate.status === "pending" &&
        Date.parse(candidate.nextAttemptAt) <= Date.now(),
    )) {
      const subscriptions = [...this.webhookSubscriptions.values()].filter(
        (subscription) =>
          subscription.status === "active" &&
          (subscription.eventTypes.includes(event.type) ||
            subscription.eventTypes.includes("*")),
      );
      if (subscriptions.length === 0) {
        event.status = "delivered";
        delivered += 1;
        continue;
      }
      for (const subscription of subscriptions) {
        const deliveryKey = `${event.id}:${subscription.id}`;
        let delivery = [...this.webhookDeliveries.values()].find(
          (candidate) =>
            `${candidate.outboxEventId}:${candidate.subscriptionId}` ===
            deliveryKey,
        );
        if (!delivery) {
          delivery = {
            // Stable across database retries/crashes so webhook consumers can
            // de-duplicate at-least-once delivery by this identifier.
            id: sha256(`a2a402:webhook:${deliveryKey}`),
            subscriptionId: subscription.id,
            outboxEventId: event.id,
            status: "pending",
            attempts: 0,
            nextAttemptAt: nowIso(),
            lastError: null,
            createdAt: nowIso(),
            deliveredAt: null,
          };
          this.webhookDeliveries.set(delivery.id, delivery);
        }
        if (
          delivery.status !== "pending" ||
          Date.parse(delivery.nextAttemptAt) > Date.now()
        ) {
          continue;
        }
        const secret = secretResolver(subscription.id);
        if (!secret || sha256(secret) !== subscription.secretHash) {
          delivery.attempts += 1;
          delivery.lastError = "WEBHOOK_SECRET_UNAVAILABLE";
          if (delivery.attempts >= 8) {
            delivery.status = "dead_letter";
          } else {
            delivery.nextAttemptAt = plusSeconds(
              nowIso(),
              Math.min(3_600, 2 ** delivery.attempts * 5),
            );
          }
          continue;
        }
        const timestamp = nowIso();
        const signature = createHmac("sha256", secret)
          .update(`${delivery.id}.${timestamp}.${canonicalJson(event.payload)}`)
          .digest("hex");
        const ok = await deliver({
          subscription: clone(subscription),
          event: clone(event),
          deliveryId: delivery.id,
          timestamp,
          signature,
        }).catch(() => false);
        delivery.attempts += 1;
        if (ok) {
          delivery.status = "delivered";
          delivery.deliveredAt = nowIso();
          delivery.lastError = null;
        } else if (delivery.attempts >= 8) {
          delivery.status = "dead_letter";
          delivery.lastError = "WEBHOOK_DELIVERY_FAILED";
        } else {
          delivery.lastError = "WEBHOOK_DELIVERY_FAILED";
          delivery.nextAttemptAt = plusSeconds(
            nowIso(),
            Math.min(3_600, 2 ** delivery.attempts * 5),
          );
        }
      }
      const deliveriesForEvent = [...this.webhookDeliveries.values()].filter(
        (candidate) => candidate.outboxEventId === event.id,
      );
      event.attempts = Math.max(
        event.attempts,
        ...deliveriesForEvent.map((delivery) => delivery.attempts),
      );
      if (
        deliveriesForEvent.length === subscriptions.length &&
        deliveriesForEvent.every((delivery) => delivery.status === "delivered")
      ) {
        event.status = "delivered";
        delivered += 1;
      } else if (
        deliveriesForEvent.some((delivery) => delivery.status === "dead_letter")
      ) {
        event.status = "dead_letter";
        deadLettered += 1;
      } else {
        const nextAttempts = deliveriesForEvent
          .filter((delivery) => delivery.status === "pending")
          .map((delivery) => Date.parse(delivery.nextAttemptAt));
        event.nextAttemptAt = new Date(Math.min(...nextAttempts)).toISOString();
        failed += 1;
      }
    }
    return { delivered, failed, deadLettered };
  }

  static verifyWebhookSignature(input: {
    secret: string;
    deliveryId: string;
    timestamp: string;
    payload: JsonValue;
    signature: string;
  }): boolean {
    if (Math.abs(Date.now() - Date.parse(input.timestamp)) > 5 * 60_000)
      return false;
    const expected = createHmac("sha256", input.secret)
      .update(
        `${input.deliveryId}.${input.timestamp}.${canonicalJson(input.payload)}`,
      )
      .digest("hex");
    return secureEqual(expected, input.signature);
  }

  getTransaction(id: string): PaymentIntent | Settlement {
    const payment = this.paymentIntents.get(id);
    if (payment) return clone(payment);
    const settlement = this.settlements.get(id);
    if (settlement) return clone(settlement);
    throw new MarketplaceError(
      "RESOURCE_NOT_FOUND",
      "Transaction was not found.",
      404,
    );
  }

  getReceipt(id: string): SignedReceipt {
    const receipt = this.receipts.get(id);
    if (!receipt)
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "Receipt was not found.",
        404,
      );
    return clone(receipt);
  }

  getStats(asset: string = DEFAULT_ASSET): MarketplaceStats {
    const settlements = [...this.settlements.values()].filter(
      (settlement) =>
        settlement.asset === asset && settlement.status === "completed",
    );
    return {
      agents: this.agents.size,
      activeListings: [...this.listings.values()].filter(
        (listing) => listing.status === "active",
      ).length,
      openJobs: [...this.jobs.values()].filter((job) => job.status === "open")
        .length,
      completedContracts: [...this.contracts.values()].filter(
        (contract) => contract.status === "settled",
      ).length,
      grossVolumeMinor: settlements.reduce(
        (sum, settlement) => sum + settlement.grossMinor,
        0n,
      ),
      platformFeesMinor: settlements.reduce(
        (sum, settlement) => sum + settlement.feeMinor,
        0n,
      ),
      asset,
    };
  }

  freezeAgent(agentId: string, frozen: boolean): Agent {
    const agent = this.requiredAgent(agentId);
    if (frozen && agent.status === "active") agent.status = "suspended";
    if (!frozen && agent.status === "suspended") agent.status = "active";
    agent.updatedAt = nowIso();
    this.audit(
      null,
      frozen ? "admin.agent_frozen" : "admin.agent_unfrozen",
      "agent",
      agentId,
      {},
    );
    return clone(agent);
  }

  freezeContract(contractId: string, frozen: boolean): Contract {
    const contract = this.contracts.get(contractId);
    if (!contract) {
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "Contract was not found.",
        404,
      );
    }
    contract.frozen = frozen;
    if (frozen) {
      if (contract.status !== "frozen") {
        contract.statusBeforeFreeze = contract.status;
      }
      contract.status = "frozen";
    } else if (contract.status === "frozen") {
      contract.status = contract.statusBeforeFreeze ?? "active";
      contract.statusBeforeFreeze = null;
    }
    contract.updatedAt = nowIso();
    this.audit(
      null,
      frozen ? "admin.contract_frozen" : "admin.contract_unfrozen",
      "contract",
      contractId,
      {},
    );
    return clone(contract);
  }

  async processTimeouts(at = new Date()): Promise<{
    expiredBids: number;
    evaluatedDeliveries: number;
    acceptedDeliveries: number;
    refundedContracts: number;
    settledContracts: number;
  }> {
    let expiredBids = 0;
    let evaluatedDeliveries = 0;
    let acceptedDeliveries = 0;
    let refundedContracts = 0;
    let settledContracts = 0;
    const now = at.getTime();
    for (const bid of this.bids.values()) {
      if (bid.status === "submitted" && Date.parse(bid.expiresAt) <= now) {
        bid.status = "expired";
        expiredBids += 1;
      }
    }
    for (const contract of [...this.contracts.values()]) {
      if (contract.frozen) continue;
      if (
        contract.status === "delivered" &&
        Date.parse(contract.evaluationDeadline) <= now &&
        ![...this.evaluations.values()].some(
          (evaluation) => evaluation.contractId === contract.id,
        )
      ) {
        await this.evaluateDeliveryWithAdapters(
          contract.buyerAgentId,
          contract.id,
        );
        evaluatedDeliveries += 1;
      }
      if (
        contract.status === "delivered" &&
        Date.parse(contract.buyerResponseDeadline) <= now
      ) {
        const evaluation = [...this.evaluations.values()].find(
          (candidate) => candidate.contractId === contract.id,
        );
        if (evaluation?.result === "accepted") {
          this.acceptDelivery(contract.buyerAgentId, contract.id);
          acceptedDeliveries += 1;
        }
      }
      if (
        contract.status === "accepted" &&
        Date.parse(contract.automaticSettlementAt) <= now &&
        this.config.simulationMode
      ) {
        await this.settleContract(contract.buyerAgentId, contract.id);
        settledContracts += 1;
      } else if (
        (contract.status === "pending_seller_acceptance" &&
          Date.parse(contract.sellerAcceptanceDeadline) <= now) ||
        (["active", "delivered", "rejected"].includes(contract.status) &&
          Date.parse(contract.automaticRefundAt) <= now)
      ) {
        if (contract.status === "delivered") {
          this.rejectDelivery(contract.buyerAgentId, contract.id, {
            reason: "automatic_timeout_rejection",
          });
        }
        await this.refundContract(
          contract.buyerAgentId,
          contract.id,
          "automatic_timeout_refund",
        );
        refundedContracts += 1;
      }
    }
    return {
      expiredBids,
      evaluatedDeliveries,
      acceptedDeliveries,
      refundedContracts,
      settledContracts,
    };
  }

  assertAccountingInvariants(): {
    balancedTransactions: number;
    totalTransactions: number;
    nonnegativeCapitalLots: boolean;
    nonnegativeAgentBalances: boolean;
  } {
    const balancedTransactions = this.ledgerTransactions.filter((transaction) =>
      this.isLedgerTransactionBalanced(transaction.id),
    ).length;
    const nonnegativeCapitalLots = [...this.capitalLots.values()].every(
      (lot) =>
        lot.availableMinor >= 0n &&
        lot.reservedMinor >= 0n &&
        lot.availableMinor + lot.reservedMinor <= lot.amountMinor,
    );
    const nonnegativeAgentBalances = [...this.ledgerAccounts.values()]
      .filter((account) => account.agentId !== null)
      .every((account) => this.accountBalance(account.id) >= 0n);
    if (
      balancedTransactions !== this.ledgerTransactions.length ||
      !nonnegativeCapitalLots ||
      !nonnegativeAgentBalances
    ) {
      throw new MarketplaceError(
        "INTERNAL_ERROR",
        "Accounting invariant failed.",
        500,
      );
    }
    return {
      balancedTransactions,
      totalTransactions: this.ledgerTransactions.length,
      nonnegativeCapitalLots,
      nonnegativeAgentBalances,
    };
  }

  stateView(): MarketplaceStateView {
    return {
      canonicalSeededGenesisDesignation: this.canonicalSeededGenesisDesignation
        ? clone(this.canonicalSeededGenesisDesignation)
        : null,
      agents: [...this.agents.values()].map(clone),
      listings: [...this.listings.values()].map(clone),
      jobs: [...this.jobs.values()].map(clone),
      bids: [...this.bids.values()].map(clone),
      contracts: [...this.contracts.values()].map(clone),
      deliveries: [...this.deliveries.values()].map(clone),
      evaluations: [...this.evaluations.values()].map(clone),
      capitalLots: [...this.capitalLots.values()].map(clone),
      reservations: [...this.reservations.values()].map(clone),
      ledgerAccounts: [...this.ledgerAccounts.values()].map(clone),
      ledgerTransactions: this.ledgerTransactions.map(clone),
      ledgerEntries: this.ledgerEntries.map(clone),
      paymentIntents: [...this.paymentIntents.values()].map(clone),
      settlements: [...this.settlements.values()].map(clone),
      platformFees: this.platformFees.map(clone),
      receipts: [...this.receipts.values()].map(clone),
      disputes: [...this.disputes.values()].map(clone),
      reputationEvents: this.reputationEvents.map(clone),
      communityChannels: [...this.channels.values()].map(clone),
      communityMessages: [...this.messages.values()].map(clone),
      auditEvents: this.audits.map(clone),
      outboxEvents: this.outbox.map(clone),
      webhookSubscriptions: [...this.webhookSubscriptions.values()].map(clone),
      webhookDeliveries: [...this.webhookDeliveries.values()].map(clone),
      riskFlags: Object.fromEntries(
        [...this.riskFlags.entries()].map(([agentId, flags]) => [
          agentId,
          clone(flags),
        ]),
      ),
      discoveryEvidence: [...this.discoveryEvidence.values()].map(clone),
      genesisAgents: [...this.genesisAgents.values()].map(clone),
      operationalMetrics: clone(this.operationalMetrics),
    };
  }

  exportSnapshot(): Record<string, unknown> {
    return {
      format: "a2a402-engine-snapshot/0.1",
      executionMode: this.config.simulationMode ? "simulation" : "real",
      sequence: this.sequence,
      ...this.stateView(),
      nonces: [...this.nonces.values()].map(clone),
      artifacts: [...this.artifacts.values()].map(clone),
      attestations: [...this.attestations.values()].map(clone),
      webhookSubscriptions: [...this.webhookSubscriptions.values()].map(clone),
      webhookDeliveries: [...this.webhookDeliveries.values()].map(clone),
      webhookSecretCiphertexts: [
        ...this.webhookSecretCiphertexts.entries(),
      ].map(([subscriptionId, ciphertext]) => ({
        subscriptionId,
        ciphertext,
      })),
      idempotencyRecords: [...this.idempotency.entries()]
        .filter(
          ([, record]) =>
            record.persist &&
            record.expiresAt > Date.now() &&
            record.result !== undefined &&
            !record.pending,
        )
        .map(([key, record]) => ({
          key,
          hash: record.hash,
          result: clone(record.result),
          expiresAt: new Date(record.expiresAt).toISOString(),
        })),
      usedPaymentTransactions: [...this.usedPaymentTransactions],
      usedReplayProtectionIds: [...this.usedReplayProtectionIds],
      recentMessageTimes: [...this.recentMessageTimes.entries()],
    };
  }

  restoreSnapshot(snapshot: unknown): void {
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      (snapshot as { format?: string }).format !== "a2a402-engine-snapshot/0.1"
    ) {
      throw new Error("Unsupported marketplace engine snapshot.");
    }
    const source = snapshot as Record<string, unknown>;
    const expectedExecutionMode = this.config.simulationMode
      ? "simulation"
      : "real";
    const snapshotExecutionMode = source.executionMode;
    if (
      snapshotExecutionMode !== undefined &&
      snapshotExecutionMode !== expectedExecutionMode
    ) {
      throw new Error(
        `Marketplace snapshot mode ${String(snapshotExecutionMode)} cannot be loaded in ${expectedExecutionMode} mode.`,
      );
    }
    if (snapshotExecutionMode === undefined && !this.config.simulationMode) {
      throw new Error(
        "Legacy marketplace snapshots without execution-mode provenance are simulation-only.",
      );
    }
    const rows = <T>(name: string): T[] => {
      const value = source[name];
      if (!Array.isArray(value))
        throw new Error(`Snapshot field ${name} is invalid.`);
      return value as T[];
    };
    const replaceMap = <T extends { id: string }>(
      target: Map<string, T>,
      name: string,
    ): void => {
      target.clear();
      for (const row of rows<T>(name)) target.set(row.id, clone(row));
    };
    replaceMap(this.agents, "agents");
    this.agentsByWallet.clear();
    for (const agent of this.agents.values()) {
      this.agentsByWallet.set(agent.walletAddress.toLowerCase(), agent.id);
    }
    replaceMap(this.nonces, "nonces");
    replaceMap(this.listings, "listings");
    replaceMap(this.jobs, "jobs");
    const designation = source.canonicalSeededGenesisDesignation;
    if (
      designation &&
      typeof designation === "object" &&
      !Array.isArray(designation)
    ) {
      const candidate =
        designation as Partial<CanonicalSeededGenesisDesignation>;
      const job =
        typeof candidate.jobId === "string"
          ? this.jobs.get(candidate.jobId)
          : null;
      const buyer =
        typeof candidate.buyerAgentId === "string"
          ? this.agents.get(candidate.buyerAgentId)
          : null;
      const expectedDefinitionDigest = canonicalSeededGenesisDefinitionDigest(
        this.config.maxArtifactBytes,
      );
      this.canonicalSeededGenesisDesignation =
        job &&
        typeof candidate.buyerAgentId === "string" &&
        typeof candidate.definitionVersion === "string" &&
        typeof candidate.definitionDigest === "string" &&
        candidate.definitionVersion ===
          CANONICAL_SEEDED_GENESIS_DEFINITION_VERSION &&
        candidate.definitionDigest === expectedDefinitionDigest &&
        job.buyerAgentId === candidate.buyerAgentId &&
        marketplaceJobDefinitionDigest(job) === expectedDefinitionDigest &&
        buyer?.walletAddress === CANONICAL_SEEDED_GENESIS_BUYER_WALLET &&
        buyer.capabilities.includes(CANONICAL_SEEDED_GENESIS_BUYER_CAPABILITY)
          ? clone(candidate as CanonicalSeededGenesisDesignation)
          : null;
    } else {
      this.canonicalSeededGenesisDesignation = null;
    }
    replaceMap(this.bids, "bids");
    replaceMap(this.contracts, "contracts");
    for (const contract of this.contracts.values()) {
      contract.statusBeforeFreeze ??= null;
      contract.sellerAcceptanceDeadline ??= contract.deliveryDeadline;
      contract.sellerAcceptedAt ??=
        contract.status === "pending_seller_acceptance"
          ? null
          : contract.createdAt;
    }
    replaceMap(this.deliveries, "deliveries");
    replaceMap(this.artifacts, "artifacts");
    replaceMap(this.evaluations, "evaluations");
    replaceMap(this.capitalLots, "capitalLots");
    for (const lot of this.capitalLots.values()) {
      lot.provenanceScope ??= "simulation";
    }
    replaceMap(this.reservations, "reservations");
    replaceMap(this.ledgerAccounts, "ledgerAccounts");
    replaceMap(this.paymentIntents, "paymentIntents");
    for (const intent of this.paymentIntents.values()) {
      intent.requirement ??= null;
      intent.verification ??= null;
    }
    replaceMap(this.settlements, "settlements");
    replaceMap(this.receipts, "receipts");
    replaceMap(this.disputes, "disputes");
    replaceMap(this.channels, "communityChannels");
    replaceMap(this.messages, "communityMessages");
    replaceMap(this.webhookSubscriptions, "webhookSubscriptions");
    if (Array.isArray(source.discoveryEvidence)) {
      replaceMap(this.discoveryEvidence, "discoveryEvidence");
    } else {
      this.discoveryEvidence.clear();
    }
    if (Array.isArray(source.genesisAgents)) {
      this.genesisAgents.clear();
      for (const record of rows<GenesisAgentRecord>("genesisAgents")) {
        this.genesisAgents.set(record.agentId, clone(record));
      }
    } else {
      this.genesisAgents.clear();
    }
    const operationalMetrics = source.operationalMetrics;
    if (
      operationalMetrics &&
      typeof operationalMetrics === "object" &&
      !Array.isArray(operationalMetrics)
    ) {
      const imported = operationalMetrics as Partial<OperationalMetrics>;
      this.operationalMetrics = {
        counts: {
          ...this.operationalMetrics.counts,
          ...(imported.counts ?? {}),
        },
        updatedAt:
          typeof imported.updatedAt === "string" ? imported.updatedAt : null,
      };
    }
    if (Array.isArray(source.webhookDeliveries)) {
      replaceMap(this.webhookDeliveries, "webhookDeliveries");
    } else {
      this.webhookDeliveries.clear();
    }
    this.webhookSecretCiphertexts.clear();
    const protectedSecrets = Array.isArray(source.webhookSecretCiphertexts)
      ? (source.webhookSecretCiphertexts as Array<{
          subscriptionId: string;
          ciphertext: string;
        }>)
      : [];
    for (const record of protectedSecrets) {
      this.webhookSecretCiphertexts.set(
        record.subscriptionId,
        record.ciphertext,
      );
    }
    this.ledgerTransactions.splice(
      0,
      this.ledgerTransactions.length,
      ...rows<LedgerTransaction>("ledgerTransactions").map(clone),
    );
    this.ledgerEntries.splice(
      0,
      this.ledgerEntries.length,
      ...rows<LedgerEntry>("ledgerEntries").map(clone),
    );
    this.platformFees.splice(
      0,
      this.platformFees.length,
      ...rows<PlatformFee>("platformFees").map(clone),
    );
    this.reputationEvents.splice(
      0,
      this.reputationEvents.length,
      ...rows<ReputationEvent>("reputationEvents").map(clone),
    );
    this.audits.splice(
      0,
      this.audits.length,
      ...rows<AuditEvent>("auditEvents").map(clone),
    );
    this.outbox.splice(
      0,
      this.outbox.length,
      ...rows<OutboxEvent>("outboxEvents").map(clone),
    );
    this.attestations.clear();
    for (const imported of rows<ImportedAttestation>("attestations")) {
      this.attestations.set(imported.attestation.id, clone(imported));
    }
    this.riskFlags.clear();
    const flags = source.riskFlags;
    if (flags && typeof flags === "object" && !Array.isArray(flags)) {
      for (const [agentId, agentFlags] of Object.entries(flags)) {
        this.riskFlags.set(agentId, clone(agentFlags as RiskFlag[]));
      }
    }
    this.idempotency.clear();
    for (const record of rows<{
      key: string;
      hash: string;
      result: unknown;
      expiresAt?: string;
    }>("idempotencyRecords")) {
      const expiresAt = record.expiresAt
        ? Date.parse(record.expiresAt)
        : Date.now() + 60 * 60 * 1_000;
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) continue;
      this.idempotency.set(record.key, {
        hash: record.hash,
        result: clone(record.result),
        expiresAt,
        persist: true,
      });
    }
    this.usedPaymentTransactions.clear();
    for (const value of rows<string>("usedPaymentTransactions")) {
      this.usedPaymentTransactions.add(value);
    }
    this.usedReplayProtectionIds.clear();
    for (const value of rows<string>("usedReplayProtectionIds")) {
      this.usedReplayProtectionIds.add(value);
    }
    this.recentMessageTimes.clear();
    for (const pair of rows<[string, number[]]>("recentMessageTimes")) {
      this.recentMessageTimes.set(pair[0], [...pair[1]]);
    }
    this.sequence = Number(source.sequence ?? this.outbox.length);
    this.assertAccountingInvariants();
  }

  private audit(
    actorAgentId: string | null,
    action: string,
    targetType: string,
    targetId: string,
    payload: unknown,
  ): AuditEvent {
    const previous = this.audits.at(-1)?.eventHash ?? null;
    const createdAt = nowIso();
    const base = {
      id: uuid(),
      actorAgentId,
      action,
      targetType,
      targetId,
      requestId: null,
      payloadHash: sha256(canonicalJson(payload)),
      previousHash: previous,
      createdAt,
    };
    const event: AuditEvent = {
      ...base,
      eventHash: sha256(canonicalJson(base)),
    };
    this.audits.push(event);
    return event;
  }

  private emit(
    type: string,
    aggregateType: string,
    aggregateId: string,
    payload: JsonValue,
  ): OutboxEvent {
    const base = {
      id: uuid(),
      sequence: ++this.sequence,
      type,
      aggregateType,
      aggregateId,
      payload,
      attempts: 0,
      status: "pending" as const,
      nextAttemptAt: nowIso(),
      createdAt: nowIso(),
    };
    const event: OutboxEvent = {
      ...base,
      signature: this.signer.sign(base).signature,
    };
    this.outbox.push(event);
    return event;
  }
}

function deliveryHashFor(
  deliveries: Map<string, Delivery>,
  contractId: string,
): string | null {
  const delivery = [...deliveries.values()].find(
    (candidate) => candidate.contractId === contractId,
  );
  return delivery?.manifest.artifact_hashes[0] ?? null;
}
