import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import {
  RuntimeCoordinatorError,
  RuntimeSnapshotCodecError,
  RuntimeTransactionCoordinator,
  assertRuntimeSnapshotCompatible,
  decodeRuntimeSnapshot,
  encodeRuntimeSnapshot,
  isRetryablePostgresTransactionError,
  normalizedJsonSha256,
  runtimeModeFromEnvironment,
  type DatabaseClient,
} from "@a2a402/database";

describe("database runtime checkpoint codec and mode boundary", () => {
  it("round-trips bigint values and reserved marker strings", () => {
    const snapshot = {
      format: "a2a402-engine-snapshot/0.1",
      balance: 9_007_199_254_740_993n,
      negativeCorrection: -42n,
      marker: "~a2a402-json~bigint:not-a-number",
      nested: [{ amountMinor: 500n }],
    };
    const encoded = encodeRuntimeSnapshot(snapshot);

    expect(
      decodeRuntimeSnapshot({
        encoding: encoded.encoding,
        payload: encoded.payload,
        sha256: encoded.sha256,
      }),
    ).toEqual(snapshot);
  });

  it("rejects payload tampering before decoding state", () => {
    const encoded = encodeRuntimeSnapshot({ sequence: 1 });
    expect(() =>
      decodeRuntimeSnapshot({
        encoding: encoded.encoding,
        payload: encoded.payload.replace('"sequence":1', '"sequence":2'),
        sha256: encoded.sha256,
      }),
    ).toThrow(RuntimeSnapshotCodecError);
  });

  it("infers compatibility mode from explicit or payment configuration", () => {
    expect(runtimeModeFromEnvironment({ A2A402_RUNTIME_MODE: "real" })).toBe(
      "real",
    );
    expect(runtimeModeFromEnvironment({ PAYMENTS_MODE: "mock" })).toBe(
      "simulation",
    );
    expect(runtimeModeFromEnvironment({ PAYMENTS_MODE: "x402-testnet" })).toBe(
      "real",
    );
    expect(() =>
      runtimeModeFromEnvironment({ PAYMENTS_MODE: "unconfigured" }),
    ).toThrow(RuntimeCoordinatorError);
  });

  it("fails closed when real mode receives simulation provenance or payments", () => {
    expect(() =>
      assertRuntimeSnapshotCompatible(
        {
          capitalLots: [{ originType: "platform_test_funds" }],
        },
        "real",
      ),
    ).toThrow(
      expect.objectContaining({
        code: "RUNTIME_SIMULATION_STATE_FORBIDDEN",
      }),
    );
    expect(() =>
      assertRuntimeSnapshotCompatible(
        {
          paymentIntents: [
            {
              paymentIdentifier: "a2a402:test",
              transactionHash: "mock:test",
              adapter: "mock",
            },
          ],
        },
        "real",
      ),
    ).toThrow(
      expect.objectContaining({
        code: "RUNTIME_SIMULATION_STATE_FORBIDDEN",
      }),
    );
    expect(() =>
      assertRuntimeSnapshotCompatible(
        { runtimeMode: "real" },
        "simulation",
      ),
    ).toThrow(
      expect.objectContaining({
        code: "RUNTIME_MODE_MISMATCH",
      }),
    );
  });
});

describe("serializable transaction coordinator", () => {
  it("retries serialization failures and acquires declared locks in stable order", async () => {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const releases = vi.fn();
    const connection = {
      query: vi.fn(async (text: string, values: unknown[] = []) => {
        queries.push({ text, values });
        return { rows: [], rowCount: 0 };
      }),
      release: releases,
    };
    const pool = {
      connect: vi.fn(async () => connection),
      query: vi.fn(async () => ({ rows: [{ "?column?": 1 }] })),
    };
    const databaseClient = {
      db: {} as DatabaseClient["db"],
      pool,
      close: vi.fn(async () => undefined),
    } as unknown as DatabaseClient;
    const coordinator = new RuntimeTransactionCoordinator({
      runtimeMode: "simulation",
      runtimeKey: "test.runtime",
      writerId: "test-writer",
      client: databaseClient,
      closeClient: false,
      maxRetries: 1,
    });

    let attempts = 0;
    const result = await coordinator.runSerializable(
      ({ attempt }) => {
        attempts += 1;
        if (attempt === 0) {
          throw Object.assign(new Error("serialization failure"), {
            code: "40001",
          });
        }
        return "committed";
      },
      { lockKeys: ["z-lock", "a-lock", "z-lock"] },
    );

    expect(result).toBe("committed");
    expect(attempts).toBe(2);
    expect(pool.connect).toHaveBeenCalledTimes(2);
    expect(releases).toHaveBeenCalledTimes(2);
    const advisoryKeys = queries
      .filter(({ text }) => text.includes("pg_advisory_xact_lock"))
      .map(({ values }) => values[0]);
    expect(advisoryKeys).toEqual(["a-lock", "z-lock", "a-lock", "z-lock"]);
    expect(queries.filter(({ text }) => text === "ROLLBACK")).toHaveLength(1);
    expect(queries.filter(({ text }) => text === "COMMIT")).toHaveLength(1);
    await coordinator.close();
  });

  it("recognizes only serialization and deadlock SQLSTATEs as retryable", () => {
    expect(isRetryablePostgresTransactionError({ code: "40001" })).toBe(true);
    expect(isRetryablePostgresTransactionError({ code: "40P01" })).toBe(true);
    expect(isRetryablePostgresTransactionError({ code: "23505" })).toBe(false);
  });

  it("reads under the runtime lock without writing or advancing state", async () => {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const connection = {
      query: vi.fn(async (text: string, values: unknown[] = []) => {
        queries.push({ text, values });
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const databaseClient = {
      db: {} as DatabaseClient["db"],
      pool: {
        connect: vi.fn(async () => connection),
        query: vi.fn(async () => ({ rows: [] })),
      },
      close: vi.fn(async () => undefined),
    } as unknown as DatabaseClient;
    const coordinator = new RuntimeTransactionCoordinator({
      runtimeMode: "simulation",
      runtimeKey: "test.read-runtime",
      writerId: "test-reader",
      client: databaseClient,
      closeClient: false,
    });

    await expect(
      coordinator.read((checkpoint) => checkpoint?.generation ?? null),
    ).resolves.toBeNull();
    expect(
      queries.some(({ text }) =>
        /\b(?:INSERT|UPDATE|DELETE)\b/i.test(text),
      ),
    ).toBe(false);
    expect(
      queries.filter(({ text }) => text.includes("pg_advisory_xact_lock")),
    ).toHaveLength(1);
    expect(queries.filter(({ text }) => text === "COMMIT")).toHaveLength(1);
    await coordinator.close();
  });
});

describe("normalized write boundaries and migration", () => {
  it("canonicalizes JSON hashes and rejects bigint at JSON boundaries", () => {
    expect(normalizedJsonSha256({ b: 2, a: 1 })).toBe(
      normalizedJsonSha256({ a: 1, b: 2 }),
    );
    expect(() => normalizedJsonSha256({ amount_minor: 1n })).toThrow(
      expect.objectContaining({ code: "NORMALIZED_WRITE_INVALID" }),
    );
  });

  it("adds immutable mode, generation, digest history, and guard triggers", async () => {
    const migrationPath = fileURLToPath(
      new URL(
        "../packages/database/migrations/0001_runtime_transaction_coordinator.sql",
        import.meta.url,
      ),
    );
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain(
      "ADD COLUMN provenance_scope varchar(16)",
    );
    expect(migration).toContain(
      "capital_lot_provenance_scope_immutable",
    );
    expect(migration).toContain(
      "ADD COLUMN status_before_freeze contract_status",
    );
    expect(migration).toContain(
      "ADD COLUMN seller_acceptance_deadline timestamptz",
    );
    expect(migration).toContain(
      "RENAME COLUMN payment_requirement TO requirement_json",
    );
    expect(migration).toContain(
      "RENAME COLUMN verification_evidence TO verification_json",
    );
    expect(migration).toContain("CREATE TABLE runtime_state_checkpoints");
    expect(migration).toContain(
      "runtime_mode varchar(16) NOT NULL",
    );
    expect(migration).toContain(
      "NEW.generation <> OLD.generation + 1",
    );
    expect(migration).toContain("CREATE TABLE runtime_state_transitions");
    expect(migration).toContain("runtime_transition_append_only");
  });
});
