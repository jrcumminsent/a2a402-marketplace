import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL ?? process.env.NETLIFY_DB_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL or NETLIFY_DB_URL is required by drizzle-kit");
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
