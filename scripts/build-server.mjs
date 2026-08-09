import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { build } = require("esbuild");

const root = process.cwd();

const workspaceEntries = new Map([
  ["@a2a402/database", "packages/database/src/index.ts"],
  ["@a2a402/database/schema", "packages/database/src/schema.ts"],
  ["@a2a402/evaluation", "packages/evaluation/src/index.ts"],
  ["@a2a402/marketplace", "packages/marketplace/src/index.ts"],
  ["@a2a402/payments", "packages/payments/src/index.ts"],
  ["@a2a402/payments/mock", "packages/payments/src/mock.ts"],
  ["@a2a402/payments/x402-testnet", "packages/payments/src/x402-testnet.ts"],
  ["@a2a402/protocol-a2a", "packages/protocol-a2a/src/index.ts"],
  ["@a2a402/protocol-mcp", "packages/protocol-mcp/src/index.ts"],
  ["@a2a402/provenance", "packages/provenance/src/index.ts"],
  ["@a2a402/reputation", "packages/reputation/src/index.ts"],
  ["@a2a402/shared", "packages/shared/src/index.ts"],
]);

const workspacePackagesPlugin = {
  name: "a2a402-workspace-packages",
  setup(buildContext) {
    buildContext.onResolve({ filter: /^@a2a402(?:\/|$)/ }, (args) => {
      const relativeEntry = workspaceEntries.get(args.path);
      if (!relativeEntry) {
        return {
          errors: [
            {
              text: `No runtime bundle entry is configured for workspace import ${args.path}.`,
            },
          ],
        };
      }
      return { path: resolve(root, relativeEntry) };
    });
  },
};

const common = {
  absWorkingDir: root,
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  tsconfig: "tsconfig.json",
  plugins: [workspacePackagesPlugin],
  logLevel: "info",
};

const apiEntryPoints = {
  server: resolve(root, "apps/api/src/index.ts"),
  worker: resolve(root, "apps/api/src/worker.ts"),
};

await Promise.all([
  build({
    ...common,
    entryPoints: apiEntryPoints,
    outdir: "dist/apps/api",
    entryNames: "[name]",
  }),
  build({
    ...common,
    entryPoints: [resolve(root, "packages/database/src/migrate.ts")],
    outfile: "dist/packages/database/src/migrate.js",
  }),
]);

const migrationsTarget = resolve(root, "dist/packages/database/migrations");
await mkdir(migrationsTarget, { recursive: true });
await cp(resolve(root, "packages/database/migrations"), migrationsTarget, {
  recursive: true,
  force: true,
});
