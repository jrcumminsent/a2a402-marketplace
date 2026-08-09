import { pgEnum } from "drizzle-orm/pg-core";

export const agentStatusEnum = pgEnum("agent_status", [
  "active",
  "suspended",
  "restricted",
  "retired",
]);
export const cardFetchStatusEnum = pgEnum("card_fetch_status", [
  "pending",
  "valid",
  "invalid",
  "blocked",
  "failed",
]);
export const nonceStatusEnum = pgEnum("nonce_status", [
  "issued",
  "consumed",
  "expired",
  "revoked",
]);
export const listingTypeEnum = pgEnum("listing_type", [
  "service",
  "api_access",
  "digital_artifact",
  "dataset",
  "software_tool",
  "license",
  "compute",
  "collaboration_offer",
]);
export const listingStatusEnum = pgEnum("listing_status", [
  "draft",
  "active",
  "paused",
  "sold_out",
  "withdrawn",
  "moderated",
]);
export const jobTypeEnum = pgEnum("job_type", [
  "fixed_price",
  "open_bid",
  "bounty",
]);
export const jobStatusEnum = pgEnum("job_status", [
  "draft",
  "open",
  "bidding",
  "reserved",
  "contracted",
  "completed",
  "cancelled",
  "expired",
  "disputed",
  "refunded",
  "frozen",
]);
export const bidStatusEnum = pgEnum("bid_status", [
  "submitted",
  "accepted",
  "rejected",
  "withdrawn",
  "expired",
]);
export const contractStatusEnum = pgEnum("contract_status", [
  "pending_acceptance",
  "active",
  "delivered",
  "evaluating",
  "accepted",
  "rejected",
  "disputed",
  "settled",
  "refunded",
  "cancelled",
  "expired",
  "frozen",
]);
export const deliveryStatusEnum = pgEnum("delivery_status", [
  "submitted",
  "validating",
  "valid",
  "invalid",
  "accepted",
  "rejected",
  "superseded",
]);
export const artifactStatusEnum = pgEnum("artifact_status", [
  "pending",
  "available",
  "quarantined",
  "deleted",
]);
export const evaluationVerdictEnum = pgEnum("evaluation_verdict", [
  "pending",
  "accepted",
  "rejected",
  "needs_review",
  "error",
]);
export const disputeStatusEnum = pgEnum("dispute_status", [
  "open",
  "evidence",
  "resolved_buyer",
  "resolved_seller",
  "split",
  "dismissed",
]);
export const originTypeEnum = pgEnum("capital_origin_type", [
  "marketplace_earned",
  "verified_external_agent_earned",
  "human_seeded",
  "unknown",
  "platform_test_funds",
]);
export const capitalLotStatusEnum = pgEnum("capital_lot_status", [
  "pending",
  "verified",
  "partially_reserved",
  "fully_reserved",
  "partially_spent",
  "spent",
  "frozen",
  "rejected",
]);
export const attestationStatusEnum = pgEnum("attestation_status", [
  "pending",
  "verified",
  "rejected",
  "revoked",
]);
export const capitalAllocationKindEnum = pgEnum("capital_allocation_kind", [
  "reserve",
  "release",
  "spend",
  "refund",
  "derive",
  "freeze",
  "unfreeze",
]);
export const paymentIntentStatusEnum = pgEnum("payment_intent_status", [
  "requires_payment",
  "pending",
  "verified",
  "failed",
  "settled",
  "refunded",
  "expired",
]);
export const settlementStatusEnum = pgEnum("settlement_status", [
  "pending",
  "processing",
  "completed",
  "failed",
  "refunded",
  "partially_refunded",
]);
export const ledgerAccountClassEnum = pgEnum("ledger_account_class", [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
]);
export const ledgerNormalBalanceEnum = pgEnum("ledger_normal_balance", [
  "debit",
  "credit",
]);
export const ledgerTransactionStatusEnum = pgEnum("ledger_transaction_status", [
  "draft",
  "posted",
  "void",
]);
export const ledgerEntryDirectionEnum = pgEnum("ledger_entry_direction", [
  "debit",
  "credit",
]);
export const feeStatusEnum = pgEnum("platform_fee_status", [
  "accrued",
  "collected",
  "refunded",
]);
export const communityMessageTypeEnum = pgEnum("community_message_type", [
  "discussion",
  "proposal",
  "request",
  "announcement",
  "collaboration",
]);
export const moderationStatusEnum = pgEnum("moderation_status", [
  "pending",
  "allowed",
  "limited",
  "quarantined",
  "removed",
]);
export const moderationActionEnum = pgEnum("moderation_action", [
  "allow",
  "limit",
  "quarantine",
  "remove",
  "freeze",
  "unfreeze",
  "warn",
]);
export const idempotencyStatusEnum = pgEnum("idempotency_status", [
  "processing",
  "completed",
  "failed",
]);
export const webhookStatusEnum = pgEnum("webhook_status", [
  "active",
  "paused",
  "disabled",
]);
export const deliveryAttemptStatusEnum = pgEnum("delivery_attempt_status", [
  "pending",
  "delivered",
  "retrying",
  "dead_letter",
]);
export const outboxStatusEnum = pgEnum("outbox_status", [
  "pending",
  "processing",
  "published",
  "failed",
  "dead_letter",
]);
export const riskSeverityEnum = pgEnum("risk_severity", [
  "info",
  "low",
  "medium",
  "high",
  "critical",
]);
