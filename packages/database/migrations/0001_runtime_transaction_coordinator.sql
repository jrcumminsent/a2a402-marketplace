ALTER TABLE capital_lots
  ADD COLUMN provenance_scope varchar(16);
UPDATE capital_lots
SET provenance_scope = CASE
  WHEN origin_type = 'platform_test_funds' THEN 'simulation'
  ELSE 'real'
END;
ALTER TABLE capital_lots
  ALTER COLUMN provenance_scope SET DEFAULT 'simulation',
  ALTER COLUMN provenance_scope SET NOT NULL,
  ADD CONSTRAINT capital_lot_provenance_scope_valid
    CHECK (provenance_scope IN ('simulation', 'real')),
  ADD CONSTRAINT capital_lot_test_funds_simulation_scope
    CHECK (origin_type <> 'platform_test_funds' OR provenance_scope = 'simulation');

ALTER TABLE contracts
  ADD COLUMN status_before_freeze contract_status,
  ADD COLUMN seller_acceptance_deadline timestamptz,
  ADD CONSTRAINT contract_status_before_freeze_valid
    CHECK (
      status_before_freeze IS NULL
      OR (status = 'frozen' AND status_before_freeze <> 'frozen')
    );
UPDATE contracts
SET seller_acceptance_deadline = GREATEST(
  created_at + interval '15 minutes',
  COALESCE(seller_accepted_at, created_at)
);
ALTER TABLE contracts
  ALTER COLUMN seller_acceptance_deadline SET NOT NULL,
  ADD CONSTRAINT contract_seller_acceptance_on_time
    CHECK (
      seller_accepted_at IS NULL
      OR seller_accepted_at <= seller_acceptance_deadline
    );
CREATE INDEX contract_seller_acceptance_due_idx
  ON contracts (status, seller_acceptance_deadline);

ALTER TABLE payment_intents
  RENAME COLUMN payment_requirement TO requirement_json;
ALTER TABLE payment_intents
  RENAME COLUMN verification_evidence TO verification_json;
ALTER TABLE payment_intents
  ADD CONSTRAINT payment_intent_requirement_object
    CHECK (jsonb_typeof(requirement_json) = 'object'),
  ADD CONSTRAINT payment_intent_verification_object
    CHECK (jsonb_typeof(verification_json) = 'object');

ALTER TABLE webhook_subscriptions
  ADD CONSTRAINT webhook_secret_ciphertext_nonempty
    CHECK (length(signing_secret_ciphertext) > 0);
--> statement-breakpoint
CREATE TABLE runtime_state_checkpoints (
  runtime_key varchar(160) PRIMARY KEY,
  runtime_mode varchar(16) NOT NULL,
  generation bigint NOT NULL,
  coordinator_schema_version integer NOT NULL DEFAULT 1,
  snapshot_format varchar(96) NOT NULL,
  snapshot_encoding varchar(64) NOT NULL,
  snapshot_payload text NOT NULL,
  snapshot_sha256 varchar(64) NOT NULL,
  writer_id varchar(128) NOT NULL,
  last_mutation_id varchar(200),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT runtime_checkpoint_mode_valid CHECK (runtime_mode IN ('simulation', 'real')),
  CONSTRAINT runtime_checkpoint_generation_positive CHECK (generation > 0),
  CONSTRAINT runtime_checkpoint_schema_version_positive CHECK (coordinator_schema_version > 0),
  CONSTRAINT runtime_checkpoint_payload_nonempty CHECK (length(snapshot_payload) > 0),
  CONSTRAINT runtime_checkpoint_sha256_valid CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT runtime_checkpoint_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX runtime_checkpoint_mode_updated_idx
  ON runtime_state_checkpoints (runtime_mode, updated_at);

CREATE TABLE runtime_state_transitions (
  sequence bigserial PRIMARY KEY,
  runtime_key varchar(160) NOT NULL REFERENCES runtime_state_checkpoints(runtime_key) ON DELETE RESTRICT,
  runtime_mode varchar(16) NOT NULL,
  from_generation bigint,
  to_generation bigint NOT NULL,
  snapshot_format varchar(96) NOT NULL,
  snapshot_encoding varchar(64) NOT NULL,
  snapshot_sha256 varchar(64) NOT NULL,
  writer_id varchar(128) NOT NULL,
  mutation_id varchar(200),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT runtime_transition_generation_unique UNIQUE (runtime_key, to_generation),
  CONSTRAINT runtime_transition_mode_valid CHECK (runtime_mode IN ('simulation', 'real')),
  CONSTRAINT runtime_transition_generation_positive CHECK (to_generation > 0),
  CONSTRAINT runtime_transition_generation_step CHECK (
    from_generation IS NULL OR to_generation = from_generation + 1
  ),
  CONSTRAINT runtime_transition_sha256_valid CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT runtime_transition_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX runtime_transition_created_idx
  ON runtime_state_transitions (runtime_key, created_at);
--> statement-breakpoint
CREATE FUNCTION a2a402_guard_runtime_checkpoint()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.runtime_key <> OLD.runtime_key THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'runtime checkpoint key is immutable';
  END IF;

  IF NEW.runtime_mode <> OLD.runtime_mode THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'runtime checkpoint mode is immutable; use a separate runtime key';
  END IF;

  IF NEW.coordinator_schema_version < OLD.coordinator_schema_version THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'runtime coordinator schema version cannot decrease';
  END IF;

  IF NEW.generation <> OLD.generation + 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'runtime checkpoint generation must advance exactly once';
  END IF;

  IF NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'runtime checkpoint creation timestamp is immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER runtime_checkpoint_guard
BEFORE UPDATE ON runtime_state_checkpoints
FOR EACH ROW EXECUTE FUNCTION a2a402_guard_runtime_checkpoint();

CREATE TRIGGER runtime_checkpoint_delete_prohibited
BEFORE DELETE ON runtime_state_checkpoints
FOR EACH ROW EXECUTE FUNCTION a2a402_reject_mutation();
--> statement-breakpoint
CREATE FUNCTION a2a402_record_runtime_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO runtime_state_transitions (
    runtime_key,
    runtime_mode,
    from_generation,
    to_generation,
    snapshot_format,
    snapshot_encoding,
    snapshot_sha256,
    writer_id,
    mutation_id,
    metadata
  )
  VALUES (
    NEW.runtime_key,
    NEW.runtime_mode,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.generation END,
    NEW.generation,
    NEW.snapshot_format,
    NEW.snapshot_encoding,
    NEW.snapshot_sha256,
    NEW.writer_id,
    NEW.last_mutation_id,
    NEW.metadata
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER runtime_checkpoint_transition
AFTER INSERT OR UPDATE ON runtime_state_checkpoints
FOR EACH ROW EXECUTE FUNCTION a2a402_record_runtime_transition();

CREATE TRIGGER runtime_transition_append_only
BEFORE UPDATE OR DELETE ON runtime_state_transitions
FOR EACH ROW EXECUTE FUNCTION a2a402_reject_mutation();
--> statement-breakpoint
CREATE FUNCTION a2a402_guard_capital_lot_provenance_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.provenance_scope <> OLD.provenance_scope THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'capital lot provenance scope is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER capital_lot_provenance_scope_immutable
BEFORE UPDATE ON capital_lots
FOR EACH ROW EXECUTE FUNCTION a2a402_guard_capital_lot_provenance_scope();
