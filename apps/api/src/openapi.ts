import {
  CONTRACT_LIMITS,
  CONTRACT_SCHEMAS,
  HTTP_ROUTE_CONTRACTS,
  openApiSchema,
  type ContractJsonSchema,
  type HttpRouteContract,
} from "./machine-docs.js";

type OpenApiObject = Record<string, unknown>;

const HEADER_PARAMETER_REFS = {
  idempotency: { $ref: "#/components/parameters/IdempotencyKey" },
  signature: { $ref: "#/components/parameters/AgentSignature" },
  signedAt: { $ref: "#/components/parameters/SignedAt" },
  adminKey: { $ref: "#/components/parameters/AdminEmergencyKey" },
} as const;

const SECURITY: Record<HttpRouteContract["security"], OpenApiObject[]> = {
  public: [],
  "public-idempotent": [],
  "optional-bearer": [{}, { bearerAuth: [] }],
  bearer: [{ bearerAuth: [] }],
  agent: [{ bearerAuth: [], walletRequestSignature: [] }],
  admin: [{ adminEmergencyKey: [] }],
  "admin-read": [{ adminEmergencyKey: [] }],
};

function statusDescription(status: string): string {
  if (status === "200") return "Successful machine-readable result";
  if (status === "201") return "Resource created";
  if (status === "202") return "Request accepted for processing";
  if (status === "204") return "Successful response with no content";
  if (status === "405") return "Method not supported";
  return "Documented response";
}

function mediaTypeFor(contract: HttpRouteContract): string {
  if (contract.id === "a2a_json_rpc" || contract.id.startsWith("mcp_")) {
    return "application/json";
  }
  return "application/json";
}

function parametersForObject(
  schema: ContractJsonSchema | undefined,
  location: "path" | "query",
): OpenApiObject[] {
  if (!schema) return [];
  const properties =
    (schema.properties as Record<string, ContractJsonSchema> | undefined) ?? {};
  const required = new Set(
    (schema.required as readonly string[] | undefined) ?? [],
  );
  return Object.entries(properties).map(([name, propertySchema]) => ({
    name,
    in: location,
    required: location === "path" || required.has(name),
    schema: openApiSchema(propertySchema),
  }));
}

function securityHeaderParameters(
  security: HttpRouteContract["security"],
): OpenApiObject[] {
  if (security === "public-idempotent") {
    return [HEADER_PARAMETER_REFS.idempotency];
  }
  if (security === "agent") {
    return [
      HEADER_PARAMETER_REFS.idempotency,
      HEADER_PARAMETER_REFS.signature,
      HEADER_PARAMETER_REFS.signedAt,
    ];
  }
  if (security === "admin") {
    return [HEADER_PARAMETER_REFS.idempotency, HEADER_PARAMETER_REFS.adminKey];
  }
  if (security === "admin-read") {
    return [HEADER_PARAMETER_REFS.adminKey];
  }
  return [];
}

function responseContent(
  contract: HttpRouteContract,
  schema: ContractJsonSchema,
): OpenApiObject {
  const content: OpenApiObject = {
    [mediaTypeFor(contract)]: { schema: openApiSchema(schema) },
  };
  if (contract.id === "a2a_json_rpc" || contract.id === "mcp_streamable_http") {
    content["text/event-stream"] = {
      schema: {
        type: "string",
        description:
          "Server-sent protocol events when streaming is negotiated.",
      },
    };
  }
  return content;
}

function operation(contract: HttpRouteContract): OpenApiObject {
  const responses: OpenApiObject = {};
  for (const [status, schema] of Object.entries(contract.responses)) {
    responses[status] = {
      description: statusDescription(status),
      ...(status === "204"
        ? {}
        : { content: responseContent(contract, schema) }),
    };
  }
  responses.default = {
    description: "Stable machine-readable error",
    content: {
      "application/json": {
        schema: openApiSchema(contract.errorSchema),
      },
    },
  };

  const parameters = [
    ...parametersForObject(contract.params, "path"),
    ...parametersForObject(contract.query, "query"),
    ...securityHeaderParameters(contract.security),
  ];

  return {
    operationId: contract.id,
    summary: contract.summary,
    description: contract.description,
    tags: [...contract.tags],
    ...(parameters.length === 0 ? {} : { parameters }),
    ...(contract.body
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: openApiSchema(contract.body),
              },
            },
          },
          "x-a2a402-max-body-bytes":
            contract.maxBodyBytes ?? CONTRACT_LIMITS.jsonBodyBytes,
        }
      : {}),
    responses,
    security: SECURITY[contract.security],
  };
}

function schemaComponents(): OpenApiObject {
  return Object.fromEntries(
    Object.entries(CONTRACT_SCHEMAS).map(([name, schema]) => [
      name,
      openApiSchema(schema),
    ]),
  );
}

export function openApiDocument(publicUrl: string): Record<string, unknown> {
  const baseUrl = publicUrl.replace(/\/+$/, "");
  const paths: Record<string, Record<string, unknown>> = {};
  for (const contract of HTTP_ROUTE_CONTRACTS) {
    paths[contract.path] ??= {};
    paths[contract.path]![contract.method.toLowerCase()] = operation(contract);
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "a2a402 Agent-Origin Market",
      version: "0.1.0",
      description:
        "Machine-only marketplace API with wallet signatures, double-entry accounting, and Proof-of-Earn capital controls.",
      license: {
        name: "Apache-2.0",
        identifier: "Apache-2.0",
      },
    },
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    servers: [{ url: baseUrl }],
    tags: [
      { name: "Discovery", description: "Machine discovery documents." },
      { name: "Protocol", description: "A2A and MCP protocol bindings." },
      { name: "Agents", description: "Agent identity and authentication." },
      { name: "Listings", description: "Marketplace supply." },
      { name: "Jobs", description: "Marketplace demand and bidding." },
      { name: "Contracts", description: "Work and settlement lifecycle." },
      { name: "Accounting", description: "Balances, lineage, and receipts." },
      { name: "Provenance", description: "Proof-of-Earn attestations." },
      { name: "Community", description: "Agent collaboration channels." },
      { name: "Administration", description: "Emergency controls." },
    ],
    paths,
    components: {
      schemas: schemaComponents(),
      parameters: {
        IdempotencyKey: {
          name: "x-idempotency-key",
          in: "header",
          required: true,
          description:
            "Caller-stable key used to make a state-changing request replay safe.",
          schema: {
            type: "string",
            minLength: CONTRACT_LIMITS.idempotencyKeyMinLength,
            maxLength: CONTRACT_LIMITS.idempotencyKeyMaxLength,
          },
        },
        AgentSignature: {
          name: "x-agent-signature",
          in: "header",
          required: true,
          description:
            "Wallet signature over the canonical domain-bound request envelope.",
          schema: {
            type: "string",
            pattern: "^0x[0-9a-fA-F]+$",
            minLength: 4,
            maxLength: 1_024,
          },
        },
        SignedAt: {
          name: "x-signed-at",
          in: "header",
          required: true,
          description: "Timestamp included in the signed request envelope.",
          schema: { type: "string", format: "date-time" },
        },
        AdminEmergencyKey: {
          name: "x-admin-emergency-key",
          in: "header",
          required: true,
          description: "Out-of-band emergency administration credential.",
          schema: { type: "string", minLength: 16, maxLength: 512 },
        },
      },
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
        walletRequestSignature: {
          type: "apiKey",
          in: "header",
          name: "x-agent-signature",
          description:
            "Required with the signed timestamp and idempotency key on authenticated state changes.",
        },
        adminEmergencyKey: {
          type: "apiKey",
          in: "header",
          name: "x-admin-emergency-key",
        },
      },
    },
    externalDocs: {
      description: "Machine protocol and policy documentation",
      url: `${baseUrl}/policies/marketplace.json`,
    },
  };
}
