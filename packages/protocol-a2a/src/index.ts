import { uuid, type JsonValue } from "@a2a402/shared";
import { Role, type AgentCard, type Message } from "@a2a-js/sdk";
import {
  AgentEvent,
  DefaultRequestHandler,
  InMemoryTaskStore,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
  type TaskStore,
} from "@a2a-js/sdk/server";

export const A2A_PROTOCOL_VERSION = "1.0" as const;
export const A2A_AGENT_CARD_PATH = "/.well-known/agent-card.json" as const;
export const A2A_JSON_RPC_PATH = "/a2a" as const;

export const MARKETPLACE_A2A_ACTIONS = [
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

export type MarketplaceA2AAction = (typeof MARKETPLACE_A2A_ACTIONS)[number];

const ACTION_DESCRIPTIONS: Record<MarketplaceA2AAction, string> = {
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

export interface MarketplaceA2ARequest {
  action: MarketplaceA2AAction;
  input: Record<string, JsonValue>;
  idempotencyKey?: string;
  signedRequest?: string;
}

export interface MarketplaceA2AContext {
  taskId: string;
  contextId: string;
  messageId: string;
  requestContext: RequestContext;
}

export interface MarketplaceA2ADispatcher {
  dispatch(
    request: MarketplaceA2ARequest,
    context: MarketplaceA2AContext,
  ): Promise<unknown>;
}

export class A2AProtocolError extends Error {
  constructor(
    readonly code:
      | "A2A_INPUT_INVALID"
      | "A2A_ACTION_UNSUPPORTED"
      | "A2A_INPUT_TOO_LARGE"
      | "A2A_REQUEST_CANCELED",
    message: string,
  ) {
    super(message);
    this.name = "A2AProtocolError";
  }
}

export interface MarketplaceAgentCardOptions {
  baseUrl: string;
  version?: string;
  documentationUrl?: string;
  requireBearerAuth?: boolean;
}

function normalizeBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new A2AProtocolError(
      "A2A_INPUT_INVALID",
      "The A2A base URL must use HTTP or HTTPS.",
    );
  }
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1", "::1"].includes(url.hostname)
  ) {
    throw new A2AProtocolError(
      "A2A_INPUT_INVALID",
      "Non-local A2A endpoints must use HTTPS.",
    );
  }
  return url;
}

export function buildMarketplaceAgentCard(
  options: MarketplaceAgentCardOptions,
): AgentCard {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const a2aUrl = new URL(A2A_JSON_RPC_PATH, baseUrl).toString();
  const card = {
    name: "a2a402 Agent-Origin Market",
    description:
      "Machine-only TEST marketplace for A2A_TEST agent-earned capital, digital work, deterministic delivery evaluation, and economic reputation. A2A_TEST is not real money or redeemable for fiat; mainnet settlement is disabled.",
    supportedInterfaces: [
      {
        url: a2aUrl,
        protocolBinding: "JSONRPC",
        protocolVersion: A2A_PROTOCOL_VERSION,
      },
    ],
    provider: {
      organization: "a2a402.market",
      url: baseUrl.toString(),
    },
    version: options.version ?? "0.1.0",
    ...(options.documentationUrl
      ? { documentationUrl: options.documentationUrl }
      : {}),
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    },
    defaultInputModes: ["application/json", "text/plain"],
    defaultOutputModes: ["application/json"],
    skills: MARKETPLACE_A2A_ACTIONS.map((action) => ({
      id: action,
      name: action,
      description: ACTION_DESCRIPTIONS[action],
      tags: ["a2a402", "marketplace", action],
      examples: [
        JSON.stringify({
          action,
          input: {},
          ...(action.startsWith("get_") ||
          action.startsWith("search_") ||
          action.startsWith("discover_")
            ? {}
            : { idempotencyKey: "unique-request-key" }),
        }),
      ],
      inputModes: ["application/json", "text/plain"],
      outputModes: ["application/json"],
    })),
    ...(options.requireBearerAuth === false
      ? {}
      : {
          securitySchemes: {
            bearerAuth: {
              httpAuthSecurityScheme: {
                description:
                  "Short-lived access token issued after wallet-signature authentication.",
                scheme: "Bearer",
                bearerFormat: "JWT",
              },
            },
          },
          securityRequirements: [
            {
              schemes: {
                bearerAuth: { list: [] },
              },
            },
          ],
        }),
  };
  // The object above intentionally follows the v1 ProtoJSON AgentCard shape.
  // Keeping the cast here isolates generated protobuf type representation details.
  return card as unknown as AgentCard;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readPartData(part: unknown): unknown {
  if (!isRecord(part)) return undefined;
  if ("data" in part) return part.data;
  const content = part.content;
  if (isRecord(content) && content.$case === "data" && "value" in content) {
    return content.value;
  }
  return undefined;
}

function readPartText(part: unknown): string | undefined {
  if (!isRecord(part)) return undefined;
  if (typeof part.text === "string") return part.text;
  const content = part.content;
  if (
    isRecord(content) &&
    content.$case === "text" &&
    typeof content.value === "string"
  ) {
    return content.value;
  }
  return undefined;
}

function asJsonRecord(value: unknown): Record<string, JsonValue> {
  if (!isRecord(value)) {
    throw new A2AProtocolError(
      "A2A_INPUT_INVALID",
      "Marketplace action input must be a JSON object.",
    );
  }
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
  } catch {
    throw new A2AProtocolError(
      "A2A_INPUT_INVALID",
      "Marketplace action input must be JSON serializable.",
    );
  }
}

export function parseMarketplaceA2AMessage(
  message: Message,
  maxInputBytes = 1_048_576,
): MarketplaceA2ARequest {
  const rawMessage = message as unknown as Record<string, unknown>;
  const rawParts = Array.isArray(rawMessage.parts) ? rawMessage.parts : [];
  let envelope: unknown;
  for (const part of rawParts) {
    const data = readPartData(part);
    if (data !== undefined) {
      envelope = data;
      break;
    }
    const text = readPartText(part);
    if (text !== undefined) {
      try {
        envelope = JSON.parse(text) as unknown;
      } catch {
        throw new A2AProtocolError(
          "A2A_INPUT_INVALID",
          "Text A2A parts must contain a JSON action envelope.",
        );
      }
      break;
    }
  }
  if (!isRecord(envelope)) {
    throw new A2AProtocolError(
      "A2A_INPUT_INVALID",
      "A2A message requires a data part or JSON text part.",
    );
  }
  const encodedBytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  if (encodedBytes > maxInputBytes) {
    throw new A2AProtocolError(
      "A2A_INPUT_TOO_LARGE",
      "A2A marketplace action exceeds the configured input limit.",
    );
  }
  const action = envelope.action;
  if (
    typeof action !== "string" ||
    !MARKETPLACE_A2A_ACTIONS.includes(action as MarketplaceA2AAction)
  ) {
    throw new A2AProtocolError(
      "A2A_ACTION_UNSUPPORTED",
      "The A2A marketplace action is not supported.",
    );
  }
  const idempotencyKey =
    typeof envelope.idempotencyKey === "string"
      ? envelope.idempotencyKey
      : typeof envelope.idempotency_key === "string"
        ? envelope.idempotency_key
        : undefined;
  const signedRequest =
    typeof envelope.signedRequest === "string"
      ? envelope.signedRequest
      : typeof envelope.signed_request === "string"
        ? envelope.signed_request
        : undefined;
  return {
    action: action as MarketplaceA2AAction,
    input: asJsonRecord(envelope.input ?? {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(signedRequest ? { signedRequest } : {}),
  };
}

function createA2ADataMessage(
  requestContext: RequestContext,
  value: Record<string, JsonValue>,
): Message {
  const request = requestContext as unknown as {
    taskId: string;
    contextId: string;
  };
  const message = {
    role: Role.ROLE_AGENT,
    messageId: uuid(),
    parts: [
      {
        content: { $case: "data", value },
        filename: "",
        mediaType: "application/json",
      },
    ],
    taskId: request.taskId,
    contextId: request.contextId,
    extensions: [],
    metadata: {},
    referenceTaskIds: [],
  };
  return message as unknown as Message;
}

function serializableResult(value: unknown): JsonValue {
  if (value === undefined) return null;
  return JSON.parse(
    JSON.stringify(value, (_key, child) =>
      typeof child === "bigint" ? child.toString() : child,
    ),
  ) as JsonValue;
}

export interface MarketplaceAgentExecutorOptions {
  maxInputBytes?: number;
}

export class MarketplaceAgentExecutor implements AgentExecutor {
  private readonly canceledTasks = new Set<string>();
  private readonly maxInputBytes: number;

  constructor(
    private readonly dispatcher: MarketplaceA2ADispatcher,
    options: MarketplaceAgentExecutorOptions = {},
  ) {
    this.maxInputBytes = options.maxInputBytes ?? 1_048_576;
  }

  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const context = requestContext as unknown as {
      taskId: string;
      contextId: string;
      userMessage: Message;
    };
    try {
      const request = parseMarketplaceA2AMessage(
        context.userMessage,
        this.maxInputBytes,
      );
      if (this.canceledTasks.has(context.taskId)) {
        throw new A2AProtocolError(
          "A2A_REQUEST_CANCELED",
          "The A2A request was canceled.",
        );
      }
      const result = await this.dispatcher.dispatch(request, {
        taskId: context.taskId,
        contextId: context.contextId,
        messageId: (context.userMessage as unknown as { messageId: string })
          .messageId,
        requestContext,
      });
      if (this.canceledTasks.has(context.taskId)) {
        throw new A2AProtocolError(
          "A2A_REQUEST_CANCELED",
          "The A2A request was canceled.",
        );
      }
      eventBus.publish(
        AgentEvent.message(
          createA2ADataMessage(requestContext, {
            ok: true,
            action: request.action,
            result: serializableResult(result),
          }),
        ),
      );
    } catch (error) {
      eventBus.publish(
        AgentEvent.message(
          createA2ADataMessage(requestContext, {
            ok: false,
            error: {
              code:
                error instanceof A2AProtocolError
                  ? error.code
                  : "A2A_DISPATCH_FAILED",
              message:
                error instanceof Error
                  ? error.message
                  : "Marketplace A2A dispatch failed.",
            },
          }),
        ),
      );
    } finally {
      this.canceledTasks.delete(context.taskId);
      eventBus.finished();
    }
  }

  async cancelTask(
    taskId: string,
    _eventBus: ExecutionEventBus,
  ): Promise<void> {
    this.canceledTasks.add(taskId);
  }
}

export interface MarketplaceA2AComponents {
  agentCard: AgentCard;
  executor: MarketplaceAgentExecutor;
  taskStore: TaskStore;
  requestHandler: DefaultRequestHandler;
}

/**
 * Returns official SDK primitives. HTTP authentication must be applied by the
 * host before its JSON-RPC transport; do not use no-authentication middleware
 * for state-changing marketplace actions.
 */
export function createMarketplaceA2AComponents(
  cardOptions: MarketplaceAgentCardOptions,
  dispatcher: MarketplaceA2ADispatcher,
  executorOptions: MarketplaceAgentExecutorOptions = {},
): MarketplaceA2AComponents {
  const agentCard = buildMarketplaceAgentCard(cardOptions);
  const executor = new MarketplaceAgentExecutor(dispatcher, executorOptions);
  const taskStore: TaskStore = new InMemoryTaskStore();
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    taskStore,
    executor,
  );
  return { agentCard, executor, taskStore, requestHandler };
}
