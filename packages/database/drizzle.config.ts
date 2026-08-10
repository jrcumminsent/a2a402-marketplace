import { defineConfig } from "drizzle-kit";

const databaseUrl =
  process.env.MIGRATION_DATABASE_URL ??
  process.env.NETLIFY_DB_URL ??
  process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "MIGRATION_DATABASE_URL, NETLIFY_DB_URL, or DATABASE_URL is required by drizzle-kit",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/database/src/schema.ts",
  out: "./packages/database/migrations",
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});
