import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MarketplaceEngine } from "@a2a402/marketplace";

import { buildApp } from "../apps/api/src/app.js";
import {
  ApiTestActor,
  TEST_ENGINE_CONFIG,
} from "./helpers/marketplace-fixtures.js";

describe("machine-first autonomous-agent discovery", () => {
  let server: FastifyInstance;
  let engine: MarketplaceEngine;

  beforeEach(async () => {
    ({ server, engine } = await buildApp({
      config: {
        nodeEnv: "test",
        paymentsMode: "mock",
        engine: TEST_ENGINE_CONFIG,
      },
    }));
    await server.ready();
  });

  afterEach(async () => server.close());

  it("publishes anonymous discovery and a lightweight agent document", async () => {
    const [discovery, agent, card, llms] = await Promise.all([
      server.inject({ method: "GET", url: "/api/discovery" }),
      server.inject({ method: "GET", url: "/.well-known/agent.json" }),
      server.inject({ method: "GET", url: "/.well-known/agent-card.json" }),
      server.inject({ method: "GET", url: "/llms.txt" }),
    ]);

    expect(discovery.statusCode).toBe(200);
    expect(discovery.json()).toMatchObject({
      type: "autonomous_agent_marketplace",
      environment: "test",
      human_registration_required_for_discovery: false,
      asset_warning: {
        asset: "A2A_TEST",
        real_money: false,
        redeemable_for_fiat: false,
        mainnet_enabled: false,
      },
    });
    expect(agent.statusCode).toBe(200);
    expect(agent.json()).toMatchObject({
      environment: "test",
      discovery: "https://a2a402.market/api/discovery",
    });
    expect(card.statusCode).toBe(200);
    expect(card.json().skills).toEqual(expect.any(Array));
    expect(card.json().description).toContain("A2A_TEST is not real money");
    expect(llms.statusCode).toBe(200);
    expect(llms.headers["content-type"]).toMatch(/^text\/plain/);
    expect(llms.body).toContain("A2A_TEST is not real money");
  });

  it("publishes concise opportunities and a non-real-money Genesis bounty", async () => {
    const opportunities = await server.inject({
      method: "GET",
      url: "/api/opportunities",
    });
    const bounty = await server.inject({
      method: "GET",
      url: "/api/bounties/autonomous-agent-genesis",
    });

    expect(opportunities.statusCode).toBe(200);
    expect(opportunities.json()).toMatchObject({
      environment: "test",
      currency_type: "test_asset",
      warning: { real_money: false, redeemable_for_fiat: false },
      opportunities: [
        expect.objectContaining({ id: "autonomous-agent-genesis" }),
      ],
    });
    expect(bounty.statusCode).toBe(200);
    expect(bounty.json()).toMatchObject({
      status: "open",
      reward: {
        amount_minor: "1000",
        asset: "A2A_TEST",
        real_money: false,
        redeemable_for_fiat: false,
      },
      verification: { proof_of_earn_status_before_completion: "unverified" },
    });
    expect(JSON.stringify(bounty.json())).not.toContain("private_key");
  });

  it("records bounded attribution idempotently and links Genesis sequence during registration", async () => {
    const first = await server.inject({
      method: "POST",
      url: "/api/discovery/evidence",
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": "discovery-evidence-001",
        referer: "https://search.example/results?q=a2a402&secret=nope",
        "user-agent": "ExampleAgent/1.0 private-fingerprint-data",
      },
      payload: {
        first_landing_endpoint: "/llms.txt?private_prompt=do-not-store",
        source: "moltbook",
        agent_framework: "example-agent",
      },
    });
    const replay = await server.inject({
      method: "POST",
      url: "/api/discovery/evidence",
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": "discovery-evidence-001",
        referer: "https://search.example/another-private-path",
        "user-agent": "ExampleAgent/1.0",
      },
      payload: {
        first_landing_endpoint: "/llms.txt?private_prompt=do-not-store",
        source: "moltbook",
        agent_framework: "example-agent",
      },
    });

    expect(first.statusCode, first.body).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(first.json().id);
    expect(first.json()).toMatchObject({
      firstLandingEndpoint: "/llms.txt",
      source: "moltbook",
      referrerOrigin: "https://search.example",
      userAgentFamily: "ExampleAgent",
      agentId: null,
    });
    expect(JSON.stringify(first.json())).not.toContain("q=a2a402");
    expect(JSON.stringify(first.json())).not.toContain("private_prompt");

    const actor = new ApiTestActor("genesis-agent", ["analysis"], server);
    const registration = await actor.register({
      discoveryEvidenceId: String(first.json().id),
    });
    expect(registration.statusCode).toBe(201);
    expect(engine.listGenesisAgents()).toEqual([
      expect.objectContaining({
        agentId: actor.agentId,
        sequence: 1,
        discoveryEvidenceId: first.json().id,
        discoverySource: "moltbook",
        humanDirectedDiscovery: "unknown",
        proofOfEarnStatus: "unverified",
      }),
    ]);
  });

  it("serves indexable semantic pages with canonical machine links", async () => {
    const pages = [
      "for-autonomous-agents",
      "agents/earn-money",
      "agents/spend-earned-money",
      "agents/hire-agents",
      "agent-to-agent-marketplace",
      "autonomous-agent-economy",
      "proof-of-earn",
    ];
    for (const page of pages) {
      const html = await readFile(`public/${page}/index.html`, "utf8");
      const normalizedHtml = html.replace(/\s+/g, " ");
      expect(normalizedHtml).toContain(
        `rel="canonical" href="https://a2a402.market/${page}"`,
      );
      expect(html).toContain('type="application/ld+json"');
      expect(normalizedHtml).toContain(
        "GET https://a2a402.market/api/discovery",
      );
      expect(normalizedHtml).toContain("A2A_TEST assets only");
    }
  });
});
