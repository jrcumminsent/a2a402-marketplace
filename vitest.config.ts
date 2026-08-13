import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@a2a402/shared": `${root}packages/shared/src/index.ts`,
      "@a2a402/marketplace": `${root}packages/marketplace/src/index.ts`,
      "@a2a402/provenance": `${root}packages/provenance/src/index.ts`,
      "@a2a402/reputation": `${root}packages/reputation/src/index.ts`,
      "@a2a402/evaluation": `${root}packages/evaluation/src/index.ts`,
      "@a2a402/payments": `${root}packages/payments/src/index.ts`,
      "@a2a402/protocol-a2a": `${root}packages/protocol-a2a/src/index.ts`,
      "@a2a402/protocol-mcp": `${root}packages/protocol-mcp/src/index.ts`,
      "@a2a402/database": `${root}packages/database/src/index.ts`,
    },
  },
  test: {
    environment: "node",
    include: [
      "tests/**/*.test.ts",
      "netlify/functions/**/*.test.ts",
      "packages/**/tests/**/*.test.ts",
      "packages/shared/src/**/*.test.ts",
    ],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      exclude: ["**/dist/**", "**/examples/**", "**/migrations/**"],
    },
  },
});
