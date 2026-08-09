import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";

import { createDatabaseClient, type DatabaseClient } from "./client.js";
import {
  acquireTransactionAdvisoryLock,
  claimIdempotencyRecord,
  completeIdempotencyRecord,
  enqueueNormalizedOutboxEvent,
  postNormalizedLedgerTransaction,
  type ClaimIdempotencyInput,
  type CompleteIdempotencyInput,
  type EnqueueOutboxEventInput,
  type EnqueuedOutboxEvent,
  type IdempotencyClaim,
  type PostedNormalizedLedgerTransaction,
  type PostNormalizedLedgerTransactionInput,
} from "./normalized-writes.js";
import {
  decodeLegacySnapshotEnvelope,
  decodeRuntimeSnapshot,
  encodeRuntimeSnapshot,
  inferRuntimeSnapshotFormat,
  RUNTIME_SNAPSHOT_ENCODING,
  RuntimeSnapshotCodecError,
} from "./runtime-codec.js";
import {
  assertRuntimeSnapshotCompatible,
  RuntimeCoordinatorError,
  type RuntimeMode,
} from "./runtime-mode.js";

export const DEFAULT_RUNTIME_KEY = "runtime.engine_snapshot";
export const RUNTIME_COORDINATOR_SCHEMA_VERSION = 1;

const RETRYABLE_POSTGRES_CODES = new Set(["40001", "40P01"]);

export function isRetryablePostgresTransactionError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    RETRYABLE_POSTGRES_CODES.has((error as { code: string }).code)
  );
}

export interface RuntimeCheckpoint {
  runtimeKey: string;
  runtimeMode: RuntimeMode;
  generation: bigint;
  coordinatorSchemaVersion: number;
  snapshotFormat: string;
  snapshotEncoding: string;
  snapshotSha256: string;
  snapshot: unknown;
  writerId: string;
  lastMutationId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface RuntimeCheckpointRow extends QueryResultRow {
  runtimeKey: string;
  runtimeMode: string;
  generation: string;
  coordinatorSchemaVersion: number;
  snapshotFormat: string;
  snapshotEncoding: string;
  snapshotPayload: string;
  snapshotSha256: string;
  writerId: string;
  lastMutationId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface LegacySnapshotRow extends QueryResultRow {
  value: unknown;
}

export interface SerializableRuntimeTransaction {
  readonly client: PoolClient;
  readonly runtimeMode: RuntimeMode;
  readonly writerId: string;
  readonly attempt: number;
  lock(key: string): Promise<void>;
  postLedgerTransaction(
    input: PostNormalizedLedgerTransactionInput,
  ): Promise<PostedNormalizedLedgerTransaction>;
  claimIdempotency(input: ClaimIdempotencyInput): Promise<IdempotencyClaim>;
  completeIdempotency(input: CompleteIdempotencyInput): Promise<void>;
  enqueueOutbox(
    input: EnqueueOutboxEventInput,
  ): Promise<EnqueuedOutboxEvent>;
}

export interface SerializableTransactionOptions {
  /**
   * Lock names are deduplicated and sorted before acquisition. Callers should
   * declare all aggregate/capital keys up front to guarantee global ordering.
   */
  lockKeys?: readonly string[];
}

export interface RuntimeTransactionCoordinatorOptions {
  runtimeMode: RuntimeMode;
  client?: DatabaseClient;
  connectionString?: string;
  closeClient?: boolean;
  runtimeKey?: string;
  writerId?: string;
  maxRetries?: number;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
  legacySettingKey?: string;
  migrateLegacySimulationState?: boolean;
}

export interface SaveRuntimeCheckpointOptions {
  /**
   * `null` means the caller observed no checkpoint. A bigint is a strict CAS
   * generation. Omitting optimistic concurrency is intentionally unsupported.
   */
  expectedGeneration: bigint | null;
  snapshotFormat?: string;
  mutationId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RuntimeMutationOutput<TResult> {
  snapshot: unknown;
  result: TResult;
  snapshotFormat?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeMutationOptions extends SerializableTransactionOptions {
  mutationId?: string | null;
}

export interface RuntimeMutationResult<TResult> {
  result: TResult;
  checkpoint: RuntimeCheckpoint;
}

export type RuntimeCheckpointReader<TResult> = (
  current: RuntimeCheckpoint | null,
) => TResult | Promise<TResult>;

function validateIdentifier(
  value: string,
  name: string,
  maximumLength: number,
): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    throw new RuntimeCoordinatorError(
      "NORMALIZED_WRITE_INVALID",
      `${name} must contain 1-${maximumLength} characters.`,
    );
  }
  return normalized;
}

function jsonMetadata(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> {
  try {
    const encoded = JSON.stringify(value ?? {}, (_key, child: unknown) => {
      if (typeof child === "bigint") {
        throw new TypeError(
          "Bigint metadata must be encoded as a decimal string.",
        );
      }
      return child;
    });
    if (encoded === undefined) {
      throw new TypeError("Runtime checkpoint metadata produced no JSON.");
    }
    const decoded = JSON.parse(encoded) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      throw new TypeError("Runtime checkpoint metadata must be an object.");
    }
    return decoded as Record<string, unknown>;
  } catch (error) {
    throw new RuntimeCoordinatorError(
      "NORMALIZED_WRITE_INVALID",
      "Runtime checkpoint metadata is not JSON serializable.",
      {},
      { cause: error },
    );
  }
}

function normalizeMutationId(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return validateIdentifier(value, "mutationId", 200);
}

function normalizeSnapshotFormat(value: string): string {
  return validateIdentifier(value, "snapshotFormat", 96);
}

function normalizeDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new RuntimeCoordinatorError(
      "RUNTIME_STATE_CORRUPT",
      "Runtime checkpoint contains an invalid timestamp.",
    );
  }
  return date;
}

function runtimeMode(value: string): RuntimeMode {
  if (value === "simulation" || value === "real") return value;
  throw new RuntimeCoordinatorError(
    "RUNTIME_STATE_CORRUPT",
    "Runtime checkpoint contains an unsupported mode.",
    { runtime_mode: value },
  );
}

function checkpointSelect(forUpdate: boolean): string {
  return `SELECT
    runtime_key AS "runtimeKey",
    runtime_mode AS "runtimeMode",
    generation::text AS generation,
    coordinator_schema_version AS "coordinatorSchemaVersion",
    snapshot_format AS "snapshotFormat",
    snapshot_encoding AS "snapshotEncoding",
    snapshot_payload AS "snapshotPayload",
    snapshot_sha256 AS "snapshotSha256",
    writer_id AS "writerId",
    last_mutation_id AS "lastMutationId",
    metadata,
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  FROM runtime_state_checkpoints
  WHERE runtime_key = $1${forUpdate ? " FOR UPDATE" : ""}`;
}

function checkpointFromRow(row: RuntimeCheckpointRow): RuntimeCheckpoint {
  let snapshot: unknown;
  try {
    snapshot = decodeRuntimeSnapshot({
      encoding: row.snapshotEncoding,
      payload: row.snapshotPayload,
      sha256: row.snapshotSha256,
    });
  } catch (error) {
    if (error instanceof RuntimeSnapshotCodecError) {
      throw new RuntimeCoordinatorError(
        "RUNTIME_STATE_CORRUPT",
        error.message,
        { runtime_key: row.runtimeKey },
        { cause: error },
      );
    }
    throw error;
  }

  return {
    runtimeKey: row.runtimeKey,
    runtimeMode: runtimeMode(row.runtimeMode),
    generation: BigInt(row.generation),
    coordinatorSchemaVersion: row.coordinatorSchemaVersion,
    snapshotFormat: row.snapshotFormat,
    snapshotEncoding: row.snapshotEncoding,
    snapshotSha256: row.snapshotSha256,
    snapshot,
    writerId: row.writerId,
    lastMutationId: row.lastMutationId,
    metadata: row.metadata,
    createdAt: normalizeDate(row.createdAt),
    updatedAt: normalizeDate(row.updatedAt),
  };
}

function modeMismatch(
  runtimeKey: string,
  expected: RuntimeMode,
  actual: RuntimeMode,
): never {
  throw new RuntimeCoordinatorError(
    "RUNTIME_MODE_MISMATCH",
    "Runtime checkpoint mode does not match this process. Cross-mode state access is prohibited.",
    {
      runtime_key: runtimeKey,
      expected_mode: expected,
      checkpoint_mode: actual,
    },
  );
}

/**
 * PostgreSQL runtime coordinator.
 *
 * Every callback runs in `SERIALIZABLE READ WRITE`, with transaction-scoped
 * advisory locks plus row locks. SQLSTATE 40001/40P01 retries create a new
 * transaction and re-run the callback, so callbacks must not perform external
 * side effects. Ledger/idempotency/outbox helpers share the same transaction.
 */
export class RuntimeTransactionCoordinator {
  readonly runtimeMode: RuntimeMode;
  readonly runtimeKey: string;
  readonly writerId: string;

  private readonly client: DatabaseClient;
  private readonly shouldCloseClient: boolean;
  private readonly maxRetries: number;
  private readonly lockTimeoutMs: number;
  private readonly statementTimeoutMs: number;
  private readonly legacySettingKey: string;
  private readonly migrateLegacySimulationState: boolean;
  private readonly inFlight = new Set<Promise<unknown>>();
  private closing = false;
  private closePromise: Promise<void> | undefined;

  constructor(options: RuntimeTransactionCoordinatorOptions) {
    this.runtimeMode = options.runtimeMode;
    this.runtimeKey = validateIdentifier(
      options.runtimeKey ?? DEFAULT_RUNTIME_KEY,
      "runtimeKey",
      160,
    );
    this.writerId = validateIdentifier(
      options.writerId ?? `runtime-${process.pid}-${randomUUID()}`,
      "writerId",
      128,
    );
    this.client =
      options.client ?? createDatabaseClient(options.connectionString);
    this.shouldCloseClient =
      options.closeClient ?? options.client === undefined;
    this.maxRetries = options.maxRetries ?? 4;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 10_000;
    this.statementTimeoutMs = options.statementTimeoutMs ?? 30_000;
    this.legacySettingKey = validateIdentifier(
      options.legacySettingKey ?? this.runtimeKey,
      "legacySettingKey",
      160,
    );
    this.migrateLegacySimulationState =
      options.migrateLegacySimulationState ?? true;

    if (
      !Number.isSafeInteger(this.maxRetries) ||
      this.maxRetries < 0 ||
      this.maxRetries > 20
    ) {
      throw new RuntimeCoordinatorError(
        "NORMALIZED_WRITE_INVALID",
        "maxRetries must be an integer between 0 and 20.",
      );
    }
    if (
      !Number.isSafeInteger(this.lockTimeoutMs) ||
      this.lockTimeoutMs <= 0 ||
      !Number.isSafeInteger(this.statementTimeoutMs) ||
      this.statementTimeoutMs <= 0
    ) {
      throw new RuntimeCoordinatorError(
        "NORMALIZED_WRITE_INVALID",
        "Transaction timeouts must be positive safe integers.",
      );
    }
  }

  load(): Promise<RuntimeCheckpoint | null> {
    return this.runSerializable(
      async (transaction) =>
        this.readCheckpoint(transaction.client, {
          forUpdate: true,
          migrateLegacy: this.migrateLegacySimulationState,
        }),
      { lockKeys: [this.runtimeLockKey()] },
    );
  }

  /**
   * Reads the latest checkpoint while holding the same ordered runtime
   * advisory lock used by mutations. The callback cannot issue database
   * writes through this API, and the checkpoint generation is not advanced.
   *
   * Call load() once during process initialization to import any legacy
   * simulation checkpoint. Public reads should then restore the snapshot
   * supplied here before evaluating engine state.
   */
  read<TResult>(reader: RuntimeCheckpointReader<TResult>): Promise<TResult> {
    return this.runSerializable(
      async (transaction) => {
        const current = await this.readCheckpoint(transaction.client, {
          forUpdate: false,
          migrateLegacy: false,
        });
        return reader(current);
      },
      { lockKeys: [this.runtimeLockKey()] },
    );
  }

  save(
    snapshot: unknown,
    options: SaveRuntimeCheckpointOptions,
  ): Promise<RuntimeCheckpoint> {
    // Encode before entering/retrying the transaction so later caller mutation
    // cannot change the durable payload.
    const prepared = this.prepareSnapshot(
      snapshot,
      options.snapshotFormat,
      options.metadata,
      options.mutationId,
    );
    return this.runSerializable(
      async (transaction) => {
        const current = await this.readCheckpoint(transaction.client, {
          forUpdate: true,
          migrateLegacy: this.migrateLegacySimulationState,
        });
        this.assertExpectedGeneration(
          current?.generation ?? null,
          options.expectedGeneration,
        );
        return this.writeCheckpoint(
          transaction.client,
          current,
          prepared,
        );
      },
      { lockKeys: [this.runtimeLockKey()] },
    );
  }

  mutate<TResult>(
    mutator: (
      current: RuntimeCheckpoint | null,
      transaction: SerializableRuntimeTransaction,
    ) =>
      | RuntimeMutationOutput<TResult>
      | Promise<RuntimeMutationOutput<TResult>>,
    options: RuntimeMutationOptions = {},
  ): Promise<RuntimeMutationResult<TResult>> {
    return this.runSerializable(
      async (transaction) => {
        const current = await this.readCheckpoint(transaction.client, {
          forUpdate: true,
          migrateLegacy: this.migrateLegacySimulationState,
        });
        const output = await mutator(current, transaction);
        const prepared = this.prepareSnapshot(
          output.snapshot,
          output.snapshotFormat,
          output.metadata,
          options.mutationId,
        );
        const checkpoint = await this.writeCheckpoint(
          transaction.client,
          current,
          prepared,
        );
        return { result: output.result, checkpoint };
      },
      {
        lockKeys: [this.runtimeLockKey(), ...(options.lockKeys ?? [])],
      },
    );
  }

  runSerializable<TResult>(
    operation: (
      transaction: SerializableRuntimeTransaction,
    ) => TResult | Promise<TResult>,
    options: SerializableTransactionOptions = {},
  ): Promise<TResult> {
    if (this.closing) {
      return Promise.reject(
        new RuntimeCoordinatorError(
          "RUNTIME_COORDINATOR_CLOSED",
          "Runtime transaction coordinator is closing or closed.",
        ),
      );
    }
    const work = this.runSerializableInternal(operation, options);
    this.inFlight.add(work);
    void work.then(
      () => this.inFlight.delete(work),
      () => this.inFlight.delete(work),
    );
    return work;
  }

  ping(): Promise<boolean> {
    if (this.closing) return Promise.resolve(false);
    return this.client.pool
      .query("SELECT 1")
      .then(() => true)
      .catch(() => false);
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = (async () => {
      await Promise.allSettled([...this.inFlight]);
      if (this.shouldCloseClient) {
        await this.client.close();
      }
    })();
    return this.closePromise;
  }

  private async runSerializableInternal<TResult>(
    operation: (
      transaction: SerializableRuntimeTransaction,
    ) => TResult | Promise<TResult>,
    options: SerializableTransactionOptions,
  ): Promise<TResult> {
    const lockKeys = [...new Set(options.lockKeys ?? [])]
      .map((key) => validateIdentifier(key, "lockKey", 512))
      .sort();
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const connection = await this.client.pool.connect();
      let began = false;
      try {
        await connection.query(
          "BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE",
        );
        began = true;
        await connection.query(
          "SELECT set_config('lock_timeout', $1, true)",
          [`${this.lockTimeoutMs}ms`],
        );
        await connection.query(
          "SELECT set_config('statement_timeout', $1, true)",
          [`${this.statementTimeoutMs}ms`],
        );
        for (const lockKey of lockKeys) {
          await acquireTransactionAdvisoryLock(connection, lockKey);
        }

        const transaction = this.transactionApi(connection, attempt);
        const result = await operation(transaction);
        await connection.query("COMMIT");
        began = false;
        return result;
      } catch (error) {
        lastError = error;
        if (began) {
          await connection.query("ROLLBACK").catch(() => undefined);
        }
        if (
          !isRetryablePostgresTransactionError(error) ||
          attempt >= this.maxRetries
        ) {
          if (
            isRetryablePostgresTransactionError(error) &&
            attempt >= this.maxRetries
          ) {
            throw new RuntimeCoordinatorError(
              "RUNTIME_SERIALIZATION_RETRY_EXHAUSTED",
              "Serializable transaction retry budget was exhausted.",
              {
                attempts: attempt + 1,
                postgres_code: (error as { code: string }).code,
              },
              { cause: error },
            );
          }
          throw error;
        }
      } finally {
        connection.release();
      }

      const delayMs = Math.min(250, 5 * 2 ** attempt + Math.random() * 10);
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }

    throw new RuntimeCoordinatorError(
      "RUNTIME_SERIALIZATION_RETRY_EXHAUSTED",
      "Serializable transaction retry budget was exhausted.",
      {},
      { cause: lastError },
    );
  }

  private transactionApi(
    connection: PoolClient,
    attempt: number,
  ): SerializableRuntimeTransaction {
    return {
      client: connection,
      runtimeMode: this.runtimeMode,
      writerId: this.writerId,
      attempt,
      lock: (key) => acquireTransactionAdvisoryLock(connection, key),
      postLedgerTransaction: (input) =>
        postNormalizedLedgerTransaction(connection, input),
      claimIdempotency: (input) =>
        claimIdempotencyRecord(connection, input),
      completeIdempotency: (input) =>
        completeIdempotencyRecord(connection, input),
      enqueueOutbox: (input) =>
        enqueueNormalizedOutboxEvent(connection, input),
    };
  }

  private runtimeLockKey(): string {
    return `a2a402:runtime:${this.runtimeKey}`;
  }

  private async readCheckpoint(
    connection: PoolClient,
    options: { forUpdate: boolean; migrateLegacy: boolean },
  ): Promise<RuntimeCheckpoint | null> {
    const result = await connection.query<RuntimeCheckpointRow>(
      checkpointSelect(options.forUpdate),
      [this.runtimeKey],
    );
    const row = result.rows[0];
    if (row) {
      const checkpoint = checkpointFromRow(row);
      if (checkpoint.runtimeMode !== this.runtimeMode) {
        modeMismatch(
          this.runtimeKey,
          this.runtimeMode,
          checkpoint.runtimeMode,
        );
      }
      assertRuntimeSnapshotCompatible(checkpoint.snapshot, this.runtimeMode);
      return checkpoint;
    }

    if (!options.migrateLegacy) return null;
    const legacyResult = await connection.query<LegacySnapshotRow>(
      `SELECT value
         FROM platform_settings
        WHERE key = $1
        FOR UPDATE`,
      [this.legacySettingKey],
    );
    const legacy = legacyResult.rows[0];
    if (!legacy) return null;
    if (this.runtimeMode !== "simulation") {
      throw new RuntimeCoordinatorError(
        "RUNTIME_LEGACY_MODE_UNKNOWN",
        "Legacy snapshot has no immutable runtime-mode metadata and cannot be opened in real mode.",
        {
          runtime_key: this.runtimeKey,
          legacy_setting_key: this.legacySettingKey,
        },
      );
    }

    let snapshot: unknown;
    try {
      snapshot = decodeLegacySnapshotEnvelope(legacy.value);
    } catch (error) {
      if (error instanceof RuntimeSnapshotCodecError) {
        throw new RuntimeCoordinatorError(
          "RUNTIME_STATE_CORRUPT",
          error.message,
          { legacy_setting_key: this.legacySettingKey },
          { cause: error },
        );
      }
      throw error;
    }
    assertRuntimeSnapshotCompatible(snapshot, this.runtimeMode);
    return this.writeCheckpoint(
      connection,
      null,
      this.prepareSnapshot(
        snapshot,
        inferRuntimeSnapshotFormat(snapshot),
        {
          legacy_setting_key: this.legacySettingKey,
          migration: "platform_settings_to_runtime_state_checkpoints",
        },
        "legacy-simulation-import",
      ),
    );
  }

  private prepareSnapshot(
    snapshot: unknown,
    snapshotFormat: string | undefined,
    metadata: Record<string, unknown> | undefined,
    mutationId: string | null | undefined,
  ): PreparedCheckpoint {
    assertRuntimeSnapshotCompatible(snapshot, this.runtimeMode);
    return {
      encoded: encodeRuntimeSnapshot(snapshot),
      snapshotFormat: normalizeSnapshotFormat(
        snapshotFormat ?? inferRuntimeSnapshotFormat(snapshot),
      ),
      mutationId: normalizeMutationId(mutationId),
      metadata: jsonMetadata(metadata),
    };
  }

  private assertExpectedGeneration(
    actual: bigint | null,
    expected: bigint | null,
  ): void {
    if (actual !== expected) {
      throw new RuntimeCoordinatorError(
        "RUNTIME_STATE_STALE",
        "Runtime checkpoint changed after it was loaded; refusing to overwrite newer state.",
        {
          runtime_key: this.runtimeKey,
          expected_generation: expected?.toString() ?? null,
          actual_generation: actual?.toString() ?? null,
        },
      );
    }
  }

  private async writeCheckpoint(
    connection: PoolClient,
    current: RuntimeCheckpoint | null,
    prepared: PreparedCheckpoint,
  ): Promise<RuntimeCheckpoint> {
    const generation = (current?.generation ?? 0n) + 1n;
    let row: RuntimeCheckpointRow | undefined;
    if (!current) {
      const result = await connection.query<RuntimeCheckpointRow>(
        `INSERT INTO runtime_state_checkpoints (
           runtime_key,
           runtime_mode,
           generation,
           coordinator_schema_version,
           snapshot_format,
           snapshot_encoding,
           snapshot_payload,
           snapshot_sha256,
           writer_id,
           last_mutation_id,
           metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
         RETURNING
           runtime_key AS "runtimeKey",
           runtime_mode AS "runtimeMode",
           generation::text AS generation,
           coordinator_schema_version AS "coordinatorSchemaVersion",
           snapshot_format AS "snapshotFormat",
           snapshot_encoding AS "snapshotEncoding",
           snapshot_payload AS "snapshotPayload",
           snapshot_sha256 AS "snapshotSha256",
           writer_id AS "writerId",
           last_mutation_id AS "lastMutationId",
           metadata,
           created_at AS "createdAt",
           updated_at AS "updatedAt"`,
        [
          this.runtimeKey,
          this.runtimeMode,
          generation.toString(),
          RUNTIME_COORDINATOR_SCHEMA_VERSION,
          prepared.snapshotFormat,
          RUNTIME_SNAPSHOT_ENCODING,
          prepared.encoded.payload,
          prepared.encoded.sha256,
          this.writerId,
          prepared.mutationId,
          JSON.stringify(prepared.metadata),
        ],
      );
      row = result.rows[0];
    } else {
      const result = await connection.query<RuntimeCheckpointRow>(
        `UPDATE runtime_state_checkpoints
            SET generation = $3,
                coordinator_schema_version = $4,
                snapshot_format = $5,
                snapshot_encoding = $6,
                snapshot_payload = $7,
                snapshot_sha256 = $8,
                writer_id = $9,
                last_mutation_id = $10,
                metadata = $11::jsonb,
                updated_at = now()
          WHERE runtime_key = $1
            AND runtime_mode = $2
            AND generation = $12
          RETURNING
            runtime_key AS "runtimeKey",
            runtime_mode AS "runtimeMode",
            generation::text AS generation,
            coordinator_schema_version AS "coordinatorSchemaVersion",
            snapshot_format AS "snapshotFormat",
            snapshot_encoding AS "snapshotEncoding",
            snapshot_payload AS "snapshotPayload",
            snapshot_sha256 AS "snapshotSha256",
            writer_id AS "writerId",
            last_mutation_id AS "lastMutationId",
            metadata,
            created_at AS "createdAt",
            updated_at AS "updatedAt"`,
        [
          this.runtimeKey,
          this.runtimeMode,
          generation.toString(),
          RUNTIME_COORDINATOR_SCHEMA_VERSION,
          prepared.snapshotFormat,
          RUNTIME_SNAPSHOT_ENCODING,
          prepared.encoded.payload,
          prepared.encoded.sha256,
          this.writerId,
          prepared.mutationId,
          JSON.stringify(prepared.metadata),
          current.generation.toString(),
        ],
      );
      row = result.rows[0];
    }

    if (!row) {
      throw new RuntimeCoordinatorError(
        "RUNTIME_STATE_STALE",
        "Runtime checkpoint generation changed during write.",
        {
          runtime_key: this.runtimeKey,
          expected_generation: current?.generation.toString() ?? null,
        },
      );
    }
    return checkpointFromRow(row);
  }
}

interface PreparedCheckpoint {
  encoded: ReturnType<typeof encodeRuntimeSnapshot>;
  snapshotFormat: string;
  mutationId: string | null;
  metadata: Record<string, unknown>;
}
