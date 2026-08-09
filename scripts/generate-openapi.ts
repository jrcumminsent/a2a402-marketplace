import {
  mkdirSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publicSchemaDocuments } from "../apps/api/src/machine-docs.js";
import { openApiDocument } from "../apps/api/src/openapi.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const outputRoot = resolve(
  process.env.CONTRACT_OUTPUT_DIR ?? repositoryRoot,
);
const openApiTarget = resolve(outputRoot, "openapi.json");
const schemasTarget = resolve(outputRoot, "schemas");
const publicUrl = process.env.PUBLIC_MARKET_URL ?? "https://a2a402.market";
const documents = publicSchemaDocuments();
const expectedSchemaFiles = new Set(
  Object.keys(documents).map((name) => `${name}.schema.json`),
);

mkdirSync(schemasTarget, { recursive: true });
for (const entry of readdirSync(schemasTarget, { withFileTypes: true })) {
  if (
    entry.isFile() &&
    entry.name.endsWith(".schema.json") &&
    !expectedSchemaFiles.has(entry.name)
  ) {
    unlinkSync(resolve(schemasTarget, entry.name));
  }
}
writeFileSync(
  openApiTarget,
  `${JSON.stringify(openApiDocument(publicUrl), null, 2)}\n`,
  "utf8",
);
for (const [name, document] of Object.entries(documents)) {
  writeFileSync(
    resolve(schemasTarget, `${name}.schema.json`),
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  );
}

console.log(
  JSON.stringify({
    level: "info",
    event: "machine_contracts.generated",
    openapi_target: openApiTarget,
    schemas_target: schemasTarget,
    schema_count: Object.keys(documents).length,
  }),
);
