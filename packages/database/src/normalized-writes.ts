import { createHash } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";

import { RuntimeCoordinatorError } from "./runtime-mode.js";

const NORMALIZED_WRITE_HASH_KEY = "a2a402_normalized_write_sha256";

function invalid(message: string, details: Record<string, unknown> = {}): never {
  throw new RuntimeCoordinatorError(
    "NORMALIZED_WRITE_INVALID",
    message,
    details,
  );
}

function conflict(
  message: string,
  details: Record<string, unknown> = {},
): never {
  throw new RuntimeCoordinatorError(
    "NORMALIZED_WRITE_CONFLICT",
    message,
    details,
  );
}

function canonicalize(value: unknown, path = "$"): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      invalid("Normalized JSON cannot contain non-finite numbers.", { path });
    }
    return value;
  }
  if (typeof value === "bigint") {
    invalid("Bigint values must be decimal strings at JSON boundaries.", {
      path,
    });
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      canonicalize(item, `${path}[${index}]`),
    );
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      invalid("Normalized JSON accepts only plain objects.", { path });
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [
          key,
          canonicalize(child, `${path}.${key}`),
        ]),
    );
  }
  invalid("Normalized JSON contains an unsupported value.", {
    path,
    value_type: typeof value,
  });
}

export function normalizedJsonSha256(value: unknown): string {
  const canonical = JSON.stringify(canonicalize(value));
  if (canonical === undefined) {
    invalid("Normalized JSON serialization produced no value.");
  }
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export async function acquireTransactionAdvisoryLock(
  client: PoolClient,
  key: string,
): Promise<void> {
  if (!key || key.length > 512) {
    invalid("Advisory lock keys must contain 1-512 characters.");
  }
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
    [key],
  );
}

export type LedgerDirection = "debit" | "credit";

export interface NormalizedLedgerEntryInput {
  ledgerAccountId: string;
  direction: LedgerDirection;
  amountMinor: bigint;
  capitalLotId?: string | null;
  memo?: string | null;
}

export interface PostNormalizedLedgerTransactionInput {
  transactionType: string;
  asset: string;
  network: string;
  idempotencyKey: string;
  description: string;
  entries: readonly NormalizedLedgerEntryInput[];
  contractId?: string | null;
  settlementId?: string | null;
  paymentIntentId?: string | null;
  reversesTransactionId?: string | null;
  metadata?: Record<string, unknown>;
  effectiveAt?: Date;
}

export interface PostedNormalizedLedgerTransaction {
  transactionId: string;
  replayed: boolean;
  entryCount: number;
  debitMinor: bigint;
  creditMinor: bigint;
}

interface ExistingLedgerRow extends QueryResultRow {
  id: string;
  status: string;
  asset: string;
  network: string;
  metadata: Record<string, unknown>;
}

interface LedgerAccountRow extends QueryResultRow {
  id: string;
  asset: string;
  network: string;
}

interface IdRow extends QueryResultRow {
  id: string;
}

function ledgerWriteShape(
  input: PostNormalizedLedgerTransactionInput,
): Record<string, unknown> {
  return {
    transaction_type: input.transactionType,
    asset: input.asset,
    network: input.network,
    idempotency_key: input.idempotencyKey,
    description: input.description,
    contract_id: input.contractId ?? null,
    settlement_id: input.settlementId ?? null,
    payment_intent_id: input.paymentIntentId ?? null,
    reverses_transaction_id: input.reversesTransactionId ?? null,
    metadata: canonicalize(input.metadata ?? {}),
    effective_at: input.effectiveAt?.toISOString() ?? null,
    entries: input.entries
      .map((entry) => ({
        ledger_account_id: entry.ledgerAccountId,
        direction: entry.direction,
        amount_minor: entry.amountMinor.toString(),
        capital_lot_id: entry.capitalLotId ?? null,
        memo: entry.memo ?? null,
      }))
      .sort((left, right) => {
        const encodedLeft = JSON.stringify(left) ?? "";
        const encodedRight = JSON.stringify(right) ?? "";
        return encodedLeft < encodedRight
          ? -1
          : encodedLeft > encodedRight
            ? 1
            : 0;
      }),
  };
}

function validateLedgerInput(
  input: PostNormalizedLedgerTransactionInput,
): { debitMinor: bigint; creditMinor: bigint; writeHash: string } {
  if (input.entries.length < 2) {
    invalid("A ledger transaction requires at least two entries.");
  }
  if (!input.idempotencyKey || input.idempotencyKey.length > 128) {
    invalid("Ledger idempotency keys must contain 1-128 characters.");
  }
  if (!input.transactionType || input.transactionType.length > 64) {
    invalid("Ledger transaction types must contain 1-64 characters.");
  }
  if (!input.asset || !input.network) {
    invalid("Ledger asset and network are required.");
  }

  let debitMinor = 0n;
  let creditMinor = 0n;
  for (const [index, entry] of input.entries.entries()) {
    if (entry.amountMinor <= 0n) {
      invalid("Ledger entry amounts must be positive.", { entry_index: index });
    }
    if (entry.direction === "debit") debitMinor += entry.amountMinor;
    else if (entry.direction === "credit") creditMinor += entry.amountMinor;
    else invalid("Ledger entry direction must be debit or credit.", {
      entry_index: index,
    });
  }
  if (debitMinor !== creditMinor) {
    invalid("Ledger transaction is not balanced.", {
      debit_minor: debitMinor.toString(),
      credit_minor: creditMinor.toString(),
    });
  }

  return {
    debitMinor,
    creditMinor,
    writeHash: normalizedJsonSha256(ledgerWriteShape(input)),
  };
}

/**
 * Inserts and posts a balanced ledger transaction inside the caller's current
 * PostgreSQL transaction. Account rows are locked in stable UUID order, while
 * database triggers enforce asset/network compatibility, non-negative
 * protected balances, and posted-entry immutability.
 */
export async function postNormalizedLedgerTransaction(
  client: PoolClient,
  input: PostNormalizedLedgerTransactionInput,
): Promise<PostedNormalizedLedgerTransaction> {
  const { debitMinor, creditMinor, writeHash } = validateLedgerInput(input);
  await acquireTransactionAdvisoryLock(
    client,
    `a2a402:ledger:${input.idempotencyKey}`,
  );

  const existingResult = await client.query<ExistingLedgerRow>(
    `SELECT id, status, asset, network, metadata
       FROM ledger_transactions
      WHERE idempotency_key = $1
      FOR UPDATE`,
    [input.idempotencyKey],
  );
  const existing = existingResult.rows[0];
  if (existing) {
    if (
      existing.metadata?.[NORMALIZED_WRITE_HASH_KEY] !== writeHash ||
      existing.asset !== input.asset ||
      existing.network !== input.network
    ) {
      conflict("Ledger idempotency key was reused with different economic input.", {
        idempotency_key: input.idempotencyKey,
        transaction_id: existing.id,
      });
    }
    if (existing.status !== "posted") {
      conflict("Existing ledger transaction is not posted.", {
        transaction_id: existing.id,
        status: existing.status,
      });
    }
    return {
      transactionId: existing.id,
      replayed: true,
      entryCount: input.entries.length,
      debitMinor,
      creditMinor,
    };
  }

  const accountIds = [
    ...new Set(input.entries.map((entry) => entry.ledgerAccountId)),
  ].sort();
  const accountsResult = await client.query<LedgerAccountRow>(
    `SELECT id, asset, network
       FROM ledger_accounts
      WHERE id = ANY($1::uuid[])
      ORDER BY id
      FOR UPDATE`,
    [accountIds],
  );
  if (accountsResult.rows.length !== accountIds.length) {
    const found = new Set(accountsResult.rows.map((row) => row.id));
    invalid("One or more ledger accounts do not exist.", {
      missing_account_ids: accountIds.filter((id) => !found.has(id)),
    });
  }
  for (const account of accountsResult.rows) {
    if (account.asset !== input.asset || account.network !== input.network) {
      invalid("Ledger account asset/network differs from the transaction.", {
        ledger_account_id: account.id,
        account_asset: account.asset,
        account_network: account.network,
      });
    }
  }

  const metadata = {
    ...(canonicalize(input.metadata ?? {}) as Record<string, unknown>),
    [NORMALIZED_WRITE_HASH_KEY]: writeHash,
  };
  const transactionResult = await client.query<IdRow>(
    `INSERT INTO ledger_transactions (
       transaction_type,
       status,
       asset,
       network,
       contract_id,
       settlement_id,
       payment_intent_id,
       reverses_transaction_id,
       idempotency_key,
       description,
       metadata,
       effective_at
     )
     VALUES ($1, 'draft', $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, COALESCE($11, now()))
     RETURNING id`,
    [
      input.transactionType,
      input.asset,
      input.network,
      input.contractId ?? null,
      input.settlementId ?? null,
      input.paymentIntentId ?? null,
      input.reversesTransactionId ?? null,
      input.idempotencyKey,
      input.description,
      JSON.stringify(metadata),
      input.effectiveAt ?? null,
    ],
  );
  const transactionId = transactionResult.rows[0]?.id;
  if (!transactionId) {
    throw new RuntimeCoordinatorError(
      "NORMALIZED_WRITE_INVALID",
      "PostgreSQL did not return the inserted ledger transaction.",
    );
  }

  for (const entry of input.entries) {
    await client.query(
      `INSERT INTO ledger_entries (
         ledger_transaction_id,
         ledger_account_id,
         direction,
         amount_minor,
         capital_lot_id,
         memo
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        transactionId,
        entry.ledgerAccountId,
        entry.direction,
        entry.amountMinor.toString(),
        entry.capitalLotId ?? null,
        entry.memo ?? null,
      ],
    );
  }

  await client.query(
    `UPDATE ledger_transactions
        SET status = 'posted', posted_at = now()
      WHERE id = $1`,
    [transactionId],
  );

  return {
    transactionId,
    replayed: false,
    entryCount: input.entries.length,
    debitMinor,
    creditMinor,
  };
}

export interface ClaimIdempotencyInput {
  scope: string;
  key: string;
  requestHash: string;
  method: string;
  path: string;
  actorAgentId?: string | null;
  lockForMs?: number;
  expiresInMs?: number;
  now?: Date;
}

export type IdempotencyClaim =
  | {
      state: "claimed";
      recordId: string;
      takeover: boolean;
      lockedUntil: Date;
      expiresAt: Date;
    }
  | {
      state: "in_progress";
      recordId: string;
      lockedUntil: Date;
      expiresAt: Date;
    }
  | {
      state: "replay";
      recordId: string;
      outcome: "completed" | "failed";
      responseStatus: number | null;
      responseBody: unknown;
      responseHeaders: Record<string, string>;
      expiresAt: Date;
    };

interface IdempotencyRow extends QueryResultRow {
  id: string;
  requestHash: string;
  status: "processing" | "completed" | "failed";
  responseStatus: number | null;
  responseBody: unknown;
  responseHeaders: Record<string, string>;
  lockedUntil: Date;
  expiresAt: Date;
}

function sha256Hex(value: string, name: string): string {
  const normalized = value.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    invalid(`${name} must be a SHA-256 hex string.`);
  }
  return normalized;
}

/**
 * Claims an idempotency record under a transaction-scoped advisory lock.
 * Completed/failed records replay their stored response; abandoned processing
 * records can be taken over only after their lease expires.
 */
export async function claimIdempotencyRecord(
  client: PoolClient,
  input: ClaimIdempotencyInput,
): Promise<IdempotencyClaim> {
  if (!input.scope || input.scope.length > 128) {
    invalid("Idempotency scopes must contain 1-128 characters.");
  }
  if (!input.key || input.key.length > 128) {
    invalid("Idempotency keys must contain 1-128 characters.");
  }
  const requestHash = sha256Hex(input.requestHash, "requestHash");
  const now = input.now ?? new Date();
  const lockForMs = input.lockForMs ?? 30_000;
  const expiresInMs = input.expiresInMs ?? 86_400_000;
  if (
    !Number.isSafeInteger(lockForMs) ||
    lockForMs <= 0 ||
    !Number.isSafeInteger(expiresInMs) ||
    expiresInMs <= lockForMs
  ) {
    invalid("Idempotency lease and expiration durations are invalid.");
  }
  const lockedUntil = new Date(now.getTime() + lockForMs);
  const expiresAt = new Date(now.getTime() + expiresInMs);

  await acquireTransactionAdvisoryLock(
    client,
    `a2a402:idempotency:${input.scope}:${input.key}`,
  );
  const existingResult = await client.query<IdempotencyRow>(
    `SELECT
       id,
       request_hash AS "requestHash",
       status,
       response_status AS "responseStatus",
       response_body AS "responseBody",
       response_headers AS "responseHeaders",
       locked_until AS "lockedUntil",
       expires_at AS "expiresAt"
     FROM idempotency_records
     WHERE scope = $1 AND key = $2
     FOR UPDATE`,
    [input.scope, input.key],
  );
  const existing = existingResult.rows[0];

  if (!existing) {
    const inserted = await client.query<IdRow>(
      `INSERT INTO idempotency_records (
         scope,
         key,
         actor_agent_id,
         method,
         path,
         request_hash,
         status,
         locked_until,
         expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'processing', $7, $8)
       RETURNING id`,
      [
        input.scope,
        input.key,
        input.actorAgentId ?? null,
        input.method,
        input.path,
        requestHash,
        lockedUntil,
        expiresAt,
      ],
    );
    const recordId = inserted.rows[0]?.id;
    if (!recordId) {
      throw new RuntimeCoordinatorError(
        "NORMALIZED_WRITE_INVALID",
        "PostgreSQL did not return the inserted idempotency record.",
      );
    }
    return {
      state: "claimed",
      recordId,
      takeover: false,
      lockedUntil,
      expiresAt,
    };
  }

  if (existing.expiresAt.getTime() <= now.getTime()) {
    await client.query(
      `UPDATE idempotency_records
          SET actor_agent_id = $2,
              method = $3,
              path = $4,
              request_hash = $5,
              status = 'processing',
              response_status = NULL,
              response_body = NULL,
              response_headers = '{}'::jsonb,
              locked_until = $6,
              expires_at = $7,
              updated_at = $1
        WHERE id = $8`,
      [
        now,
        input.actorAgentId ?? null,
        input.method,
        input.path,
        requestHash,
        lockedUntil,
        expiresAt,
        existing.id,
      ],
    );
    return {
      state: "claimed",
      recordId: existing.id,
      takeover: true,
      lockedUntil,
      expiresAt,
    };
  }

  if (existing.requestHash !== requestHash) {
    conflict("Idempotency key was reused with a different request.", {
      scope: input.scope,
      key: input.key,
    });
  }
  if (existing.status === "completed" || existing.status === "failed") {
    return {
      state: "replay",
      recordId: existing.id,
      outcome: existing.status,
      responseStatus: existing.responseStatus,
      responseBody: existing.responseBody,
      responseHeaders: existing.responseHeaders,
      expiresAt: existing.expiresAt,
    };
  }
  if (existing.lockedUntil.getTime() > now.getTime()) {
    return {
      state: "in_progress",
      recordId: existing.id,
      lockedUntil: existing.lockedUntil,
      expiresAt: existing.expiresAt,
    };
  }

  await client.query(
    `UPDATE idempotency_records
        SET locked_until = $1, expires_at = $2, updated_at = $3
      WHERE id = $4`,
    [lockedUntil, expiresAt, now, existing.id],
  );
  return {
    state: "claimed",
    recordId: existing.id,
    takeover: true,
    lockedUntil,
    expiresAt,
  };
}

export interface CompleteIdempotencyInput {
  recordId: string;
  outcome: "completed" | "failed";
  responseStatus: number;
  responseBody: unknown;
  responseHeaders?: Record<string, string>;
  now?: Date;
}

export async function completeIdempotencyRecord(
  client: PoolClient,
  input: CompleteIdempotencyInput,
): Promise<void> {
  if (
    !Number.isSafeInteger(input.responseStatus) ||
    input.responseStatus < 100 ||
    input.responseStatus > 599
  ) {
    invalid("Idempotency responseStatus must be an HTTP status code.");
  }
  const responseBody = canonicalize(input.responseBody);
  const responseHeaders = canonicalize(
    input.responseHeaders ?? {},
  ) as Record<string, unknown>;
  const updated = await client.query<IdRow>(
    `UPDATE idempotency_records
        SET status = $2,
            response_status = $3,
            response_body = $4::jsonb,
            response_headers = $5::jsonb,
            locked_until = $6,
            updated_at = $6
      WHERE id = $1 AND status = 'processing'
      RETURNING id`,
    [
      input.recordId,
      input.outcome,
      input.responseStatus,
      JSON.stringify(responseBody),
      JSON.stringify(responseHeaders),
      input.now ?? new Date(),
    ],
  );
  if (!updated.rows[0]) {
    conflict("Idempotency record is missing or no longer processing.", {
      record_id: input.recordId,
    });
  }
}

export interface EnqueueOutboxEventInput {
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: bigint;
  eventType: string;
  payload: Record<string, unknown>;
  protocolVersion?: string;
  marketplaceSignature?: string | null;
  availableAt?: Date;
}

export interface EnqueuedOutboxEvent {
  eventId: string;
  payloadSha256: string;
  replayed: boolean;
}

interface ExistingOutboxRow extends QueryResultRow {
  id: string;
  eventType: string;
  protocolVersion: string;
  payloadSha256: string;
  marketplaceSignature: string | null;
}

/**
 * Enqueues an outbox event in the caller's transaction, making domain writes
 * and publication intent atomic. Aggregate/version is the idempotency key.
 */
export async function enqueueNormalizedOutboxEvent(
  client: PoolClient,
  input: EnqueueOutboxEventInput,
): Promise<EnqueuedOutboxEvent> {
  if (input.aggregateVersion <= 0n) {
    invalid("Outbox aggregateVersion must be positive.");
  }
  const payload = canonicalize(input.payload) as Record<string, unknown>;
  const payloadSha256 = normalizedJsonSha256(payload);
  const protocolVersion = input.protocolVersion ?? "a2a402/0.1";

  await acquireTransactionAdvisoryLock(
    client,
    `a2a402:outbox:${input.aggregateType}:${input.aggregateId}:${input.aggregateVersion.toString()}`,
  );
  const existingResult = await client.query<ExistingOutboxRow>(
    `SELECT
       id,
       event_type AS "eventType",
       protocol_version AS "protocolVersion",
       payload_sha256 AS "payloadSha256",
       marketplace_signature AS "marketplaceSignature"
     FROM outbox_events
     WHERE aggregate_type = $1
       AND aggregate_id = $2
       AND aggregate_version = $3
     FOR UPDATE`,
    [
      input.aggregateType,
      input.aggregateId,
      input.aggregateVersion.toString(),
    ],
  );
  const existing = existingResult.rows[0];
  if (existing) {
    if (
      existing.eventType !== input.eventType ||
      existing.protocolVersion !== protocolVersion ||
      existing.payloadSha256 !== payloadSha256 ||
      existing.marketplaceSignature !== (input.marketplaceSignature ?? null)
    ) {
      conflict("Outbox aggregate version was reused with different event data.", {
        aggregate_type: input.aggregateType,
        aggregate_id: input.aggregateId,
        aggregate_version: input.aggregateVersion.toString(),
      });
    }
    return {
      eventId: existing.id,
      payloadSha256,
      replayed: true,
    };
  }

  const inserted = await client.query<IdRow>(
    `INSERT INTO outbox_events (
       aggregate_type,
       aggregate_id,
       aggregate_version,
       event_type,
       protocol_version,
       payload,
       payload_sha256,
       marketplace_signature,
       status,
       available_at
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'pending', COALESCE($9, now()))
     RETURNING id`,
    [
      input.aggregateType,
      input.aggregateId,
      input.aggregateVersion.toString(),
      input.eventType,
      protocolVersion,
      JSON.stringify(payload),
      payloadSha256,
      input.marketplaceSignature ?? null,
      input.availableAt ?? null,
    ],
  );
  const eventId = inserted.rows[0]?.id;
  if (!eventId) {
    throw new RuntimeCoordinatorError(
      "NORMALIZED_WRITE_INVALID",
      "PostgreSQL did not return the inserted outbox event.",
    );
  }
  return { eventId, payloadSha256, replayed: false };
}
