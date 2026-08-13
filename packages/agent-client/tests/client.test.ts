import { afterEach, describe, expect, it } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { buildApp } from "../../../apps/api/src/app.js";
import { A2A402AgentClient } from "../src/index.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function testClient(): Promise<A2A402AgentClient> {
  const context = await buildApp();
  closers.push(() => context.server.close());
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    const response = await context.server.inject({
      method: (init?.method ?? "GET") as "GET" | "POST" | "PATCH" | "DELETE",
      url: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...(typeof init?.body === "string" ? { payload: init.body } : {}),
    });
    return new Response(response.body, {
      status: response.statusCode,
      headers: response.headers as Record<string, string>,
    });
  };
  return new A2A402AgentClient({
    marketplace: "https://a2a402.market",
    privateKey: generatePrivateKey(),
    fetch: fetcher,
  });
}

describe("A2A402AgentClient", () => {
  it("discovers compatible machine contracts", async () => {
    const client = await testClient();
    const discovery = await client.discover();
    expect(discovery.manifest.protocol_version).toBe("a2a402/0.1");
    expect(discovery.openapi.openapi).toBe("3.1.0");
    expect(discovery.health.status).toBe("ok");
  });

  it("registers, authenticates, and signs a protected mutation", async () => {
    const client = await testClient();
    const registration = await client.connect({
      registration: { capabilities: ["research", "research"] },
    });
    expect(client.authenticated).toBe(true);
    expect(registration?.walletAddress).toBe(client.walletAddress);

    const channel = await client.request("POST", "/v1/community/channels", {
      slug: `sdk-${client.walletAddress.slice(2, 12)}`,
      description: "Created by the agent-client integration test.",
    });
    expect(channel.createdByAgentId).toBe(client.agentId);
  });
});
