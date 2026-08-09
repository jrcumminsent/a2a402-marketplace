import {
  Ajv2020,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import {
  bigintJsonReplacer,
  MarketplaceError,
  type JsonValue,
} from "@a2a402/shared";
import {
  fastifySchemaForRoute,
  HTTP_ROUTE_CONTRACTS,
  runtimeSchemaDocuments,
  type ContractJsonSchema,
  type HttpRouteContract,
} from "./machine-docs.js";

interface RouteValidators {
  contract: HttpRouteContract;
  body?: ValidateFunction;
  params?: ValidateFunction;
  querystring?: ValidateFunction;
  responses: Map<string, ValidateFunction>;
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path.replace(
    /:([A-Za-z0-9_]+)/g,
    "{$1}",
  )}`;
}

function errorsForBoundary(
  errors: ErrorObject[] | null | undefined,
): Array<Record<string, JsonValue>> {
  return (errors ?? []).slice(0, 20).map((error) => ({
    path: error.instancePath || "/",
    keyword: error.keyword,
    message: error.message ?? "Schema validation failed.",
    params: responseBoundary(error.params) as Record<string, JsonValue>,
  }));
}

function responseBoundary(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value, bigintJsonReplacer)) as unknown;
}

function configureAjv(coerceTypes: boolean): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    coerceTypes,
    removeAdditional: false,
    strict: false,
    validateFormats: true,
  });
  ajv.addFormat("date-time", {
    type: "string",
    validate: (value: string) => Number.isFinite(Date.parse(value)),
  });
  ajv.addFormat("uri", {
    type: "string",
    validate: (value: string) => {
      try {
        void new URL(value);
        return true;
      } catch {
        return false;
      }
    },
  });
  ajv.addFormat(
    "uuid",
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  for (const schema of Object.values(runtimeSchemaDocuments())) {
    ajv.addSchema(schema);
  }
  return ajv;
}

export function installContractValidation(server: FastifyInstance): void {
  const strictAjv = configureAjv(false);
  const transportAjv = configureAjv(true);
  const routes = new Map<string, RouteValidators>();

  for (const contract of HTTP_ROUTE_CONTRACTS) {
    const schema = fastifySchemaForRoute(contract) as {
      body?: ContractJsonSchema;
      headers?: ContractJsonSchema;
      params?: ContractJsonSchema;
      querystring?: ContractJsonSchema;
      response?: Record<string, ContractJsonSchema>;
    };
    const responses = new Map<string, ValidateFunction>();
    for (const [status, responseSchema] of Object.entries(
      schema.response ?? {},
    )) {
      responses.set(status, strictAjv.compile(responseSchema));
    }
    routes.set(routeKey(contract.method, contract.path), {
      contract,
      ...(schema.body ? { body: strictAjv.compile(schema.body) } : {}),
      ...(schema.params
        ? { params: transportAjv.compile(schema.params) }
        : {}),
      ...(schema.querystring
        ? {
            querystring: transportAjv.compile(schema.querystring),
          }
        : {}),
      responses,
    });
  }

  const validatorsFor = (
    request: FastifyRequest,
  ): RouteValidators | undefined =>
    routes.get(
      routeKey(request.method, request.routeOptions.url ?? request.url),
    );

  server.addHook("onRequest", async (request) => {
    const validators = validatorsFor(request);
    const maximum = validators?.contract.maxBodyBytes;
    if (!maximum) return;
    const declaredLength = request.headers["content-length"];
    if (
      typeof declaredLength === "string" &&
      Number.isSafeInteger(Number(declaredLength)) &&
      Number(declaredLength) > maximum
    ) {
      throw new MarketplaceError(
        "VALIDATION_ERROR",
        "Request body exceeds the route size limit.",
        413,
        { maximum_bytes: maximum },
      );
    }
  });

  server.addHook("preValidation", async (request) => {
    const validators = validatorsFor(request);
    if (!validators) return;
    const boundaries: Array<
      [string, ValidateFunction | undefined, unknown]
    > = [
      ["params", validators.params, request.params],
      ["query", validators.querystring, request.query],
      ["body", validators.body, request.body],
    ];
    for (const [boundary, validate, value] of boundaries) {
      if (!validate || validate(value)) continue;
      throw new MarketplaceError(
        "VALIDATION_ERROR",
        `Request ${boundary} does not match the machine contract.`,
        400,
        {
          operation_id: validators.contract.id,
          boundary,
          errors: errorsForBoundary(validate.errors),
        },
      );
    }
  });

  server.addHook(
    "preSerialization",
    async (
      request: FastifyRequest,
      reply: FastifyReply,
      payload: unknown,
    ) => {
      const validators = validatorsFor(request);
      if (!validators || reply.statusCode === 204) return payload;
      const validate =
        validators.responses.get(String(reply.statusCode)) ??
        validators.responses.get("default");
      if (!validate) return payload;
      const boundary = responseBoundary(payload);
      if (validate(boundary)) return boundary;
      throw new MarketplaceError(
        "INTERNAL_ERROR",
        "Response does not match the published machine contract.",
        500,
        {
          operation_id: validators.contract.id,
          status_code: reply.statusCode,
          errors: errorsForBoundary(validate.errors),
        },
      );
    },
  );
}
