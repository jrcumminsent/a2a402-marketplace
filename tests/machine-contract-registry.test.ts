import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONTRACT_LIMITS,
  CONTRACT_SCHEMAS,
  HTTP_ROUTE_CONTRACTS,
  PRIMARY_ACTIONS,
  agentCard,
  fastifySchemaForRoute,
  marketplaceManifest,
  publicSchemaDocuments,
  runtimeSchemaDocuments,
  type ContractJsonSchema,
} from "../apps/api/src/machine-docs.js";
import { openApiDocument } from "../apps/api/src/openapi.js";

const appSourcePath = fileURLToPath(
  new URL("../apps/api/src/app.ts", import.meta.url),
);
const actionsSourcePath = fileURLToPath(
  new URL("../apps/api/src/actions.ts", import.meta.url),
);
const openApiPath = fileURLToPath(
  new URL("../openapi.json", import.meta.url),
);
const schemasDirectory = fileURLToPath(
  new URL("../schemas/", import.meta.url),
);
const schemaUrnPrefix = "urn:a2a402:contract-schema:";

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path.replace(
    /:([A-Za-z0-9_]+)/g,
    "{$1}",
  )}`;
}

function referencedSchema(
  schema: ContractJsonSchema,
): ContractJsonSchema {
  const reference = schema.$ref;
  if (typeof reference !== "string") return schema;
  const name = reference.slice(schemaUrnPrefix.length);
  const resolved = CONTRACT_SCHEMAS[name];
  if (!resolved) throw new Error(`Unresolved contract schema: ${reference}`);
  return resolved;
}

function strictObjectBranches(
  input: ContractJsonSchema,
): ContractJsonSchema[] {
  const schema = referencedSchema(input);
  if (schema.type === "object") return [schema];
  const branches = schema.oneOf;
  if (!Array.isArray(branches)) return [schema];
  return branches.map((branch) =>
    referencedSchema(branch as ContractJsonSchema),
  );
}

function visitReferences(
  value: unknown,
  onReference: (reference: string) => void,
): void {
  if (Array.isArray(value)) {
    for (const child of value) visitReferences(child, onReference);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (key === "$ref" && typeof child === "string") onReference(child);
    visitReferences(child, onReference);
  }
}

describe("authoritative machine contract registry", () => {
  it("covers every Fastify route in app.ts exactly once", async () => {
    const appSource = await readFile(appSourcePath, "utf8");
    const implementedRoutes = [
      ...appSource.matchAll(
        /\bserver\.(get|post|patch|delete)\(\s*["']([^"']+)["']/g,
      ),
    ].map((match) => routeKey(match[1] as string, match[2] as string));
    const documentedRoutes = HTTP_ROUTE_CONTRACTS.map((contract) =>
      routeKey(contract.method, contract.path),
    );

    expect(new Set(documentedRoutes).size).toBe(documentedRoutes.length);
    expect(
      new Set(HTTP_ROUTE_CONTRACTS.map((contract) => contract.id)).size,
    ).toBe(HTTP_ROUTE_CONTRACTS.length);
    expect(sorted(documentedRoutes)).toEqual(sorted(implementedRoutes));
  });

  it("makes every REST mutation strict, bounded, and replay safe", () => {
    const mutations = HTTP_ROUTE_CONTRACTS.filter(
      (contract) => contract.kind === "rest" && contract.method !== "GET",
    );
    expect(mutations.length).toBeGreaterThan(0);

    for (const contract of mutations) {
      expect(
        ["public-idempotent", "agent", "admin"],
        `${contract.id} must require an idempotency key`,
      ).toContain(contract.security);
      expect(contract.body, `${contract.id} must define its request`).toBeDefined();
      expect(
        contract.maxBodyBytes,
        `${contract.id} must define a body limit`,
      ).toBeGreaterThan(0);
      expect(contract.maxBodyBytes).toBeLessThanOrEqual(
        CONTRACT_LIMITS.artifactBodyBytes,
      );

      for (const schema of strictObjectBranches(
        contract.body as ContractJsonSchema,
      )) {
        expect(schema.type, `${contract.id} request must be an object`).toBe(
          "object",
        );
        expect(
          schema.additionalProperties,
          `${contract.id} must reject unknown request properties`,
        ).toBe(false);
      }

      const fastifySchema = fastifySchemaForRoute(contract);
      expect(fastifySchema.body).toEqual(contract.body);
      expect(fastifySchema.response).toEqual({
        ...contract.responses,
        default: contract.errorSchema,
      });
    }
  });

  it("has no unresolved registry references", () => {
    const runtimeDocuments = runtimeSchemaDocuments();
    expect(Object.keys(runtimeDocuments)).toEqual(
      Object.keys(CONTRACT_SCHEMAS),
    );

    visitReferences(
      { schemas: CONTRACT_SCHEMAS, routes: HTTP_ROUTE_CONTRACTS },
      (reference) => {
        expect(reference.startsWith(schemaUrnPrefix)).toBe(true);
        expect(
          CONTRACT_SCHEMAS[reference.slice(schemaUrnPrefix.length)],
          reference,
        ).toBeDefined();
      },
    );
  });

  it("generates OpenAPI 3.1 operations only from the route registry", () => {
    const document = openApiDocument("https://a2a402.market") as unknown as {
      openapi: string;
      jsonSchemaDialect: string;
      paths: Record<
        string,
        Record<string, { operationId: string; responses: unknown }>
      >;
      components: { schemas: Record<string, unknown> };
    };
    expect(document.openapi).toBe("3.1.0");
    expect(document.jsonSchemaDialect).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
    expect(Object.keys(document.components.schemas)).toEqual(
      Object.keys(CONTRACT_SCHEMAS),
    );

    const operations = HTTP_ROUTE_CONTRACTS.map(
      (contract) =>
        document.paths[contract.path]?.[contract.method.toLowerCase()],
    );
    expect(operations.every(Boolean)).toBe(true);
    expect(operations.map((operation) => operation?.operationId)).toEqual(
      HTTP_ROUTE_CONTRACTS.map((contract) => contract.id),
    );
    expect(
      JSON.stringify(document).includes(schemaUrnPrefix),
      "OpenAPI must use local component references",
    ).toBe(false);
  });

  it("keeps A2A and MCP discovery actions aligned with the dispatcher", async () => {
    const actionsSource = await readFile(actionsSourcePath, "utf8");
    const implementedActions = [
      ...actionsSource.matchAll(/\bcase "([^"]+)":/g),
    ].map((match) => match[1] as string);
    const manifest = marketplaceManifest({
      publicUrl: "https://a2a402.market",
      baseUrl: "https://a2a402.market",
      feeBps: 250,
      simulationMode: false,
      signingKeyId: "did:web:a2a402.market#marketplace-key",
    }) as unknown as {
      supported_protocols: {
        a2a: { actions: string[] };
        mcp: { tools: string[] };
      };
    };
    const card = agentCard("https://a2a402.market") as unknown as {
      skills: Array<{ id: string }>;
    };

    expect(sorted(PRIMARY_ACTIONS)).toEqual(sorted(implementedActions));
    expect(manifest.supported_protocols.a2a.actions).toEqual(PRIMARY_ACTIONS);
    expect(manifest.supported_protocols.mcp.tools).toEqual(PRIMARY_ACTIONS);
    expect(card.skills.map((skill) => skill.id)).toEqual(PRIMARY_ACTIONS);
  });

  it("keeps checked-in OpenAPI and public schemas reproducible", async () => {
    const expectedOpenApi = openApiDocument("https://a2a402.market");
    const checkedInOpenApi = JSON.parse(
      await readFile(openApiPath, "utf8"),
    ) as unknown;
    expect(checkedInOpenApi).toEqual(expectedOpenApi);

    const expectedSchemas = publicSchemaDocuments();
    const checkedInNames = (await readdir(schemasDirectory))
      .filter((name) => name.endsWith(".schema.json"))
      .sort();
    const expectedNames = Object.keys(expectedSchemas)
      .map((name) => `${name}.schema.json`)
      .sort();
    expect(checkedInNames).toEqual(expectedNames);

    for (const [name, expected] of Object.entries(expectedSchemas)) {
      const document = JSON.parse(
        await readFile(`${schemasDirectory}${name}.schema.json`, "utf8"),
      ) as unknown;
      expect(document, `${name}.schema.json`).toEqual(expected);
    }
  });
});
