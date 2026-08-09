import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseClient {
  db: Database;
  pool: Pool;
  close(): Promise<void>;
}

export function createDatabaseClient(
  connectionString = process.env.DATABASE_URL ?? process.env.NETLIFY_DB_URL,
  overrides: Omit<PoolConfig, "connectionString"> = {},
): DatabaseClient {
  if (!connectionString) {
    throw new Error("DATABASE_URL or NETLIFY_DB_URL is required");
  }

  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...overrides,
  });
  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    close: () => pool.end(),
  };
}
