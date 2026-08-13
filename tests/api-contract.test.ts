import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../apps/api/src/app.js";
import { PRIMARY_ACTIONS } from "../apps/api/src/machine-docs.js";
import { registrationMessage } from "@a2a402/marketplace";
import {
  ApiTestActor,
  TEST_ENGINE_CONFIG,
  accountFor,
} from "./helpers/marketplace-fixtures.js";

describe("public API identity and machine contract", () => {
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

  it("fails storage health closed when durable storage is not injected", async () => {
    await server.close();
    ({ server } = await buildApp({
      config: {
        nodeEnv: "test",
        paymentsMode: "mock",
        artifactStorageMode: "s3",
        engine: TEST_ENGINE_CONFIG,
      },
    }));
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "degraded",
      storage: { status: "unavailable", mode: "s3" },
    });
  });

  it("always serves machine discovery JSON at the root", async () => {
    const root = await server.inject({
      method: "GET",
      url: "/",
      headers: { accept: "application/json" },
    });
    expect(root.statusCode).toBe(200);
    expect(root.headers["content-type"]).toMatch(/^application\/json/);
    expect(root.json()).toMatchObject({
      type: "autonomous_agent_marketplace",
      environment: "test",
      protocol_version: "a2a402/0.1",
      asset_warning: {
        asset: "A2A_TEST",
        real_money: false,
        redeemable_for_fiat: false,
        mainnet_enabled: false,
      },
      discovery: {
        discovery_api: "https://a2a402.market/api/discovery",
        human_marketplace: "https://a2a402.market/marketplace/",
      },
    });

    const browserRoot = await server.inject({
      method: "GET",
      url: "/",
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    expect(browserRoot.statusCode).toBe(200);
    expect(browserRoot.headers["content-type"]).toMatch(/^application\/json/);
    expect(browserRoot.headers.location).toBeUndefined();

    const obsoleteRoute = await server.inject({
      method: "GET",
      url: "/observer/",
    });
    expect(obsoleteRoute.statusCode).toBe(404);

    const response = await server.inject({
      method: "GET",
      url: "/.well-known/agent-card.json",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["a2a-version"]).toBe("1.0");
    const card = response.json();
    expect(card).toMatchObject({
      name: "a2a402 Agent-Origin Market",
      version: "0.1.0",
      capabilities: {
        streaming: false,
        pushNotifications: false,
      },
      defaultInputModes: ["application/json", "text/plain"],
      defaultOutputModes: ["application/json"],
      supportedInterfaces: [
        {
          url: "https://a2a402.market/a2a",
          protocolBinding: "JSONRPC",
          protocolVersion: "1.0",
        },
      ],
    });
    expect(card.skills.map((skill: { id: string }) => skill.id)).toEqual(
      PRIMARY_ACTIONS,
    );
    expect(
      new Set(card.skills.map((skill: { id: string }) => skill.id)).size,
    ).toBe(PRIMARY_ACTIONS.length);
    for (const skill of card.skills) {
      expect(skill).toMatchObject({
        inputModes: ["application/json", "text/plain"],
        outputModes: ["application/json"],
      });
      expect(skill.description).toEqual(expect.any(String));
    }
  });

  it("registers only the wallet that signed the canonical registration", async () => {
    const valid = new ApiTestActor("registration-valid", ["analysis"], server);
    const accepted = await valid.register();
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json()).toMatchObject({
      walletAddress: valid.walletAddress,
      signingKey: valid.walletAddress,
      capabilities: ["analysis"],
      status: "active",
    });

    const victim = new ApiTestActor(
      "registration-victim",
      ["analysis"],
      server,
    );
    const attacker = accountFor("registration-attacker");
    const unsigned = {
      wallet_address: victim.walletAddress,
      signing_key: victim.walletAddress,
      external_agent_card_url: null,
      capabilities: ["analysis"],
      input_modalities: ["application/json"],
      output_modalities: ["application/json"],
    };
    const forgedSignature = await attacker.signMessage({
      message: registrationMessage(unsigned),
    });
    const rejected = await victim.register({ signature: forgedSignature });
    expect(rejected.statusCode).toBe(401);
    expect(rejected.json().error.code).toBe("SIGNATURE_INVALID");
  });

  it("rejects a replayed authentication nonce, including concurrent replay", async () => {
    const actor = new ApiTestActor("nonce-replay", ["analysis"], server);
    expect((await actor.register()).statusCode).toBe(201);

    const challengeResponse = await server.inject({
      method: "POST",
      url: "/v1/auth/challenge",
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": "nonce-challenge-unique",
      },
      payload: { agent_id: actor.agentId },
    });
    expect(challengeResponse.statusCode).toBe(200);
    const challenge = challengeResponse.json();
    const signature = await actor.account.signMessage({
      message: challenge.challenge,
    });
    const verify = (key: string) =>
      server.inject({
        method: "POST",
        url: "/v1/auth/verify",
        headers: {
          "content-type": "application/json",
          "x-idempotency-key": key,
        },
        payload: { nonce_id: challenge.id, signature },
      });

    const attempts = await Promise.all([
      verify("nonce-verify-attempt-a"),
      verify("nonce-verify-attempt-b"),
    ]);
    expect(
      attempts.filter((response) => response.statusCode === 200),
    ).toHaveLength(1);
    const replay = attempts.find((response) => response.statusCode !== 200);
    expect(replay?.statusCode).toBe(409);
    expect(replay?.json().error.code).toBe("AUTH_NONCE_REPLAYED");

    const third = await verify("nonce-verify-attempt-c");
    expect(third.statusCode).toBe(409);
    expect(third.json().error.code).toBe("AUTH_NONCE_REPLAYED");
  });

  it("requires an authenticated, current request signature for sensitive mutations", async () => {
    const actor = new ApiTestActor("request-signature", ["seller"], server);
    expect((await actor.register()).statusCode).toBe(201);
    await actor.authenticate();
    const body = {
      type: "service",
      title: "Signed service",
      description: "A signed listing mutation.",
      output_schema: { type: "object" },
      price_minor: "1000",
    };

    const missing = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${actor.accessToken}`,
        "x-idempotency-key": "signed-listing-missing",
      },
      payload: body,
    });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error.code).toBe("SIGNATURE_INVALID");

    const wrongSigner = accountFor("wrong-request-signer");
    const forged = await actor.signedMutation("POST", "/v1/listings", body, {
      idempotencyKey: "signed-listing-forged",
      signature: await wrongSigner.signMessage({ message: "not the request" }),
    });
    expect(forged.statusCode).toBe(401);
    expect(forged.json().error.code).toBe("SIGNATURE_INVALID");

    const stale = await actor.signedMutation("POST", "/v1/listings", body, {
      idempotencyKey: "signed-listing-stale",
      signedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
    });
    expect(stale.statusCode).toBe(401);
    expect(stale.json().error.code).toBe("SIGNATURE_INVALID");

    const valid = await actor.signedMutation("POST", "/v1/listings", body);
    expect(valid.statusCode).toBe(201);
  });

  it("deduplicates identical mutations and rejects idempotency-key reuse with new input", async () => {
    const actor = new ApiTestActor("idempotency", ["seller"], server);
    expect((await actor.register()).statusCode).toBe(201);
    await actor.authenticate();
    const key = "listing-idempotency-key";
    const body = {
      type: "service",
      title: "Idempotent service",
      description: "Created exactly once.",
      output_schema: { type: "object" },
      price_minor: "1000",
      tags: ["one"],
    };

    const [first, second] = await Promise.all([
      actor.signedMutation("POST", "/v1/listings", body, {
        idempotencyKey: key,
      }),
      actor.signedMutation("POST", "/v1/listings", body, {
        idempotencyKey: key,
      }),
    ]);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());

    const conflict = await actor.signedMutation(
      "POST",
      "/v1/listings",
      { ...body, price_minor: "2000" },
      { idempotencyKey: key },
    );
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");

    const listings = await server.inject({
      method: "GET",
      url: "/v1/listings",
    });
    expect(listings.json().pagination.total).toBe(1);

    const missingKey = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${actor.accessToken}`,
      },
      payload: body,
    });
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json().error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });
});
