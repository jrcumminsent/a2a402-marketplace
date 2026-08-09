import { createHash } from "node:crypto";

import {
  RuntimeTransactionCoordinator,
  type RuntimeCheckpoint,
} from "@a2a402/database";
import { type MarketplaceEngine } from "@a2a402/marketplace";
import { MarketplaceError } from "@a2a402/shared";

type MutationOutcome<T> =
  | { status: "completed"; value: T }
  | { status: "committed_error"; error: MarketplaceError };

export interface RuntimeMutationOptions {
  mutationId: string;
  lockKeys?: readonly string[];
}

/**
 * Serializes access to the process-local engine and, when PostgreSQL is
 * configured, restores and checkpoints it inside the database coordinator's
 * SERIALIZABLE transaction. This prevents multiple API/worker processes from
 * overwriting one another's state.
 */
export class MarketplaceRuntime {
  readonly coordinator: RuntimeTransactionCoordinator | null;

  private readonly initialSnapshot: unknown;
  private operationTail: Promise<void> = Promise.resolve();
  private closing = false;

  constructor(
    readonly engine: MarketplaceEngine,
    options: {
      databaseUrl?: string | null;
      runtimeMode: "simulation" | "real";
    },
  ) {
    this.initialSnapshot = engine.exportSnapshot();
    this.coordinator = options.databaseUrl
      ? new RuntimeTransactionCoordinator({
          connectionString: options.databaseUrl,
          runtimeMode: options.runtimeMode,
          runtimeKey: "runtime.engine_snapshot",
        })
      : null;
  }

  async initialize(): Promise<void> {
    if (!this.coordinator) return;
    const checkpoint = await this.coordinator.load();
    this.restore(checkpoint);
  }

  runRead<T>(reader: () => T | Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      if (!this.coordinator) return reader();
      return this.coordinator.read(async (checkpoint) => {
        this.restore(checkpoint);
        return reader();
      });
    });
  }

  runMutation<T>(
    action: () => T | Promise<T>,
    options: RuntimeMutationOptions,
  ): Promise<T> {
    return this.exclusive(async () => {
      if (!this.coordinator) return action();

      let rollbackSnapshot: unknown = this.initialSnapshot;
      try {
        const mutation = await this.coordinator.mutate<MutationOutcome<T>>(
          async (checkpoint) => {
            this.restore(checkpoint);
            rollbackSnapshot = checkpoint?.snapshot ?? this.initialSnapshot;
            try {
              const value = await action();
              return {
                snapshot: this.engine.exportSnapshot(),
                result: { status: "completed", value },
                metadata: {
                  source: "api_runtime",
                  atomic_checkpoint: true,
                },
              };
            } catch (error) {
              // A 402 creates and persists the exact x402 requirement so the
              // buyer can answer it. All other failures roll the engine back.
              if (
                error instanceof MarketplaceError &&
                error.code === "PAYMENT_REQUIRED"
              ) {
                return {
                  snapshot: this.engine.exportSnapshot(),
                  result: { status: "committed_error", error },
                  metadata: {
                    source: "api_runtime",
                    committed_payment_requirement: true,
                  },
                };
              }
              this.engine.restoreSnapshot(rollbackSnapshot);
              throw error;
            }
          },
          {
            mutationId: compactMutationId(options.mutationId),
            ...(options.lockKeys ? { lockKeys: options.lockKeys } : {}),
          },
        );
        if (mutation.result.status === "committed_error") {
          throw mutation.result.error;
        }
        return mutation.result.value;
      } catch (error) {
        if (
          !(
            error instanceof MarketplaceError &&
            error.code === "PAYMENT_REQUIRED"
          )
        ) {
          this.engine.restoreSnapshot(rollbackSnapshot);
        }
        throw error;
      }
    });
  }

  ping(): Promise<boolean> {
    return this.coordinator?.ping() ?? Promise.resolve(true);
  }

  close(): Promise<void> {
    this.closing = true;
    return this.operationTail.then(async () => {
      await this.coordinator?.close();
    });
  }

  private restore(checkpoint: RuntimeCheckpoint | null): void {
    this.engine.restoreSnapshot(
      checkpoint?.snapshot ?? this.initialSnapshot,
    );
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) {
      return Promise.reject(
        new MarketplaceError(
          "INTERNAL_ERROR",
          "Marketplace runtime is closing.",
          503,
          {},
          true,
        ),
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

function compactMutationId(value: string): string {
  if (value.length <= 200) return value;
  const digest = createHash("sha256").update(value, "utf8").digest("hex");
  return `${value.slice(0, 127)}:${digest}`;
}
