import type { DatabaseClient } from "./client.js";
import {
  DEFAULT_RUNTIME_KEY,
  RuntimeTransactionCoordinator,
  type RuntimeCheckpoint,
} from "./runtime-transaction-coordinator.js";
import {
  runtimeModeFromEnvironment,
  type RuntimeMode,
} from "./runtime-mode.js";

export const ENGINE_SNAPSHOT_SETTING_KEY = DEFAULT_RUNTIME_KEY;

export interface PostgresSnapshotPersistenceOptions {
  /** Reuse an existing database client. The store will not close it by default. */
  client?: DatabaseClient;
  /** Used when the store should own its database client. Defaults to DATABASE_URL. */
  connectionString?: string;
  /** Durable checkpoint key. Legacy platform_settings uses the same key by default. */
  key?: string;
  /**
   * Explicitly selects simulation or real-value state. When omitted only this
   * compatibility adapter infers mode from A2A402_RUNTIME_MODE/PAYMENTS_MODE.
   * New integrations should construct RuntimeTransactionCoordinator directly.
   */
  runtimeMode?: RuntimeMode;
  writerId?: string;
  maxRetries?: number;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
  migrateLegacySimulationState?: boolean;
  /** Close an injected client from close(). Defaults to true only for owned clients. */
  closeClient?: boolean;
}

/**
 * Generation-aware compatibility adapter for the existing API host.
 *
 * The old implementation serialized only within one Node process and used an
 * unconditional PostgreSQL upsert. This adapter persists through the
 * SERIALIZABLE runtime coordinator and performs strict compare-and-swap saves:
 * a second process that loaded an older generation receives
 * `RUNTIME_STATE_STALE` instead of overwriting newer state.
 *
 * For fully atomic load-mutate-normalized-write-save behavior, integrate
 * RuntimeTransactionCoordinator.mutate() directly.
 */
export class PostgresSnapshotPersistence {
  readonly key: string;
  readonly runtimeMode: RuntimeMode;
  readonly coordinator: RuntimeTransactionCoordinator;

  private operationTail: Promise<void> = Promise.resolve();
  private observedGeneration: bigint | null | undefined;
  private closing = false;
  private closePromise: Promise<void> | undefined;

  constructor(options: PostgresSnapshotPersistenceOptions | string = {}) {
    const normalized: PostgresSnapshotPersistenceOptions =
      typeof options === "string" ? { connectionString: options } : options;
    this.key = normalized.key ?? ENGINE_SNAPSHOT_SETTING_KEY;
    this.runtimeMode =
      normalized.runtimeMode ?? runtimeModeFromEnvironment();
    this.coordinator = new RuntimeTransactionCoordinator({
      runtimeMode: this.runtimeMode,
      runtimeKey: this.key,
      ...(normalized.client ? { client: normalized.client } : {}),
      ...(normalized.connectionString
        ? { connectionString: normalized.connectionString }
        : {}),
      ...(normalized.writerId ? { writerId: normalized.writerId } : {}),
      ...(normalized.maxRetries !== undefined
        ? { maxRetries: normalized.maxRetries }
        : {}),
      ...(normalized.lockTimeoutMs !== undefined
        ? { lockTimeoutMs: normalized.lockTimeoutMs }
        : {}),
      ...(normalized.statementTimeoutMs !== undefined
        ? { statementTimeoutMs: normalized.statementTimeoutMs }
        : {}),
      ...(normalized.migrateLegacySimulationState !== undefined
        ? {
            migrateLegacySimulationState:
              normalized.migrateLegacySimulationState,
          }
        : {}),
      closeClient: normalized.closeClient ?? normalized.client === undefined,
    });
  }

  load(): Promise<unknown | null> {
    return this.enqueue(async () => {
      const checkpoint = await this.coordinator.load();
      this.observedGeneration = checkpoint?.generation ?? null;
      return checkpoint?.snapshot ?? null;
    });
  }

  loadCheckpoint(): Promise<RuntimeCheckpoint | null> {
    return this.enqueue(async () => {
      const checkpoint = await this.coordinator.load();
      this.observedGeneration = checkpoint?.generation ?? null;
      return checkpoint;
    });
  }

  save(snapshot: unknown): Promise<void> {
    return this.enqueue(async () => {
      if (this.observedGeneration === undefined) {
        const current = await this.coordinator.load();
        this.observedGeneration = current?.generation ?? null;
      }
      const expectedGeneration = this.observedGeneration;
      if (expectedGeneration === undefined) {
        throw new Error("Runtime checkpoint generation was not initialized.");
      }
      const checkpoint = await this.coordinator.save(snapshot, {
        expectedGeneration,
        mutationId: `compatibility-save-${compatibilityMutationSequence()}`,
        metadata: {
          persistence_adapter: "PostgresSnapshotPersistence",
          compare_and_swap: true,
        },
      });
      this.observedGeneration = checkpoint.generation;
    });
  }

  generation(): bigint | null | undefined {
    return this.observedGeneration;
  }

  ping(): Promise<boolean> {
    return this.enqueue(() => this.coordinator.ping());
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = (async () => {
      await this.operationTail;
      await this.coordinator.close();
    })();
    return this.closePromise;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) {
      return Promise.reject(
        new Error("Postgres snapshot persistence is closing or closed."),
      );
    }
    const result = this.operationTail.then(operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

let compatibilitySequence = 0;

function compatibilityMutationSequence(): string {
  compatibilitySequence += 1;
  return `${Date.now().toString(36)}-${process.pid.toString(36)}-${compatibilitySequence.toString(36)}`;
}

export { PostgresSnapshotPersistence as PostgresSnapshotStore };
