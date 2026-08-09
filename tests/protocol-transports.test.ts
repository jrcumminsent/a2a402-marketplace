import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../apps/api/src/app.js";
import { MARKETPLACE_A2A_ACTIONS } from "@a2a402/protocol-a2a";
import { MARKETPLACE_MCP_ACTIONS } from "@a2a402/protocol-mcp";
import { TEST_ENGINE_CONFIG } from "./helpers/marketplace-fixtures.js";

function parseJsonRpcResponse(
  response: LightMyRequestResponse,
): Record<string, unknown> {
  const body = response.body.trim();
  if (body.startsWith("{")) {
    return JSON.parse(body) as Record<string, unknown>;
  }
  const data = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
    .at(-1);
  if (!data) {
    throw new Error(
      `Expected a JSON-RPC or SSE data response, received: ${body}`,
    );
  }
  return JSON.parse(data) as Record<string, unknown>;
}

function findActionEnvelope(
  value: unknown,
  action: string,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findActionEnvelope(child, action);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok === true && record.action === action && "result" in record) {
    return record;
  }
  for (const child of Object.values(record)) {
    const found = findActionEnvelope(child, action);
    if (found) return found;
  }
  return null;
}

describe("official A2A and MCP Fastify transports", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    ({ server } = await buildApp({
      config: {
        nodeEnv: "test",
        paymentsMode: "mock",
        engine: TEST_ENGINE_CONFIG,
      },
    }));
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it("dispatches anonymous discovery through the official A2A SendMessage method", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/a2a",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "a2a-version": "1.0",
      },
      payload: {
        jsonrpc: "2.0",
        id: "a2a-discovery-1",
        method: "SendMessage",
        params: {
          message: {
            messageId: "message-discovery-1",
            role: "ROLE_USER",
            parts: [
              {
                data: {
                  action: "discover_agents",
                  input: {},
                },
              },
            ],
          },
          configuration: {
            acceptedOutputModes: ["application/json"],
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["a2a-version"]).toBe("1.0");
    const rpc = parseJsonRpcResponse(response);
    expect(rpc).toMatchObject({
      jsonrpc: "2.0",
      id: "a2a-discovery-1",
    });
    expect(rpc).not.toHaveProperty("error");
    const envelope = findActionEnvelope(rpc.result, "discover_agents");
    expect(envelope).toMatchObject({
      ok: true,
      action: "discover_agents",
      result: [],
    });

    const card = (
      await server.inject({
        method: "GET",
        url: "/.well-known/agent-card.json",
      })
    ).json();
    expect(card.skills.map((skill: { id: string }) => skill.id)).toEqual(
      MARKETPLACE_A2A_ACTIONS,
    );
  });

  it("negotiates MCP initialization and lists every official marketplace tool", async () => {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    const initialized = await server.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: "mcp-initialize-1",
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: {
            name: "a2a402-vitest-client",
            version: "1.0.0",
          },
        },
      },
    });
    expect(initialized.statusCode).toBe(200);
    const initializeRpc = parseJsonRpcResponse(initialized);
    expect(initializeRpc).toMatchObject({
      jsonrpc: "2.0",
      id: "mcp-initialize-1",
      result: {
        protocolVersion: "2025-11-25",
        serverInfo: {
          name: "a2a402-market",
          version: "0.1.0",
        },
        capabilities: {
          tools: {},
        },
      },
    });
    expect(initializeRpc).not.toHaveProperty("error");

    const listed = await server.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        ...headers,
        "mcp-protocol-version": "2025-11-25",
      },
      payload: {
        jsonrpc: "2.0",
        id: "mcp-tools-list-1",
        method: "tools/list",
        params: {},
      },
    });
    expect(listed.statusCode).toBe(200);
    const listRpc = parseJsonRpcResponse(listed);
    expect(listRpc).toMatchObject({
      jsonrpc: "2.0",
      id: "mcp-tools-list-1",
    });
    expect(listRpc).not.toHaveProperty("error");
    const result = listRpc.result as {
      tools: Array<{
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
      }>;
    };
    expect(result.tools.map((tool) => tool.name)).toEqual(
      MARKETPLACE_MCP_ACTIONS,
    );
    for (const tool of result.tools) {
      expect(tool.description).toEqual(expect.any(String));
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }
  });
});
