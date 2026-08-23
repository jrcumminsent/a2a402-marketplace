import type { CapitalOrigin, JsonValue, AgentStatus } from "@a2a402/shared";
import type {
  EarningAttestation,
  ExternalEarningVerification,
} from "@a2a402/provenance";
import type {
  ReputationEvent,
  ReputationSnapshot,
  RiskFlag,
} from "@a2a402/reputation";
import type { EvaluatorAdapter } from "@a2a402/evaluation";
import type { PaymentAdapter } from "@a2a402/payments";
import type { ArtifactStorage } from "@a2a402/shared";

export type JsonSchema = Record<string, unknown>;

export interface Agent {
  id: string;
  walletAddress: `0x${string}`;
  signingKey: `0x${string}`;
  externalAgentCardUrl: string | null;
  capabilities: string[];
  inputModalities: string[];
  outputModalities: string[];
  status: AgentStatus;
  spendLimitMinor: bigint | null;
  earnLimitMinor: bigint | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRegistration {
  wallet_address: `0x${string}`;
  signing_key?: `0x${string}`;
  external_agent_card_url?: string | null;
  capabilities: string[];
  input_modalities?: string[];
  output_modalities?: string[];
  registration_signature: `0x${string}`;
}

export type OperationalMetricName =
  | "discovery_visits"
  | "onboarding_views"
  | "failed_registrations"
  | "successful_registrations"
  | "bids"
  | "completed_bounties"
  | "notification_failures";

export interface OperationalMetrics {
  counts: Record<OperationalMetricName, number>;
  updatedAt: string | null;
}

export interface AuthNonce {
  id: string;
  agentId: string;
  walletAddress: `0x${string}`;
  nonce: string;
  challenge: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}

export type ListingType =
  | "service"
  | "api_access"
  | "digital_artifact"
  | "dataset"
  | "software_tool"
  | "license"
  | "compute"
  | "collaboration_offer";

export interface ServiceListing {
  id: string;
  sellerAgentId: string;
  type: ListingType;
  version: number;
  status: "active" | "paused" | "retired";
  title: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  maximumExecutionSeconds: number;
  priceMinor: bigint;
  asset: string;
  requiredReputation: Record<string, number>;
  requiredCapabilities: string[];
  acceptanceRules: AcceptanceRule[];
  artifactMimeTypes: string[];
  licenseTerms: string;
  refundRules: Record<string, JsonValue>;
  timeoutRules: Record<string, JsonValue>;
  tags: string[];
  policyCategory: string;
  sellerA2aEndpoint: string | null;
  sellerWebhookEndpoint: string | null;
  createdAt: string;
  updatedAt: string;
}

export type JobType = "fixed_price" | "open_bid" | "bounty";
export type JobStatus =
  "open" | "awarded" | "cancelled" | "completed" | "refunded" | "disputed";

export interface AcceptanceRule {
  path: string;
  operator: "present" | "equals" | "not_equals" | "gte" | "lte" | "matches";
  value?: JsonValue;
}

export interface Job {
  id: string;
  buyerAgentId: string;
  listingId: string | null;
  type: JobType;
  status: JobStatus;
  title: string;
  description: string;
  input: JsonValue;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  maximumExecutionSeconds: number;
  budgetMinor: bigint;
  asset: string;
  requiredReputation: Record<string, number>;
  requiredCapabilities: string[];
  acceptanceRules: AcceptanceRule[];
  artifactMimeTypes: string[];
  maximumArtifactBytes: number;
  licenseTerms: string;
  refundRules: Record<string, JsonValue>;
  timeoutRules: {
    bidExpirationSeconds: number;
    sellerAcceptanceSeconds: number;
    deliverySeconds: number;
    evaluationSeconds: number;
    buyerResponseSeconds: number;
    automaticRefundSeconds: number;
    automaticSettlementSeconds: number;
  };
  tags: string[];
  policyCategory: string;
  bidDeadline: string;
  createdAt: string;
  updatedAt: string;
}

export interface Bid {
  id: string;
  jobId: string;
  sellerAgentId: string;
  amountMinor: bigint;
  asset: string;
  executionSeconds: number;
  proposal: JsonValue;
  status: "submitted" | "accepted" | "rejected" | "expired" | "withdrawn";
  expiresAt: string;
  createdAt: string;
}

export interface CapitalAllocation {
  capitalLotId: string;
  amountMinor: bigint;
}

export interface CapitalReservation {
  id: string;
  agentId: string;
  jobId: string;
  contractId: string | null;
  amountMinor: bigint;
  asset: string;
  allocations: CapitalAllocation[];
  status: "active" | "settled" | "refunded";
  createdAt: string;
  resolvedAt: string | null;
}

export type ContractStatus =
  | "pending_seller_acceptance"
  | "active"
  | "delivered"
  | "accepted"
  | "rejected"
  | "disputed"
  | "settled"
  | "refunded"
  | "frozen";

export interface Contract {
  id: string;
  jobId: string;
  bidId: string;
  buyerAgentId: string;
  sellerAgentId: string;
  reservationId: string;
  amountMinor: bigint;
  asset: string;
  platformFeeBps: number;
  status: ContractStatus;
  frozen: boolean;
  statusBeforeFreeze: Exclude<ContractStatus, "frozen"> | null;
  sellerAcceptanceDeadline: string;
  sellerAcceptedAt: string | null;
  outputSchema: JsonSchema;
  acceptanceRules: AcceptanceRule[];
  artifactMimeTypes: string[];
  maximumArtifactBytes: number;
  deliveryDeadline: string;
  evaluationDeadline: string;
  buyerResponseDeadline: string;
  automaticSettlementAt: string;
  automaticRefundAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SignedDeliveryManifest {
  contract_id: string;
  seller_agent_id: string;
  artifact_uris: string[];
  artifact_hashes: string[];
  artifact_mime_types?: string[];
  artifact_sizes?: number[];
  output_schema: string;
  result: JsonValue;
  completed_at: string;
  signature: `0x${string}`;
}

export interface Delivery {
  id: string;
  contractId: string;
  sellerAgentId: string;
  manifest: SignedDeliveryManifest;
  manifestHash: string;
  status: "submitted" | "accepted" | "rejected" | "disputed";
  createdAt: string;
}

export interface EvaluationCheck {
  name: string;
  passed: boolean;
  details: Record<string, JsonValue>;
}

export interface Evaluation {
  id: string;
  contractId: string;
  deliveryId: string;
  evaluator: "schema" | "deterministic_rules" | "mock_agent";
  result: "accepted" | "rejected";
  checks: EvaluationCheck[];
  createdAt: string;
}

export interface Artifact {
  id: string;
  deliveryId: string;
  uri: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ArtifactUploadInput {
  key: string;
  mime_type: string;
  data_base64?: string;
  data_utf8?: string;
  expected_sha256?: string;
  metadata?: Record<string, JsonValue>;
}

export interface CapitalLot {
  id: string;
  agentId: string;
  asset: string;
  amountMinor: bigint;
  availableMinor: bigint;
  reservedMinor: bigint;
  originType: CapitalOrigin;
  /**
   * Immutable execution-domain taint. Simulation-scoped capital can never
   * become eligible in a real/testnet marketplace, including after resale.
   */
  provenanceScope: "simulation" | "real";
  sourceJobId: string | null;
  sourceSettlementId: string | null;
  sourceTransactionHash: string | null;
  earningAttestationId: string | null;
  parentCapitalLotIds: string[];
  status: "verified" | "pending" | "rejected" | "spent";
  earnedAt: string;
  createdAt: string;
}

export type LedgerAccountCode =
  | "eligible_available"
  | "eligible_reserved"
  | "ineligible_available"
  | "pending_settlement"
  | "disputed"
  | "platform_funding"
  | "platform_fee_revenue"
  | "network_cost"
  | "refunds";

export interface LedgerAccount {
  id: string;
  agentId: string | null;
  code: LedgerAccountCode;
  asset: string;
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  transactionId: string;
  accountId: string;
  side: "debit" | "credit";
  amountMinor: bigint;
  createdAt: string;
}

export interface LedgerTransaction {
  id: string;
  kind:
    | "capital_import"
    | "reservation"
    | "settlement"
    | "refund"
    | "reversal"
    | "dispute";
  referenceType: string;
  referenceId: string;
  asset: string;
  entryIds: string[];
  reversalOf: string | null;
  createdAt: string;
}

export interface Settlement {
  id: string;
  contractId: string;
  reservationId: string;
  paymentIntentId: string;
  grossMinor: bigint;
  feeMinor: bigint;
  networkCostMinor: bigint;
  sellerNetMinor: bigint;
  asset: string;
  paymentTransactionHash: string;
  sellerCapitalLotId: string;
  ledgerTransactionId: string;
  receiptId: string;
  status: "completed" | "reversed";
  createdAt: string;
}

export interface PaymentIntent {
  id: string;
  contractId: string;
  paymentIdentifier: string;
  adapter: string;
  amountMinor: bigint;
  asset: string;
  status: "required" | "verified" | "settled" | "refunded";
  transactionHash: string | null;
  requirement: JsonValue | null;
  verification: JsonValue | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformFee {
  id: string;
  settlementId: string;
  contractId: string;
  amountMinor: bigint;
  basisPoints: number;
  asset: string;
  ledgerTransactionId: string;
  createdAt: string;
}

export interface SignedReceipt {
  id: string;
  version: "a2a402-settlement-receipt/0.1";
  settlementId: string;
  contractId: string;
  buyerAgentId: string;
  sellerAgentId: string;
  grossMinor: bigint;
  feeMinor: bigint;
  sellerNetMinor: bigint;
  asset: string;
  paymentTransactionHash: string;
  provenanceLotId: string;
  issuedAt: string;
  keyId: string;
  digest: string;
  signature: string;
}

export interface Dispute {
  id: string;
  contractId: string;
  openedByAgentId: string;
  reasonCode: string;
  evidence: JsonValue;
  status: "open" | "resolved_refund" | "resolved_settlement";
  createdAt: string;
  resolvedAt: string | null;
}

export interface CommunityChannel {
  id: string;
  slug: string;
  description: string;
  minimumCompletedContracts: number;
  createdByAgentId: string;
  memberAgentIds: string[];
  createdAt: string;
}

export interface CommunityMessage {
  id: string;
  channelId: string;
  authorAgentId: string;
  type:
    "discussion" | "proposal" | "request" | "announcement" | "collaboration";
  contentType: "application/json";
  content: JsonValue;
  tags: string[];
  mentions: string[];
  replyTo: string | null;
  expiresAt: string | null;
  moderationStatus: "published" | "held" | "removed";
  signature: `0x${string}`;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  actorAgentId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  requestId: string | null;
  payloadHash: string;
  previousHash: string | null;
  eventHash: string;
  createdAt: string;
}

export interface OutboxEvent {
  id: string;
  sequence: number;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: JsonValue;
  signature: string;
  attempts: number;
  status: "pending" | "delivered" | "dead_letter";
  nextAttemptAt: string;
  createdAt: string;
}

export interface WebhookSubscription {
  id: string;
  agentId: string;
  url: string;
  eventTypes: string[];
  secretHash: string;
  status: "active" | "paused";
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  outboxEventId: string;
  status: "pending" | "delivered" | "dead_letter";
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface BalanceView {
  agentId: string;
  asset: string;
  eligibleAvailableMinor: bigint;
  eligibleReservedMinor: bigint;
  ineligibleAvailableMinor: bigint;
  pendingSettlementMinor: bigint;
  disputedMinor: bigint;
  byOrigin: Record<
    CapitalOrigin,
    { availableMinor: bigint; reservedMinor: bigint }
  >;
}

export interface ImportedAttestation {
  attestation: EarningAttestation;
  verification: ExternalEarningVerification;
  capitalLotId: string | null;
}

export type DiscoverySource =
  | "search_engine"
  | "another_agent"
  | "crawler"
  | "a2a_registry"
  | "agent_directory"
  | "llm_retrieval"
  | "github"
  | "social_platform"
  | "moltbook"
  | "direct"
  | "unknown"
  | "self_reported_other";

export interface DiscoveryEvidence {
  id: string;
  firstLandingEndpoint: string;
  source: DiscoverySource;
  sourceEvidence: "self_attested" | "request_metadata" | "combined";
  referrerOrigin: string | null;
  campaignSource: string | null;
  userAgentFamily: string | null;
  agentFramework: string | null;
  discoveryDocument: string | null;
  selfReportedSource: string | null;
  agentId: string | null;
  firstAuthenticatedAction: string | null;
  createdAt: string;
  linkedAt: string | null;
}

export interface GenesisAgentRecord {
  agentId: string;
  sequence: number;
  discoveryEvidenceId: string;
  discoveryTimestamp: string;
  firstDiscoveredEndpoint: string;
  discoverySource: DiscoverySource;
  agentFramework: string | null;
  humanDirectedDiscovery:
    "unknown" | "self_reported_no" | "self_reported_yes" | "verified_no";
  proofOfEarnStatus:
    "unverified" | "self_attested" | "partially_verified" | "verified";
  firstMarketplaceAction: string;
  createdAt: string;
}

export interface MarketplaceStateView {
  agents: Agent[];
  listings: ServiceListing[];
  jobs: Job[];
  bids: Bid[];
  contracts: Contract[];
  deliveries: Delivery[];
  evaluations: Evaluation[];
  capitalLots: CapitalLot[];
  reservations: CapitalReservation[];
  ledgerAccounts: LedgerAccount[];
  ledgerTransactions: LedgerTransaction[];
  ledgerEntries: LedgerEntry[];
  paymentIntents: PaymentIntent[];
  settlements: Settlement[];
  platformFees: PlatformFee[];
  receipts: SignedReceipt[];
  disputes: Dispute[];
  reputationEvents: ReputationEvent[];
  communityChannels: CommunityChannel[];
  communityMessages: CommunityMessage[];
  auditEvents: AuditEvent[];
  outboxEvents: OutboxEvent[];
  webhookSubscriptions: WebhookSubscription[];
  webhookDeliveries: WebhookDelivery[];
  riskFlags: Record<string, RiskFlag[]>;
  discoveryEvidence: DiscoveryEvidence[];
  genesisAgents: GenesisAgentRecord[];
  operationalMetrics: OperationalMetrics;
}

export interface MarketplaceStats {
  agents: number;
  activeListings: number;
  openJobs: number;
  completedContracts: number;
  grossVolumeMinor: bigint;
  platformFeesMinor: bigint;
  asset: string;
}

export interface MarketplaceConfig {
  baseUrl: string;
  publicMarketUrl: string;
  domain: string;
  simulationMode: boolean;
  platformFeeBps: number;
  jwtSecret: string;
  nonceTtlSeconds: number;
  tokenTtlSeconds: number;
  maxJobAmountMinor: bigint;
  maxAgentDailySpendMinor: bigint;
  maxArtifactBytes: number;
  communityMessagesPerMinute: number;
  platformSettlementAddress?: string;
  paymentAdapter?: PaymentAdapter;
  artifactStorage?: ArtifactStorage;
  evaluators?: EvaluatorAdapter[];
  protectWebhookSecret?: (secret: string) => string;
  unprotectWebhookSecret?: (ciphertext: string) => string;
  signingPrivateKeyPem?: string;
  signingKeyId?: string;
}

export interface ReputationView {
  events: ReputationEvent[];
  snapshot: ReputationSnapshot;
}
