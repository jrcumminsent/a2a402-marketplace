CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE TYPE agent_status AS ENUM ('active', 'suspended', 'restricted', 'retired');
CREATE TYPE card_fetch_status AS ENUM ('pending', 'valid', 'invalid', 'blocked', 'failed');
CREATE TYPE nonce_status AS ENUM ('issued', 'consumed', 'expired', 'revoked');
CREATE TYPE listing_type AS ENUM ('service', 'api_access', 'digital_artifact', 'dataset', 'software_tool', 'license', 'compute', 'collaboration_offer');
CREATE TYPE listing_status AS ENUM ('draft', 'active', 'paused', 'sold_out', 'withdrawn', 'moderated');
CREATE TYPE job_type AS ENUM ('fixed_price', 'open_bid', 'bounty');
CREATE TYPE job_status AS ENUM ('draft', 'open', 'bidding', 'reserved', 'contracted', 'completed', 'cancelled', 'expired', 'disputed', 'refunded', 'frozen');
CREATE TYPE bid_status AS ENUM ('submitted', 'accepted', 'rejected', 'withdrawn', 'expired');
CREATE TYPE contract_status AS ENUM ('pending_acceptance', 'active', 'delivered', 'evaluating', 'accepted', 'rejected', 'disputed', 'settled', 'refunded', 'cancelled', 'expired', 'frozen');
CREATE TYPE delivery_status AS ENUM ('submitted', 'validating', 'valid', 'invalid', 'accepted', 'rejected', 'superseded');
CREATE TYPE artifact_status AS ENUM ('pending', 'available', 'quarantined', 'deleted');
CREATE TYPE evaluation_verdict AS ENUM ('pending', 'accepted', 'rejected', 'needs_review', 'error');
CREATE TYPE dispute_status AS ENUM ('open', 'evidence', 'resolved_buyer', 'resolved_seller', 'split', 'dismissed');
CREATE TYPE capital_origin_type AS ENUM ('marketplace_earned', 'verified_external_agent_earned', 'human_seeded', 'unknown', 'platform_test_funds');
CREATE TYPE capital_lot_status AS ENUM ('pending', 'verified', 'partially_reserved', 'fully_reserved', 'partially_spent', 'spent', 'frozen', 'rejected');
CREATE TYPE attestation_status AS ENUM ('pending', 'verified', 'rejected', 'revoked');
CREATE TYPE capital_allocation_kind AS ENUM ('reserve', 'release', 'spend', 'refund', 'derive', 'freeze', 'unfreeze');
CREATE TYPE payment_intent_status AS ENUM ('requires_payment', 'pending', 'verified', 'failed', 'settled', 'refunded', 'expired');
CREATE TYPE settlement_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'refunded', 'partially_refunded');
CREATE TYPE ledger_account_class AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');
CREATE TYPE ledger_normal_balance AS ENUM ('debit', 'credit');
CREATE TYPE ledger_transaction_status AS ENUM ('draft', 'posted', 'void');
CREATE TYPE ledger_entry_direction AS ENUM ('debit', 'credit');
CREATE TYPE platform_fee_status AS ENUM ('accrued', 'collected', 'refunded');
CREATE TYPE community_message_type AS ENUM ('discussion', 'proposal', 'request', 'announcement', 'collaboration');
CREATE TYPE moderation_status AS ENUM ('pending', 'allowed', 'limited', 'quarantined', 'removed');
CREATE TYPE moderation_action AS ENUM ('allow', 'limit', 'quarantine', 'remove', 'freeze', 'unfreeze', 'warn');
CREATE TYPE idempotency_status AS ENUM ('processing', 'completed', 'failed');
CREATE TYPE webhook_status AS ENUM ('active', 'paused', 'disabled');
CREATE TYPE delivery_attempt_status AS ENUM ('pending', 'delivered', 'retrying', 'dead_letter');
CREATE TYPE outbox_status AS ENUM ('pending', 'processing', 'published', 'failed', 'dead_letter');
CREATE TYPE risk_severity AS ENUM ('info', 'low', 'medium', 'high', 'critical');
--> statement-breakpoint
CREATE TABLE agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_identifier varchar(128) NOT NULL UNIQUE,
  handle varchar(128) NOT NULL UNIQUE,
  public_signing_key text NOT NULL,
  signing_algorithm varchar(32) NOT NULL,
  external_agent_card_url text,
  capabilities_document jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_modalities jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_modalities jsonb NOT NULL DEFAULT '[]'::jsonb,
  status agent_status NOT NULL DEFAULT 'active',
  status_reason_code varchar(64),
  spending_limit_minor bigint,
  earning_limit_minor bigint,
  frozen_at timestamptz,
  retired_at timestamptz,
  economic_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  reputation_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agents_spending_limit_nonnegative CHECK (spending_limit_minor IS NULL OR spending_limit_minor >= 0),
  CONSTRAINT agents_earning_limit_nonnegative CHECK (earning_limit_minor IS NULL OR earning_limit_minor >= 0),
  CONSTRAINT agents_version_positive CHECK (version > 0)
);
CREATE INDEX agents_status_idx ON agents (status);

CREATE TABLE agent_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  network varchar(64) NOT NULL,
  address varchar(255) NOT NULL,
  signature_scheme varchar(64) NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  is_verified boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  disabled_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_wallet_network_address_unique UNIQUE (network, address)
);
CREATE UNIQUE INDEX agent_wallet_one_primary_idx ON agent_wallets (agent_id)
  WHERE is_primary = true AND disabled_at IS NULL;
CREATE INDEX agent_wallet_agent_idx ON agent_wallets (agent_id);

CREATE TABLE agent_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  capability varchar(128) NOT NULL,
  version varchar(32) NOT NULL DEFAULT '1',
  description text,
  input_schema jsonb,
  output_schema jsonb,
  modalities jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_capability_unique UNIQUE (agent_id, capability, version)
);
CREATE INDEX agent_capability_lookup_idx ON agent_capabilities (capability, is_active);

CREATE TABLE agent_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  document jsonb,
  document_sha256 varchar(64),
  fetch_status card_fetch_status NOT NULL DEFAULT 'pending',
  http_status smallint,
  response_bytes bigint,
  etag text,
  failure_code varchar(64),
  fetched_at timestamptz,
  expires_at timestamptz,
  redirect_chain jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolved_addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_card_agent_url_unique UNIQUE (agent_id, source_url),
  CONSTRAINT agent_card_size_nonnegative CHECK (response_bytes IS NULL OR response_bytes >= 0)
);
CREATE INDEX agent_card_status_idx ON agent_cards (fetch_status);

CREATE TABLE auth_nonces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES agents(id) ON DELETE CASCADE,
  wallet_id uuid REFERENCES agent_wallets(id) ON DELETE CASCADE,
  wallet_address varchar(255) NOT NULL,
  network varchar(64) NOT NULL,
  nonce_hash varchar(128) NOT NULL UNIQUE,
  challenge text NOT NULL,
  domain varchar(255) NOT NULL,
  uri text NOT NULL,
  status nonce_status NOT NULL DEFAULT 'issued',
  request_ip inet,
  user_agent_hash varchar(64),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_nonce_expiry_after_creation CHECK (expires_at > created_at)
);
CREATE INDEX auth_nonce_lookup_idx ON auth_nonces (wallet_address, status);
CREATE INDEX auth_nonce_expiry_idx ON auth_nonces (expires_at);
--> statement-breakpoint
CREATE TABLE service_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  listing_type listing_type NOT NULL,
  slug varchar(160) NOT NULL,
  status listing_status NOT NULL DEFAULT 'draft',
  current_version integer NOT NULL DEFAULT 1,
  policy_category varchar(128) NOT NULL,
  moderation_status moderation_status NOT NULL DEFAULT 'pending',
  published_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listing_seller_slug_unique UNIQUE (seller_agent_id, slug),
  CONSTRAINT listing_current_version_positive CHECK (current_version > 0)
);
CREATE INDEX listing_discovery_idx ON service_listings (status, listing_type, policy_category);

CREATE TABLE listing_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES service_listings(id) ON DELETE CASCADE,
  version integer NOT NULL,
  title varchar(240) NOT NULL,
  description text NOT NULL,
  input_schema jsonb NOT NULL,
  output_schema jsonb NOT NULL,
  acceptance_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  refund_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  timeout_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  license_terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  required_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_reputation jsonb NOT NULL DEFAULT '{}'::jsonb,
  artifact_mime_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_execution_seconds integer NOT NULL,
  price_minor bigint NOT NULL,
  asset varchar(32) NOT NULL,
  network varchar(64) NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  seller_a2a_endpoint text,
  seller_webhook_endpoint text,
  content_sha256 varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listing_version_unique UNIQUE (listing_id, version),
  CONSTRAINT listing_version_positive CHECK (version > 0),
  CONSTRAINT listing_price_nonnegative CHECK (price_minor >= 0),
  CONSTRAINT listing_execution_time_positive CHECK (max_execution_seconds > 0)
);
CREATE INDEX listing_version_asset_idx ON listing_versions (asset, price_minor);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  source_listing_id uuid REFERENCES service_listings(id) ON DELETE SET NULL,
  source_listing_version_id uuid REFERENCES listing_versions(id) ON DELETE SET NULL,
  job_type job_type NOT NULL,
  status job_status NOT NULL DEFAULT 'draft',
  title varchar(240) NOT NULL,
  description text NOT NULL,
  input jsonb NOT NULL,
  input_schema jsonb NOT NULL,
  output_schema jsonb NOT NULL,
  acceptance_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  refund_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  timeout_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  budget_minor bigint NOT NULL,
  asset varchar(32) NOT NULL,
  network varchar(64) NOT NULL,
  max_execution_seconds integer NOT NULL,
  required_reputation jsonb NOT NULL DEFAULT '{}'::jsonb,
  required_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  artifact_mime_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  license_terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy_category varchar(128) NOT NULL,
  moderation_status moderation_status NOT NULL DEFAULT 'pending',
  bidding_closes_at timestamptz,
  seller_acceptance_deadline timestamptz,
  delivery_deadline timestamptz,
  evaluation_deadline timestamptz,
  buyer_response_deadline timestamptz,
  automatic_refund_at timestamptz,
  automatic_settlement_at timestamptz,
  published_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_budget_positive CHECK (budget_minor > 0),
  CONSTRAINT job_execution_time_positive CHECK (max_execution_seconds > 0)
);
CREATE INDEX job_discovery_idx ON jobs (status, job_type, asset);
CREATE INDEX job_buyer_idx ON jobs (buyer_agent_id, created_at);

CREATE TABLE job_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  requirement_type varchar(64) NOT NULL,
  name varchar(128) NOT NULL,
  operator varchar(32) NOT NULL DEFAULT 'eq',
  value jsonb NOT NULL,
  is_mandatory boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_requirement_unique UNIQUE (job_id, requirement_type, name)
);
CREATE INDEX job_requirement_lookup_idx ON job_requirements (requirement_type, name);

CREATE TABLE bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  seller_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  status bid_status NOT NULL DEFAULT 'submitted',
  amount_minor bigint NOT NULL,
  asset varchar(32) NOT NULL,
  estimated_execution_seconds integer NOT NULL,
  proposal jsonb NOT NULL,
  signed_payload jsonb NOT NULL,
  signature text NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bid_job_idempotency_unique UNIQUE (job_id, idempotency_key),
  CONSTRAINT bid_amount_positive CHECK (amount_minor > 0),
  CONSTRAINT bid_execution_time_positive CHECK (estimated_execution_seconds > 0)
);
CREATE INDEX bid_job_status_idx ON bids (job_id, status, amount_minor);
CREATE INDEX bid_expiry_idx ON bids (expires_at);

CREATE TABLE contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT UNIQUE,
  accepted_bid_id uuid REFERENCES bids(id) ON DELETE RESTRICT,
  buyer_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  seller_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  status contract_status NOT NULL DEFAULT 'pending_acceptance',
  asset varchar(32) NOT NULL,
  network varchar(64) NOT NULL,
  gross_amount_minor bigint NOT NULL,
  fee_bps integer NOT NULL,
  maximum_network_cost_minor bigint NOT NULL DEFAULT 0,
  terms jsonb NOT NULL,
  terms_sha256 varchar(64) NOT NULL,
  buyer_signature text NOT NULL,
  seller_signature text,
  seller_accepted_at timestamptz,
  delivery_deadline timestamptz NOT NULL,
  evaluation_deadline timestamptz NOT NULL,
  buyer_response_deadline timestamptz NOT NULL,
  automatic_refund_at timestamptz NOT NULL,
  automatic_settlement_at timestamptz NOT NULL,
  settled_at timestamptz,
  frozen_at timestamptz,
  freeze_reason_code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_gross_positive CHECK (gross_amount_minor > 0),
  CONSTRAINT contract_fee_bps_range CHECK (fee_bps BETWEEN 0 AND 10000),
  CONSTRAINT contract_network_cost_nonnegative CHECK (maximum_network_cost_minor >= 0),
  CONSTRAINT contract_agents_distinct CHECK (buyer_agent_id <> seller_agent_id)
);
CREATE INDEX contract_buyer_status_idx ON contracts (buyer_agent_id, status);
CREATE INDEX contract_seller_status_idx ON contracts (seller_agent_id, status);

CREATE TABLE deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
  seller_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  sequence integer NOT NULL DEFAULT 1,
  status delivery_status NOT NULL DEFAULT 'submitted',
  manifest jsonb NOT NULL,
  manifest_sha256 varchar(64) NOT NULL,
  output_schema_uri text NOT NULL,
  result jsonb NOT NULL,
  signature text NOT NULL,
  completed_at timestamptz NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  CONSTRAINT delivery_contract_sequence_unique UNIQUE (contract_id, sequence),
  CONSTRAINT delivery_sequence_positive CHECK (sequence > 0)
);
CREATE INDEX delivery_contract_status_idx ON deliveries (contract_id, status);

CREATE TABLE artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL,
  uri text NOT NULL,
  storage_adapter varchar(32) NOT NULL,
  storage_key text NOT NULL,
  sha256 varchar(64) NOT NULL,
  mime_type varchar(255) NOT NULL,
  size_bytes bigint NOT NULL,
  status artifact_status NOT NULL DEFAULT 'pending',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artifact_delivery_ordinal_unique UNIQUE (delivery_id, ordinal),
  CONSTRAINT artifact_ordinal_nonnegative CHECK (ordinal >= 0),
  CONSTRAINT artifact_size_nonnegative CHECK (size_bytes >= 0)
);
CREATE INDEX artifact_hash_idx ON artifacts (sha256);

CREATE TABLE evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE RESTRICT,
  evaluator_agent_id uuid REFERENCES agents(id) ON DELETE RESTRICT,
  evaluator_type varchar(64) NOT NULL,
  evaluator_version varchar(32) NOT NULL,
  verdict evaluation_verdict NOT NULL DEFAULT 'pending',
  score_bps integer,
  checks jsonb NOT NULL,
  deterministic_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  signed_result jsonb,
  signature text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT evaluation_score_range CHECK (score_bps IS NULL OR score_bps BETWEEN 0 AND 10000)
);
CREATE INDEX evaluation_delivery_idx ON evaluations (delivery_id, verdict);
CREATE INDEX evaluation_contract_idx ON evaluations (contract_id);

CREATE TABLE disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
  opened_by_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  status dispute_status NOT NULL DEFAULT 'open',
  reason_code varchar(64) NOT NULL,
  claim jsonb NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolution jsonb,
  buyer_amount_minor bigint,
  seller_amount_minor bigint,
  platform_amount_minor bigint,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispute_buyer_amount_nonnegative CHECK (buyer_amount_minor IS NULL OR buyer_amount_minor >= 0),
  CONSTRAINT dispute_seller_amount_nonnegative CHECK (seller_amount_minor IS NULL OR seller_amount_minor >= 0),
  CONSTRAINT dispute_platform_amount_nonnegative CHECK (platform_amount_minor IS NULL OR platform_amount_minor >= 0)
);
CREATE INDEX dispute_contract_idx ON disputes (contract_id, status);
--> statement-breakpoint
CREATE TABLE earning_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attestation_version varchar(32) NOT NULL DEFAULT 'a2a402-earning-attestation/0.1',
  issuer_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  recipient_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  recipient_wallet varchar(255) NOT NULL,
  network varchar(64) NOT NULL,
  asset varchar(32) NOT NULL,
  amount_minor bigint NOT NULL,
  work_description_hash varchar(128) NOT NULL,
  deliverable_hash varchar(128) NOT NULL,
  payment_transaction_hash varchar(255) NOT NULL,
  replay_protection_id varchar(128) NOT NULL UNIQUE,
  earned_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  payload_sha256 varchar(64) NOT NULL,
  issuer_signature text NOT NULL,
  issuer_key_id varchar(255),
  status attestation_status NOT NULL DEFAULT 'pending',
  verifier_type varchar(64),
  verification_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_at timestamptz,
  rejection_code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT earning_attestation_tx_unique UNIQUE (network, payment_transaction_hash, asset),
  CONSTRAINT earning_attestation_amount_positive CHECK (amount_minor > 0),
  CONSTRAINT earning_attestation_no_self_attestation CHECK (issuer_agent_id <> recipient_agent_id)
);
CREATE INDEX earning_attestation_recipient_idx ON earning_attestations (recipient_agent_id, status);

CREATE TABLE payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_identifier varchar(128) NOT NULL UNIQUE,
  contract_id uuid REFERENCES contracts(id) ON DELETE RESTRICT,
  payer_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  payee_agent_id uuid REFERENCES agents(id) ON DELETE RESTRICT,
  adapter varchar(64) NOT NULL,
  status payment_intent_status NOT NULL DEFAULT 'requires_payment',
  network varchar(64) NOT NULL,
  asset varchar(32) NOT NULL,
  amount_minor bigint NOT NULL,
  payment_requirement jsonb NOT NULL,
  payment_payload_hash varchar(128),
  transaction_hash varchar(255),
  verification_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  settled_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_intent_amount_positive CHECK (amount_minor > 0)
);
CREATE UNIQUE INDEX payment_intent_payload_replay_idx ON payment_intents (payment_payload_hash)
  WHERE payment_payload_hash IS NOT NULL;
CREATE UNIQUE INDEX payment_intent_transaction_replay_idx ON payment_intents (network, transaction_hash)
  WHERE transaction_hash IS NOT NULL;
CREATE INDEX payment_intent_contract_idx ON payment_intents (contract_id, status);
CREATE INDEX payment_intent_expiry_idx ON payment_intents (expires_at);

CREATE TABLE settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT UNIQUE,
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE RESTRICT,
  evaluation_id uuid NOT NULL REFERENCES evaluations(id) ON DELETE RESTRICT,
  payment_intent_id uuid REFERENCES payment_intents(id) ON DELETE RESTRICT,
  status settlement_status NOT NULL DEFAULT 'pending',
  adapter varchar(64) NOT NULL,
  network varchar(64) NOT NULL,
  asset varchar(32) NOT NULL,
  gross_amount_minor bigint NOT NULL,
  platform_fee_minor bigint NOT NULL,
  network_cost_minor bigint NOT NULL DEFAULT 0,
  seller_net_minor bigint NOT NULL,
  transaction_hash varchar(255),
  receipt_payload jsonb NOT NULL,
  receipt_sha256 varchar(64) NOT NULL,
  marketplace_signature text NOT NULL,
  marketplace_key_id varchar(255) NOT NULL,
  idempotency_key varchar(128) NOT NULL UNIQUE,
  failure_code varchar(64),
  initiated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlement_gross_positive CHECK (gross_amount_minor > 0),
  CONSTRAINT settlement_fee_nonnegative CHECK (platform_fee_minor >= 0),
  CONSTRAINT settlement_network_nonnegative CHECK (network_cost_minor >= 0),
  CONSTRAINT settlement_net_nonnegative CHECK (seller_net_minor >= 0),
  CONSTRAINT settlement_amount_equation CHECK (
    gross_amount_minor = platform_fee_minor + network_cost_minor + seller_net_minor
  )
);
CREATE INDEX settlement_tx_hash_idx ON settlements (network, transaction_hash);

CREATE TABLE capital_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  wallet_id uuid REFERENCES agent_wallets(id) ON DELETE RESTRICT,
  asset varchar(32) NOT NULL,
  network varchar(64) NOT NULL,
  amount_minor bigint NOT NULL,
  origin_type capital_origin_type NOT NULL,
  status capital_lot_status NOT NULL DEFAULT 'pending',
  source_job_id uuid REFERENCES jobs(id) ON DELETE RESTRICT,
  source_contract_id uuid REFERENCES contracts(id) ON DELETE RESTRICT,
  source_delivery_id uuid REFERENCES deliveries(id) ON DELETE RESTRICT,
  source_evaluation_id uuid REFERENCES evaluations(id) ON DELETE RESTRICT,
  source_settlement_id uuid REFERENCES settlements(id) ON DELETE RESTRICT,
  source_transaction_hash varchar(255),
  earning_attestation_id uuid REFERENCES earning_attestations(id) ON DELETE RESTRICT,
  verification_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  earned_at timestamptz NOT NULL,
  verified_at timestamptz,
  frozen_at timestamptz,
  freeze_reason_code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capital_lot_amount_positive CHECK (amount_minor > 0)
);
CREATE UNIQUE INDEX capital_lot_settlement_unique ON capital_lots (source_settlement_id)
  WHERE source_settlement_id IS NOT NULL AND origin_type = 'marketplace_earned';
CREATE UNIQUE INDEX capital_lot_attestation_unique ON capital_lots (earning_attestation_id)
  WHERE earning_attestation_id IS NOT NULL;
CREATE INDEX capital_lot_selection_idx ON capital_lots (agent_id, asset, network, status, earned_at);
CREATE INDEX capital_lot_transaction_idx ON capital_lots (network, source_transaction_hash);

CREATE TABLE capital_lot_parents (
  child_capital_lot_id uuid NOT NULL REFERENCES capital_lots(id) ON DELETE RESTRICT,
  parent_capital_lot_id uuid NOT NULL REFERENCES capital_lots(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL,
  lineage_depth integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capital_lot_parents_pk PRIMARY KEY (child_capital_lot_id, parent_capital_lot_id),
  CONSTRAINT capital_lot_parent_amount_positive CHECK (amount_minor > 0),
  CONSTRAINT capital_lot_parent_not_self CHECK (child_capital_lot_id <> parent_capital_lot_id),
  CONSTRAINT capital_lot_parent_depth_positive CHECK (lineage_depth > 0)
);
CREATE INDEX capital_lot_parent_reverse_idx ON capital_lot_parents (parent_capital_lot_id);

CREATE TABLE capital_lot_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capital_lot_id uuid NOT NULL REFERENCES capital_lots(id) ON DELETE RESTRICT,
  contract_id uuid REFERENCES contracts(id) ON DELETE RESTRICT,
  settlement_id uuid REFERENCES settlements(id) ON DELETE RESTRICT,
  derived_capital_lot_id uuid REFERENCES capital_lots(id) ON DELETE RESTRICT,
  allocation_kind capital_allocation_kind NOT NULL,
  amount_minor bigint NOT NULL,
  asset varchar(32) NOT NULL,
  idempotency_key varchar(128) NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capital_allocation_amount_positive CHECK (amount_minor > 0)
);
CREATE INDEX capital_allocation_lot_idx ON capital_lot_allocations (capital_lot_id, allocation_kind);
CREATE INDEX capital_allocation_contract_idx ON capital_lot_allocations (contract_id);
--> statement-breakpoint
CREATE TABLE ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES agents(id) ON DELETE RESTRICT,
  code varchar(96) NOT NULL,
  name varchar(160) NOT NULL,
  asset varchar(32) NOT NULL,
  network varchar(64) NOT NULL,
  account_class ledger_account_class NOT NULL,
  normal_balance ledger_normal_balance NOT NULL,
  balance_bucket varchar(64) NOT NULL,
  proof_of_earn_eligible boolean NOT NULL DEFAULT false,
  allow_negative boolean NOT NULL DEFAULT false,
  is_system_account boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ledger_account_owner_code_unique
  ON ledger_accounts (COALESCE(agent_id, '00000000-0000-0000-0000-000000000000'::uuid), code, asset, network);
CREATE INDEX ledger_account_agent_bucket_idx ON ledger_accounts (agent_id, balance_bucket, asset);

CREATE TABLE ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type varchar(64) NOT NULL,
  status ledger_transaction_status NOT NULL DEFAULT 'draft',
  asset varchar(32) NOT NULL,
  network varchar(64) NOT NULL,
  contract_id uuid REFERENCES contracts(id) ON DELETE RESTRICT,
  settlement_id uuid REFERENCES settlements(id) ON DELETE RESTRICT,
  payment_intent_id uuid REFERENCES payment_intents(id) ON DELETE RESTRICT,
  reverses_transaction_id uuid REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  idempotency_key varchar(128) NOT NULL UNIQUE,
  description text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_reversal_not_self CHECK (reverses_transaction_id IS NULL OR reverses_transaction_id <> id)
);
CREATE INDEX ledger_transaction_contract_idx ON ledger_transactions (contract_id);
CREATE INDEX ledger_transaction_settlement_idx ON ledger_transactions (settlement_id);
CREATE INDEX ledger_transaction_effective_idx ON ledger_transactions (status, effective_at);
CREATE UNIQUE INDEX ledger_one_reversal_per_transaction_idx
  ON ledger_transactions (reverses_transaction_id)
  WHERE reverses_transaction_id IS NOT NULL;

CREATE TABLE ledger_entries (
  id bigserial PRIMARY KEY,
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  ledger_account_id uuid NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
  direction ledger_entry_direction NOT NULL,
  amount_minor bigint NOT NULL,
  capital_lot_id uuid REFERENCES capital_lots(id) ON DELETE RESTRICT,
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entry_amount_positive CHECK (amount_minor > 0)
);
CREATE INDEX ledger_entry_transaction_idx ON ledger_entries (ledger_transaction_id);
CREATE INDEX ledger_entry_account_idx ON ledger_entries (ledger_account_id, created_at);
CREATE INDEX ledger_entry_capital_lot_idx ON ledger_entries (capital_lot_id);

CREATE TABLE platform_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL REFERENCES settlements(id) ON DELETE RESTRICT UNIQUE,
  ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  fee_bps integer NOT NULL,
  gross_amount_minor bigint NOT NULL,
  amount_minor bigint NOT NULL,
  asset varchar(32) NOT NULL,
  network varchar(64) NOT NULL,
  status platform_fee_status NOT NULL DEFAULT 'accrued',
  created_at timestamptz NOT NULL DEFAULT now(),
  collected_at timestamptz,
  refunded_at timestamptz,
  CONSTRAINT platform_fee_bps_range CHECK (fee_bps BETWEEN 0 AND 10000),
  CONSTRAINT platform_fee_gross_positive CHECK (gross_amount_minor > 0),
  CONSTRAINT platform_fee_amount_nonnegative CHECK (amount_minor >= 0),
  CONSTRAINT platform_fee_not_over_gross CHECK (amount_minor <= gross_amount_minor)
);
--> statement-breakpoint
CREATE TABLE reputation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  actor_agent_id uuid REFERENCES agents(id) ON DELETE RESTRICT,
  contract_id uuid REFERENCES contracts(id) ON DELETE RESTRICT,
  event_type varchar(96) NOT NULL,
  dimension varchar(96) NOT NULL,
  delta bigint NOT NULL,
  unit varchar(32) NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_sha256 varchar(64) NOT NULL,
  marketplace_signature text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reputation_no_direct_self_rating CHECK (
    actor_agent_id IS NULL OR actor_agent_id <> subject_agent_id
  )
);
CREATE INDEX reputation_subject_dimension_idx ON reputation_events (subject_agent_id, dimension, occurred_at);
CREATE INDEX reputation_contract_idx ON reputation_events (contract_id);

CREATE TABLE reputation_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  sequence bigint NOT NULL,
  dimensions jsonb NOT NULL,
  source_event_count bigint NOT NULL,
  snapshot_sha256 varchar(64) NOT NULL,
  marketplace_signature text NOT NULL,
  marketplace_key_id varchar(255) NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reputation_snapshot_sequence_unique UNIQUE (agent_id, sequence),
  CONSTRAINT reputation_snapshot_sequence_positive CHECK (sequence > 0),
  CONSTRAINT reputation_snapshot_count_nonnegative CHECK (source_event_count >= 0)
);

CREATE TABLE risk_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  related_agent_id uuid REFERENCES agents(id) ON DELETE RESTRICT,
  contract_id uuid REFERENCES contracts(id) ON DELETE RESTRICT,
  signal_type varchar(96) NOT NULL,
  severity risk_severity NOT NULL,
  explanation text NOT NULL,
  evidence jsonb NOT NULL,
  confidence_bps integer NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  reviewed_at timestamptz,
  CONSTRAINT risk_signal_confidence_range CHECK (confidence_bps BETWEEN 0 AND 10000)
);
CREATE INDEX risk_signal_subject_idx ON risk_signals (subject_agent_id, signal_type, detected_at);

CREATE TABLE community_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(128) NOT NULL UNIQUE,
  name varchar(160) NOT NULL,
  description text NOT NULL,
  creator_agent_id uuid REFERENCES agents(id) ON DELETE RESTRICT,
  visibility varchar(32) NOT NULL DEFAULT 'public',
  minimum_reputation jsonb NOT NULL DEFAULT '{}'::jsonb,
  rate_limit_per_minute integer NOT NULL DEFAULT 10,
  allowed_message_types jsonb NOT NULL DEFAULT '["discussion","proposal","request","announcement","collaboration"]'::jsonb,
  moderation_status moderation_status NOT NULL DEFAULT 'allowed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_channel_rate_positive CHECK (rate_limit_per_minute > 0)
);

CREATE TABLE community_channel_memberships (
  channel_id uuid NOT NULL REFERENCES community_channels(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  role varchar(32) NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  muted_until timestamptz,
  CONSTRAINT community_channel_memberships_pk PRIMARY KEY (channel_id, agent_id)
);
CREATE INDEX community_membership_agent_idx ON community_channel_memberships (agent_id);

CREATE TABLE community_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES community_channels(id) ON DELETE RESTRICT,
  author_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  message_type community_message_type NOT NULL,
  content_type varchar(128) NOT NULL DEFAULT 'application/json',
  content jsonb NOT NULL,
  content_sha256 varchar(64) NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
  signature text NOT NULL,
  signing_key_id varchar(255),
  moderation_status moderation_status NOT NULL DEFAULT 'pending',
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX community_message_feed_idx ON community_messages (channel_id, moderation_status, created_at);
CREATE INDEX community_message_author_idx ON community_messages (author_agent_id, created_at);

CREATE TABLE community_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_message_id uuid NOT NULL REFERENCES community_messages(id) ON DELETE RESTRICT,
  reply_message_id uuid NOT NULL REFERENCES community_messages(id) ON DELETE RESTRICT UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_reply_not_self CHECK (parent_message_id <> reply_message_id)
);
CREATE INDEX community_reply_parent_idx ON community_replies (parent_message_id, created_at);

CREATE TABLE moderation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type varchar(64) NOT NULL,
  target_id uuid NOT NULL,
  subject_agent_id uuid REFERENCES agents(id) ON DELETE RESTRICT,
  actor_type varchar(32) NOT NULL,
  actor_agent_id uuid REFERENCES agents(id) ON DELETE RESTRICT,
  action moderation_action NOT NULL,
  reason_code varchar(96) NOT NULL,
  policy_rule varchar(160) NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_target_idx ON moderation_events (target_type, target_id, created_at);
CREATE INDEX moderation_subject_idx ON moderation_events (subject_agent_id, created_at);
--> statement-breakpoint
CREATE TABLE audit_events (
  sequence bigserial PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  event_type varchar(96) NOT NULL,
  actor_type varchar(32) NOT NULL,
  actor_agent_id uuid REFERENCES agents(id) ON DELETE RESTRICT,
  request_id varchar(128),
  correlation_id varchar(128),
  idempotency_key varchar(128),
  resource_type varchar(64) NOT NULL,
  resource_id uuid,
  action varchar(96) NOT NULL,
  outcome varchar(32) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_event_hash varchar(64),
  event_hash varchar(64) NOT NULL UNIQUE,
  source_ip inet,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_resource_idx ON audit_events (resource_type, resource_id, occurred_at);
CREATE INDEX audit_correlation_idx ON audit_events (correlation_id);

CREATE TABLE idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope varchar(128) NOT NULL,
  key varchar(128) NOT NULL,
  actor_agent_id uuid REFERENCES agents(id) ON DELETE RESTRICT,
  method varchar(16) NOT NULL,
  path text NOT NULL,
  request_hash varchar(64) NOT NULL,
  status idempotency_status NOT NULL DEFAULT 'processing',
  response_status smallint,
  response_body jsonb,
  response_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  locked_until timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_scope_key_unique UNIQUE (scope, key)
);
CREATE INDEX idempotency_expiry_idx ON idempotency_records (expires_at);

CREATE TABLE webhook_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  endpoint_url text NOT NULL,
  event_types jsonb NOT NULL,
  status webhook_status NOT NULL DEFAULT 'active',
  signing_secret_ciphertext text NOT NULL,
  signing_key_version integer NOT NULL DEFAULT 1,
  max_attempts integer NOT NULL DEFAULT 8,
  timeout_ms integer NOT NULL DEFAULT 10000,
  last_delivered_at timestamptz,
  disabled_reason_code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_agent_endpoint_unique UNIQUE (agent_id, endpoint_url),
  CONSTRAINT webhook_attempts_positive CHECK (max_attempts > 0),
  CONSTRAINT webhook_timeout_positive CHECK (timeout_ms > 0)
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type varchar(64) NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version bigint NOT NULL,
  event_type varchar(128) NOT NULL,
  protocol_version varchar(32) NOT NULL DEFAULT 'a2a402/0.1',
  payload jsonb NOT NULL,
  payload_sha256 varchar(64) NOT NULL,
  marketplace_signature text,
  status outbox_status NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by varchar(128),
  published_at timestamptz,
  last_error_code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_aggregate_version_unique UNIQUE (aggregate_type, aggregate_id, aggregate_version),
  CONSTRAINT outbox_version_positive CHECK (aggregate_version > 0),
  CONSTRAINT outbox_attempts_nonnegative CHECK (attempts >= 0)
);
CREATE INDEX outbox_publish_idx ON outbox_events (status, available_at);

CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  outbox_event_id uuid NOT NULL REFERENCES outbox_events(id) ON DELETE CASCADE,
  status delivery_attempt_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  response_status smallint,
  response_body_hash varchar(64),
  error_code varchar(64),
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_delivery_event_unique UNIQUE (subscription_id, outbox_event_id),
  CONSTRAINT webhook_delivery_attempt_nonnegative CHECK (attempt_count >= 0)
);
CREATE INDEX webhook_delivery_due_idx ON webhook_deliveries (status, next_attempt_at);

CREATE TABLE platform_settings (
  key varchar(160) PRIMARY KEY,
  value jsonb NOT NULL,
  value_type varchar(32) NOT NULL,
  description text NOT NULL,
  is_public boolean NOT NULL DEFAULT false,
  is_secret boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 1,
  updated_by varchar(128) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_setting_version_positive CHECK (version > 0),
  CONSTRAINT platform_setting_public_not_secret CHECK (NOT (is_public AND is_secret))
);
--> statement-breakpoint
CREATE FUNCTION a2a402_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = format('%I is append-only; insert a correcting or reversing record', TG_TABLE_NAME);
END;
$$;

CREATE FUNCTION a2a402_protect_agent_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.machine_identifier <> OLD.machine_identifier THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'marketplace agent identifiers are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agents_immutable_identity
BEFORE UPDATE ON agents
FOR EACH ROW EXECUTE FUNCTION a2a402_protect_agent_identity();

CREATE TRIGGER ledger_entries_append_only
BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION a2a402_reject_mutation();

CREATE TRIGGER capital_lot_parents_append_only
BEFORE UPDATE OR DELETE ON capital_lot_parents
FOR EACH ROW EXECUTE FUNCTION a2a402_reject_mutation();

CREATE TRIGGER capital_lot_allocations_append_only
BEFORE UPDATE OR DELETE ON capital_lot_allocations
FOR EACH ROW EXECUTE FUNCTION a2a402_reject_mutation();

CREATE TRIGGER reputation_events_append_only
BEFORE UPDATE OR DELETE ON reputation_events
FOR EACH ROW EXECUTE FUNCTION a2a402_reject_mutation();

CREATE TRIGGER reputation_snapshots_append_only
BEFORE UPDATE OR DELETE ON reputation_snapshots
FOR EACH ROW EXECUTE FUNCTION a2a402_reject_mutation();

CREATE TRIGGER moderation_events_append_only
BEFORE UPDATE OR DELETE ON moderation_events
FOR EACH ROW EXECUTE FUNCTION a2a402_reject_mutation();

CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION a2a402_reject_mutation();
--> statement-breakpoint
CREATE FUNCTION a2a402_guard_capital_lot_core()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id <> OLD.id
    OR NEW.agent_id <> OLD.agent_id
    OR NEW.wallet_id IS DISTINCT FROM OLD.wallet_id
    OR NEW.asset <> OLD.asset
    OR NEW.network <> OLD.network
    OR NEW.amount_minor <> OLD.amount_minor
    OR NEW.origin_type <> OLD.origin_type
    OR NEW.source_job_id IS DISTINCT FROM OLD.source_job_id
    OR NEW.source_contract_id IS DISTINCT FROM OLD.source_contract_id
    OR NEW.source_delivery_id IS DISTINCT FROM OLD.source_delivery_id
    OR NEW.source_evaluation_id IS DISTINCT FROM OLD.source_evaluation_id
    OR NEW.source_settlement_id IS DISTINCT FROM OLD.source_settlement_id
    OR NEW.source_transaction_hash IS DISTINCT FROM OLD.source_transaction_hash
    OR NEW.earning_attestation_id IS DISTINCT FROM OLD.earning_attestation_id
    OR NEW.earned_at <> OLD.earned_at
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'capital lot ownership, amount, origin, and source evidence are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION a2a402_validate_capital_lot_origin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attestation_state attestation_status;
  settlement_state settlement_status;
BEGIN
  IF NEW.origin_type = 'marketplace_earned' THEN
    IF NEW.source_job_id IS NULL
      OR NEW.source_contract_id IS NULL
      OR NEW.source_delivery_id IS NULL
      OR NEW.source_evaluation_id IS NULL
      OR NEW.source_settlement_id IS NULL
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'marketplace-earned capital must link job, contract, delivery, evaluation, and settlement';
    END IF;

    SELECT status INTO settlement_state
    FROM settlements
    WHERE id = NEW.source_settlement_id;

    IF settlement_state <> 'completed' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'marketplace-earned capital requires a completed settlement';
    END IF;
  ELSIF NEW.origin_type = 'verified_external_agent_earned' THEN
    IF NEW.earning_attestation_id IS NULL OR NEW.source_transaction_hash IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'verified external earnings require an attestation and transaction hash';
    END IF;

    SELECT status INTO attestation_state
    FROM earning_attestations
    WHERE id = NEW.earning_attestation_id;

    IF attestation_state <> 'verified' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'external earning attestation must be verified before creating an eligible lot';
    END IF;
  ELSIF NEW.origin_type IN ('human_seeded', 'unknown', 'platform_test_funds') THEN
    IF NEW.earning_attestation_id IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'ineligible or test origins cannot reference a verified earning attestation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER capital_lots_validate_origin
BEFORE INSERT ON capital_lots
FOR EACH ROW EXECUTE FUNCTION a2a402_validate_capital_lot_origin();

CREATE TRIGGER capital_lots_immutable_core
BEFORE UPDATE ON capital_lots
FOR EACH ROW EXECUTE FUNCTION a2a402_guard_capital_lot_core();

CREATE TRIGGER capital_lots_no_delete
BEFORE DELETE ON capital_lots
FOR EACH ROW EXECUTE FUNCTION a2a402_reject_mutation();
--> statement-breakpoint
CREATE FUNCTION a2a402_guard_attestation_core()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id <> OLD.id
    OR NEW.attestation_version <> OLD.attestation_version
    OR NEW.issuer_agent_id <> OLD.issuer_agent_id
    OR NEW.recipient_agent_id <> OLD.recipient_agent_id
    OR NEW.recipient_wallet <> OLD.recipient_wallet
    OR NEW.network <> OLD.network
    OR NEW.asset <> OLD.asset
    OR NEW.amount_minor <> OLD.amount_minor
    OR NEW.work_description_hash <> OLD.work_description_hash
    OR NEW.deliverable_hash <> OLD.deliverable_hash
    OR NEW.payment_transaction_hash <> OLD.payment_transaction_hash
    OR NEW.replay_protection_id <> OLD.replay_protection_id
    OR NEW.earned_at <> OLD.earned_at
    OR NEW.payload <> OLD.payload
    OR NEW.payload_sha256 <> OLD.payload_sha256
    OR NEW.issuer_signature <> OLD.issuer_signature
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'signed earning attestation content is immutable';
  END IF;

  IF OLD.status IN ('verified', 'rejected', 'revoked') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'terminal earning attestation state is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER earning_attestations_immutable_core
BEFORE UPDATE ON earning_attestations
FOR EACH ROW EXECUTE FUNCTION a2a402_guard_attestation_core();

CREATE TRIGGER earning_attestations_no_delete
BEFORE DELETE ON earning_attestations
FOR EACH ROW EXECUTE FUNCTION a2a402_reject_mutation();
--> statement-breakpoint
CREATE FUNCTION a2a402_validate_capital_parent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  child_asset varchar(32);
  child_network varchar(64);
  child_amount bigint;
  parent_asset varchar(32);
  parent_network varchar(64);
  allocated bigint;
  cycle_found boolean;
BEGIN
  PERFORM 1 FROM capital_lots
  WHERE id IN (NEW.child_capital_lot_id, NEW.parent_capital_lot_id)
  ORDER BY id
  FOR UPDATE;

  SELECT asset, network, amount_minor
    INTO child_asset, child_network, child_amount
  FROM capital_lots
  WHERE id = NEW.child_capital_lot_id;

  SELECT asset, network
    INTO parent_asset, parent_network
  FROM capital_lots
  WHERE id = NEW.parent_capital_lot_id;

  IF child_asset <> parent_asset OR child_network <> parent_network THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'capital-lot lineage must preserve asset and network';
  END IF;

  WITH RECURSIVE ancestors(id) AS (
    SELECT NEW.parent_capital_lot_id
    UNION
    SELECT p.parent_capital_lot_id
    FROM capital_lot_parents p
    JOIN ancestors a ON p.child_capital_lot_id = a.id
  )
  SELECT EXISTS (
    SELECT 1 FROM ancestors WHERE id = NEW.child_capital_lot_id
  ) INTO cycle_found;

  IF cycle_found THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'circular capital provenance is forbidden';
  END IF;

  SELECT COALESCE(sum(amount_minor), 0)
    INTO allocated
  FROM capital_lot_parents
  WHERE child_capital_lot_id = NEW.child_capital_lot_id;

  IF allocated + NEW.amount_minor > child_amount THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'parent lineage allocation exceeds child capital-lot amount';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER capital_lot_parent_validate
BEFORE INSERT ON capital_lot_parents
FOR EACH ROW EXECUTE FUNCTION a2a402_validate_capital_parent();

CREATE FUNCTION a2a402_assert_capital_parent_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  child_amount bigint;
  parent_total numeric;
BEGIN
  SELECT amount_minor INTO child_amount
  FROM capital_lots
  WHERE id = NEW.child_capital_lot_id;

  SELECT COALESCE(sum(amount_minor), 0) INTO parent_total
  FROM capital_lot_parents
  WHERE child_capital_lot_id = NEW.child_capital_lot_id;

  IF parent_total <> child_amount THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format(
        'capital lot %s parent allocations must equal child amount (%s, got %s)',
        NEW.child_capital_lot_id,
        child_amount,
        parent_total
      );
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER capital_lot_parent_total_at_commit
AFTER INSERT ON capital_lot_parents
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION a2a402_assert_capital_parent_total();
--> statement-breakpoint
CREATE FUNCTION a2a402_validate_capital_allocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  lot_amount bigint;
  lot_asset varchar(32);
  lot_origin capital_origin_type;
  lot_status capital_lot_status;
  outstanding_reserved bigint;
  outstanding_spent bigint;
  unavailable bigint;
BEGIN
  SELECT amount_minor, asset, origin_type, status
    INTO lot_amount, lot_asset, lot_origin, lot_status
  FROM capital_lots
  WHERE id = NEW.capital_lot_id
  FOR UPDATE;

  IF lot_asset <> NEW.asset THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'capital allocation asset does not match its lot';
  END IF;

  SELECT
    COALESCE(sum(
      CASE
        WHEN allocation_kind = 'reserve' THEN amount_minor
        WHEN allocation_kind IN ('release', 'spend') THEN -amount_minor
        ELSE 0
      END
    ), 0),
    COALESCE(sum(
      CASE
        WHEN allocation_kind = 'spend' THEN amount_minor
        WHEN allocation_kind = 'refund' THEN -amount_minor
        ELSE 0
      END
    ), 0),
    COALESCE(sum(
      CASE
        WHEN allocation_kind = 'reserve' THEN amount_minor
        WHEN allocation_kind IN ('release', 'refund') THEN -amount_minor
        ELSE 0
      END
    ), 0)
  INTO outstanding_reserved, outstanding_spent, unavailable
  FROM capital_lot_allocations
  WHERE capital_lot_id = NEW.capital_lot_id;

  IF NEW.allocation_kind = 'reserve' THEN
    IF lot_origin IN ('human_seeded', 'unknown') THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'human-seeded and unknown capital cannot be reserved for spending';
    END IF;
    IF lot_status NOT IN ('verified', 'partially_reserved', 'partially_spent') THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'capital lot is not available for reservation';
    END IF;
    IF unavailable + NEW.amount_minor > lot_amount THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'capital allocation exceeds available lot amount';
    END IF;
  ELSIF NEW.allocation_kind IN ('release', 'spend') THEN
    IF NEW.amount_minor > outstanding_reserved THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'release or spend exceeds outstanding reservation';
    END IF;
  ELSIF NEW.allocation_kind = 'refund' THEN
    IF NEW.amount_minor > outstanding_spent THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'refund exceeds spent amount';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER capital_lot_allocation_validate
BEFORE INSERT ON capital_lot_allocations
FOR EACH ROW EXECUTE FUNCTION a2a402_validate_capital_allocation();
--> statement-breakpoint
CREATE FUNCTION a2a402_protect_ledger_account()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  has_entries boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM ledger_entries WHERE ledger_account_id = OLD.id
  ) INTO has_entries;

  IF TG_OP = 'DELETE' THEN
    IF has_entries THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'ledger accounts with entries cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF has_entries AND (
    NEW.id <> OLD.id
    OR NEW.agent_id IS DISTINCT FROM OLD.agent_id
    OR NEW.code <> OLD.code
    OR NEW.asset <> OLD.asset
    OR NEW.network <> OLD.network
    OR NEW.account_class <> OLD.account_class
    OR NEW.normal_balance <> OLD.normal_balance
    OR NEW.balance_bucket <> OLD.balance_bucket
    OR NEW.proof_of_earn_eligible <> OLD.proof_of_earn_eligible
    OR NEW.allow_negative <> OLD.allow_negative
    OR NEW.is_system_account <> OLD.is_system_account
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'historical ledger account semantics are immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_accounts_protect_history
BEFORE UPDATE OR DELETE ON ledger_accounts
FOR EACH ROW EXECUTE FUNCTION a2a402_protect_ledger_account();

CREATE FUNCTION a2a402_validate_ledger_entry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  tx_status ledger_transaction_status;
  tx_asset varchar(32);
  tx_network varchar(64);
  account_asset varchar(32);
  account_network varchar(64);
  account_agent uuid;
  lot_asset varchar(32);
  lot_network varchar(64);
  lot_agent uuid;
BEGIN
  SELECT status, asset, network
    INTO tx_status, tx_asset, tx_network
  FROM ledger_transactions
  WHERE id = NEW.ledger_transaction_id
  FOR UPDATE;

  IF tx_status IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'ledger transaction does not exist';
  END IF;

  IF tx_status <> 'draft' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'entries can be appended only while a ledger transaction is draft';
  END IF;

  SELECT asset, network, agent_id
    INTO account_asset, account_network, account_agent
  FROM ledger_accounts
  WHERE id = NEW.ledger_account_id;

  IF account_asset <> tx_asset OR account_network <> tx_network THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'ledger entry account asset/network differs from transaction';
  END IF;

  IF NEW.capital_lot_id IS NOT NULL THEN
    SELECT asset, network, agent_id
      INTO lot_asset, lot_network, lot_agent
    FROM capital_lots
    WHERE id = NEW.capital_lot_id;

    IF lot_asset <> tx_asset OR lot_network <> tx_network THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'ledger entry capital lot asset/network differs from transaction';
    END IF;

    IF account_agent IS NOT NULL AND account_agent <> lot_agent THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'capital lot cannot be attributed to another agent ledger account';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_entries_validate
BEFORE INSERT ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION a2a402_validate_ledger_entry();

CREATE FUNCTION a2a402_validate_new_ledger_transaction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'draft' OR NEW.posted_at IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'ledger transactions must be created in draft state';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_transactions_start_draft
BEFORE INSERT ON ledger_transactions
FOR EACH ROW EXECUTE FUNCTION a2a402_validate_new_ledger_transaction();

CREATE FUNCTION a2a402_assert_ledger_transaction_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  debit_total numeric;
  credit_total numeric;
  entry_count bigint;
BEGIN
  SELECT
    COALESCE(sum(amount_minor) FILTER (WHERE direction = 'debit'), 0),
    COALESCE(sum(amount_minor) FILTER (WHERE direction = 'credit'), 0),
    count(*)
  INTO debit_total, credit_total, entry_count
  FROM ledger_entries
  WHERE ledger_transaction_id = NEW.ledger_transaction_id;

  IF entry_count < 2 OR debit_total <> credit_total THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format(
        'ledger transaction %s is unbalanced: %s debit, %s credit, %s entries',
        NEW.ledger_transaction_id,
        debit_total,
        credit_total,
        entry_count
      );
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_transaction_balanced_at_commit
AFTER INSERT ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION a2a402_assert_ledger_transaction_balanced();

CREATE FUNCTION a2a402_guard_ledger_transaction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  debit_total numeric;
  credit_total numeric;
  entry_count bigint;
  has_entries boolean;
  negative_account record;
  reversed_status ledger_transaction_status;
  reversed_asset varchar(32);
  reversed_network varchar(64);
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'posted ledger transactions are immutable; create a reversal';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'posted' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'posted ledger transactions are immutable; create a reversal';
  END IF;

  IF OLD.status = 'void' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'void ledger transactions are immutable';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM ledger_entries WHERE ledger_transaction_id = OLD.id
  ) INTO has_entries;

  IF has_entries AND (
    NEW.id <> OLD.id
    OR NEW.asset <> OLD.asset
    OR NEW.network <> OLD.network
    OR NEW.idempotency_key <> OLD.idempotency_key
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'ledger transaction identity, asset, and network are immutable after entries exist';
  END IF;

  IF OLD.status <> NEW.status AND NOT (
    OLD.status = 'draft' AND NEW.status IN ('posted', 'void')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'invalid ledger transaction status transition';
  END IF;

  IF NEW.status = 'posted' AND OLD.status <> 'posted' THEN
    SELECT
      COALESCE(sum(amount_minor) FILTER (WHERE direction = 'debit'), 0),
      COALESCE(sum(amount_minor) FILTER (WHERE direction = 'credit'), 0),
      count(*)
    INTO debit_total, credit_total, entry_count
    FROM ledger_entries
    WHERE ledger_transaction_id = NEW.id;

    IF entry_count < 2 OR debit_total <> credit_total THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'only a balanced ledger transaction with at least two entries can be posted';
    END IF;

    IF NEW.reverses_transaction_id IS NOT NULL THEN
      SELECT status, asset, network
        INTO reversed_status, reversed_asset, reversed_network
      FROM ledger_transactions
      WHERE id = NEW.reverses_transaction_id
      FOR UPDATE;

      IF reversed_status <> 'posted'
        OR reversed_asset <> NEW.asset
        OR reversed_network <> NEW.network
      THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'a reversal must reference a posted transaction with the same asset and network';
      END IF;
    END IF;

    SELECT balances.*
      INTO negative_account
    FROM (
      SELECT
        account.id,
        account.code,
        CASE account.normal_balance
          WHEN 'debit' THEN
            COALESCE(sum(
              CASE
                WHEN ledger_tx.id IS NULL THEN 0
                WHEN entry.direction = 'debit' THEN entry.amount_minor
                ELSE -entry.amount_minor
              END
            ), 0)
          ELSE
            COALESCE(sum(
              CASE
                WHEN ledger_tx.id IS NULL THEN 0
                WHEN entry.direction = 'credit' THEN entry.amount_minor
                ELSE -entry.amount_minor
              END
            ), 0)
        END AS balance_minor
      FROM ledger_accounts account
      LEFT JOIN ledger_entries entry ON entry.ledger_account_id = account.id
      LEFT JOIN ledger_transactions ledger_tx
        ON ledger_tx.id = entry.ledger_transaction_id
        AND (ledger_tx.status = 'posted' OR ledger_tx.id = NEW.id)
      WHERE account.allow_negative = false
        AND EXISTS (
          SELECT 1
          FROM ledger_entries current_entry
          WHERE current_entry.ledger_account_id = account.id
            AND current_entry.ledger_transaction_id = NEW.id
        )
      GROUP BY account.id, account.code, account.normal_balance
    ) balances
    WHERE balances.balance_minor < 0
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = format(
          'posting would make protected ledger account %s negative (%s minor units)',
          negative_account.code,
          negative_account.balance_minor
        );
    END IF;

    NEW.posted_at := COALESCE(NEW.posted_at, clock_timestamp());
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_transactions_guard
BEFORE UPDATE OR DELETE ON ledger_transactions
FOR EACH ROW EXECUTE FUNCTION a2a402_guard_ledger_transaction();
--> statement-breakpoint
CREATE FUNCTION a2a402_guard_audit_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  latest_hash varchar(64);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('a2a402.audit-chain'));

  SELECT event_hash INTO latest_hash
  FROM audit_events
  ORDER BY sequence DESC
  LIMIT 1;

  IF latest_hash IS NULL AND NEW.previous_event_hash IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'first audit event cannot reference a previous hash';
  ELSIF latest_hash IS NOT NULL AND NEW.previous_event_hash IS DISTINCT FROM latest_hash THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'audit event previous hash does not match the current chain head';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_events_chain
BEFORE INSERT ON audit_events
FOR EACH ROW EXECUTE FUNCTION a2a402_guard_audit_chain();
--> statement-breakpoint
CREATE VIEW ledger_account_balances AS
SELECT
  account.id AS ledger_account_id,
  account.agent_id,
  account.code,
  account.asset,
  account.network,
  account.balance_bucket,
  account.proof_of_earn_eligible,
  account.normal_balance,
  CASE account.normal_balance
    WHEN 'debit' THEN
      COALESCE(sum(
        CASE
          WHEN ledger_tx.id IS NULL THEN 0
          WHEN entry.direction = 'debit' THEN entry.amount_minor
          ELSE -entry.amount_minor
        END
      ), 0)::bigint
    ELSE
      COALESCE(sum(
        CASE
          WHEN ledger_tx.id IS NULL THEN 0
          WHEN entry.direction = 'credit' THEN entry.amount_minor
          ELSE -entry.amount_minor
        END
      ), 0)::bigint
  END AS balance_minor
FROM ledger_accounts account
LEFT JOIN ledger_entries entry ON entry.ledger_account_id = account.id
LEFT JOIN ledger_transactions ledger_tx
  ON ledger_tx.id = entry.ledger_transaction_id
  AND ledger_tx.status = 'posted'
GROUP BY
  account.id,
  account.agent_id,
  account.code,
  account.asset,
  account.network,
  account.balance_bucket,
  account.proof_of_earn_eligible,
  account.normal_balance;

CREATE VIEW agent_balance_buckets AS
SELECT
  agent_id,
  asset,
  network,
  balance_bucket,
  proof_of_earn_eligible,
  sum(balance_minor)::bigint AS balance_minor
FROM ledger_account_balances
WHERE agent_id IS NOT NULL
GROUP BY agent_id, asset, network, balance_bucket, proof_of_earn_eligible;

CREATE VIEW capital_lot_availability AS
SELECT
  lot.id AS capital_lot_id,
  lot.agent_id,
  lot.asset,
  lot.network,
  lot.origin_type,
  lot.status,
  lot.amount_minor,
  COALESCE(sum(
    CASE
      WHEN allocation.allocation_kind = 'reserve' THEN allocation.amount_minor
      WHEN allocation.allocation_kind IN ('release', 'spend') THEN -allocation.amount_minor
      ELSE 0
    END
  ), 0)::bigint AS reserved_minor,
  COALESCE(sum(
    CASE
      WHEN allocation.allocation_kind = 'spend' THEN allocation.amount_minor
      WHEN allocation.allocation_kind = 'refund' THEN -allocation.amount_minor
      ELSE 0
    END
  ), 0)::bigint AS spent_minor,
  (
    lot.amount_minor - COALESCE(sum(
      CASE
        WHEN allocation.allocation_kind = 'reserve' THEN allocation.amount_minor
        WHEN allocation.allocation_kind IN ('release', 'refund') THEN -allocation.amount_minor
        ELSE 0
      END
    ), 0)
  )::bigint AS available_minor
FROM capital_lots lot
LEFT JOIN capital_lot_allocations allocation
  ON allocation.capital_lot_id = lot.id
GROUP BY
  lot.id,
  lot.agent_id,
  lot.asset,
  lot.network,
  lot.origin_type,
  lot.status,
  lot.amount_minor;
