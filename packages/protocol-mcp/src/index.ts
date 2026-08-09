import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import type { JsonValue } from "@a2a402/shared";

export const MCP_PROTOCOL_VERSION = "2025-11-25" as const;
export const MCP_HTTP_PATH = "/mcp" as const;

export const MARKETPLACE_MCP_ACTIONS = [
  "register_agent",
  "discover_agents",
  "discover_services",
  "create_listing",
  "purchase_listing",
  "post_job",
  "search_jobs",
  "submit_bid",
  "select_bid",
  "accept_bid",
  "accept_contract",
  "store_artifact",
  "deliver_artifact",
  "evaluate_delivery",
  "settle_job",
  "get_balance",
  "get_capital_provenance",
  "get_reputation",
  "post_community_message",
  "search_community",
] as const;

export type MarketplaceMcpAction = (typeof MARKETPLACE_MCP_ACTIONS)[number];

const READ_ONLY_ACTIONS = new Set<MarketplaceMcpAction>([
  "discover_agents",
  "discover_services",
  "search_jobs",
  "get_balance",
  "get_capital_provenance",
  "get_reputation",
  "search_community",
]);

export interface MarketplaceMcpToolDescriptor {
  name: MarketplaceMcpAction;
  title: string;
  description: string;
  readOnly: boolean;
}

const ACTION_DESCRIPTIONS: Record<MarketplaceMcpAction, string> = {
  register_agent: "Register a wallet-authenticated marketplace agent.",
  discover_agents: "Discover agents by capability, status, and reputation.",
  discover_services: "Search machine-readable digital service listings.",
  create_listing: "Create a versioned digital service or artifact listing.",
  purchase_listing:
    "Purchase an active fixed-price listing and create a contract.",
  post_job: "Post a fixed-price, open-bid, or bounty job.",
  search_jobs: "Search open marketplace jobs and bounties.",
  submit_bid: "Submit a signed bid for an open job.",
  accept_bid: "Accept a bid, reserve eligible capital, and create a contract.",
  select_bid:
    "Select the best eligible bid using the deterministic marketplace rule.",
  accept_contract:
    "Accept an awarded contract as the selected seller before its deadline.",
  store_artifact:
    "Store an immutable artifact object for a later signed delivery.",
  deliver_artifact: "Submit a signed delivery and artifact manifest.",
  evaluate_delivery: "Run schema and deterministic delivery evaluation.",
  settle_job: "Settle an accepted contract and record platform fees.",
  get_balance: "Read eligible and ineligible capital balances.",
  get_capital_provenance: "Read capital-lot provenance and lineage.",
  get_reputation: "Read machine-useful reputation dimensions.",
  post_community_message:
    "Publish a signed machine-readable community message.",
  search_community: "Search machine-readable community activity.",
};

export const MARKETPLACE_MCP_TOOLS: readonly MarketplaceMcpToolDescriptor[] =
  MARKETPLACE_MCP_ACTIONS.map((name) => ({
    name,
    title: name
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
    description: ACTION_DESCRIPTIONS[name],
    readOnly: READ_ONLY_ACTIONS.has(name),
  }));

export interface MarketplaceMcpRequest {
  action: MarketplaceMcpAction;
  input: Record<string, JsonValue>;
  idempotencyKey?: string;
  signedRequest?: string;
}

export interface MarketplaceMcpContext {
  toolName: MarketplaceMcpAction;
  sdkContext: unknown;
}

export interface MarketplaceMcpDispatcher {
  dispatch(
    request: MarketplaceMcpRequest,
    context: MarketplaceMcpContext,
  ): Promise<unknown>;
}

export class McpMarketplaceError extends Error {
  constructor(
    readonly code:
      | "MCP_INPUT_INVALID"
      | "MCP_IDEMPOTENCY_KEY_REQUIRED"
      | "MCP_OUTPUT_TOO_LARGE"
      | "MCP_DISPATCH_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "McpMarketplaceError";
  }
}

const toolInputSchema = z
  .object({
    input: z.record(z.string(), z.unknown()).default({}),
    idempotency_key: z.string().min(8).max(200).optional(),
    signed_request: z.string().max(262_144).optional(),
  })
  .strict();

export type MarketplaceMcpToolInput = z.infer<typeof toolInputSchema>;

function asJsonRecord(value: unknown): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new McpMarketplaceError(
      "MCP_INPUT_INVALID",
      "MCP marketplace tool input must be a JSON object.",
    );
  }
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  return JSON.parse(
    JSON.stringify(value, (_key, child) =>
      typeof child === "bigint" ? child.toString() : child,
    ),
  ) as JsonValue;
}

export async function invokeMarketplaceMcpTool(
  dispatcher: MarketplaceMcpDispatcher,
  action: MarketplaceMcpAction,
  input: MarketplaceMcpToolInput,
  sdkContext: unknown,
  maxOutputBytes = 2_097_152,
): Promise<Record<string, JsonValue>> {
  if (!READ_ONLY_ACTIONS.has(action) && !input.idempotency_key) {
    throw new McpMarketplaceError(
      "MCP_IDEMPOTENCY_KEY_REQUIRED",
      "State-changing marketplace tools require idempotency_key.",
    );
  }
  const request: MarketplaceMcpRequest = {
    action,
    input: asJsonRecord(input.input),
    ...(input.idempotency_key ? { idempotencyKey: input.idempotency_key } : {}),
    ...(input.signed_request ? { signedRequest: input.signed_request } : {}),
  };
  const result = await dispatcher.dispatch(request, {
    toolName: action,
    sdkContext,
  });
  const response: Record<string, JsonValue> = {
    ok: true,
    action,
    result: toJsonValue(result),
  };
  if (Buffer.byteLength(JSON.stringify(response), "utf8") > maxOutputBytes) {
    throw new McpMarketplaceError(
      "MCP_OUTPUT_TOO_LARGE",
      "Marketplace MCP result exceeds the configured output limit.",
    );
  }
  return response;
}

export interface MarketplaceMcpServerOptions {
  name?: string;
  version?: string;
  maxOutputBytes?: number;
}

export function createMarketplaceMcpServer(
  dispatcher: MarketplaceMcpDispatcher,
  options: MarketplaceMcpServerOptions = {},
): McpServer {
  const server = new McpServer(
    {
      name: options.name ?? "a2a402-market",
      version: options.version ?? "0.1.0",
    },
    {
      instructions:
        "Use read tools for discovery and balance checks before value-moving actions. State-changing tools require idempotency_key and authenticated calls require signed_request. Only verified agent-earned capital is eligible for real spending.",
    },
  );

  for (const descriptor of MARKETPLACE_MCP_TOOLS) {
    server.registerTool(
      descriptor.name,
      {
        title: descriptor.title,
        description: descriptor.description,
        inputSchema: toolInputSchema,
        annotations: {
          readOnlyHint: descriptor.readOnly,
          destructiveHint: false,
          idempotentHint: descriptor.readOnly ? true : true,
          openWorldHint:
            descriptor.name === "discover_agents" ||
            descriptor.name === "discover_services" ||
            descriptor.name === "search_community",
        },
      },
      async (input, sdkContext) => {
        try {
          const structuredContent = await invokeMarketplaceMcpTool(
            dispatcher,
            descriptor.name,
            input,
            sdkContext,
            options.maxOutputBytes,
          );
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(structuredContent),
              },
            ],
            structuredContent,
          };
        } catch (error) {
          const payload: Record<string, JsonValue> = {
            ok: false,
            error: {
              code:
                error instanceof McpMarketplaceError
                  ? error.code
                  : "MCP_DISPATCH_FAILED",
              message:
                error instanceof Error
                  ? error.message
                  : "Marketplace MCP dispatch failed.",
            },
          };
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(payload),
              },
            ],
            structuredContent: payload,
          };
        }
      },
    );
  }
  return server;
}

export interface StatelessMcpHttpOptions extends MarketplaceMcpServerOptions {
  allowedOrigins?: readonly string[];
  maxRequestBytes?: number;
}

function sendJsonRpcHttpError(
  response: ServerResponse,
  statusCode: number,
  code: number,
  message: string,
): void {
  if (response.headersSent) return;
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code, message },
      id: null,
    }),
  );
}

/**
 * Stateless Streamable HTTP bridge for Fastify/Node hosts. Pass `request.raw`,
 * `reply.raw`, and the already size-limited parsed JSON body. Authentication
 * must run before this function. A browser Origin is rejected unless explicitly
 * allowlisted.
 */
export async function handleStatelessMarketplaceMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  parsedBody: unknown,
  dispatcher: MarketplaceMcpDispatcher,
  options: StatelessMcpHttpOptions = {},
): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJsonRpcHttpError(response, 405, -32600, "Only POST is supported.");
    return;
  }
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    sendJsonRpcHttpError(
      response,
      415,
      -32600,
      "Content-Type must be application/json.",
    );
    return;
  }
  const accepts = (request.headers.accept ?? "").toLowerCase();
  if (
    !accepts.includes("application/json") ||
    !accepts.includes("text/event-stream")
  ) {
    sendJsonRpcHttpError(
      response,
      406,
      -32600,
      "Accept must allow application/json and text/event-stream.",
    );
    return;
  }
  const origin = request.headers.origin;
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  if (origin && !allowedOrigins.has(origin)) {
    sendJsonRpcHttpError(response, 403, -32600, "Origin is not allowed.");
    return;
  }
  const requestSize = Buffer.byteLength(JSON.stringify(parsedBody), "utf8");
  if (requestSize > (options.maxRequestBytes ?? 1_048_576)) {
    sendJsonRpcHttpError(response, 413, -32600, "MCP request is too large.");
    return;
  }

  const server = createMarketplaceMcpServer(dispatcher, options);
  // The SDK uses an explicitly undefined generator to select stateless mode,
  // while exactOptionalPropertyTypes rejects that value at the type boundary.
  const transportOptions = {
    sessionIdGenerator: undefined,
  } as unknown as ConstructorParameters<
    typeof StreamableHTTPServerTransport
  >[0];
  const transport = new StreamableHTTPServerTransport(transportOptions);
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await Promise.allSettled([transport.close(), server.close()]);
  };
  response.once("close", () => {
    void close();
  });
  try {
    await server.connect(transport as unknown as Transport);
    await transport.handleRequest(request, response, parsedBody);
  } finally {
    await close();
  }
}
