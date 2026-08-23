import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../apps/api/src/app.js";
import type { MarketplaceEngine } from "@a2a402/marketplace";
import {
  ApiTestActor,
  TEST_ENGINE_CONFIG,
  accountFor,
  registerActor,
} from "./helpers/marketplace-fixtures.js";

const VALID_BID = {
  amount_minor: "300000",
  asset: "USDC",
  execution_seconds: 300,
  proposal: { method: "deterministic_genesis_test" },
};

describe("canonical seeded Genesis bid progression", () => {
  let server: FastifyInstance | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  async function setup(): Promise<{
    engine: MarketplaceEngine;
    genesisJobId: string;
  }> {
    const app = await buildApp({
      config: {
        nodeEnv: "test",
        paymentsMode: "mock",
        seedSimulationOpportunities: true,
        engine: TEST_ENGINE_CONFIG,
      },
    });
    server = app.server;
    await server.ready();
    const designation = app.engine.getCanonicalSeededGenesisDesignation();
    if (!designation) throw new Error("Genesis job was not designated");
    return { engine: app.engine, genesisJobId: designation.jobId };
  }

  async function authenticatedSeller(name: string): Promise<ApiTestActor> {
    if (!server) throw new Error("Server is not initialized");
    const actor = new ApiTestActor(name, ["protocol_analysis"], server);
    expect((await actor.register()).statusCode).toBe(201);
    await actor.authenticate();
    return actor;
  }

  it("atomically accepts the first valid Genesis bid and returns its contract ID", async () => {
    const { engine, genesisJobId } = await setup();
    const seller = await authenticatedSeller("genesis-winner");

    const response = await seller.signedMutation(
      "POST",
      `/v1/jobs/${genesisJobId}/bids`,
      VALID_BID,
    );

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: "accepted",
    });
    expect(response.json()).not.toHaveProperty("auto_accepted");
    expect(response.json()).not.toHaveProperty("contract_id");
    expect(response.headers.location).toMatch(/^\/v1\/contracts\//);
    expect(response.headers["x-a2a402-contract-id"]).toEqual(
      expect.any(String),
    );
    expect(engine.getJob(genesisJobId).status).toBe("awarded");
    expect(engine.listContracts()).toHaveLength(1);
    expect(engine.listContracts()[0]).toMatchObject({
      id: response.headers["x-a2a402-contract-id"],
      bidId: response.json().id,
      sellerAgentId: seller.agentId,
    });
  });

  it("does not allow a second bid to win the Genesis job", async () => {
    const { engine, genesisJobId } = await setup();
    const first = await authenticatedSeller("genesis-first");
    const second = await authenticatedSeller("genesis-second");
    expect(
      (
        await first.signedMutation(
          "POST",
          `/v1/jobs/${genesisJobId}/bids`,
          VALID_BID,
        )
      ).statusCode,
    ).toBe(201);

    const losingResponse = await second.signedMutation(
      "POST",
      `/v1/jobs/${genesisJobId}/bids`,
      VALID_BID,
    );

    expect(losingResponse.statusCode).toBe(409);
    expect(losingResponse.json().error.code).toBe("INVALID_STATE_TRANSITION");
    expect(engine.listContracts()).toHaveLength(1);
    expect(engine.listBids(genesisJobId)).toHaveLength(1);
  });

  it("serializes concurrent Genesis bids so exactly one contract is created", async () => {
    const { engine, genesisJobId } = await setup();
    const first = await authenticatedSeller("genesis-concurrent-a");
    const second = await authenticatedSeller("genesis-concurrent-b");

    const responses = await Promise.all([
      first.signedMutation("POST", `/v1/jobs/${genesisJobId}/bids`, VALID_BID),
      second.signedMutation("POST", `/v1/jobs/${genesisJobId}/bids`, VALID_BID),
    ]);

    expect(
      responses.filter((response) => response.statusCode === 201),
    ).toHaveLength(1);
    expect(
      responses.filter((response) => response.statusCode === 409),
    ).toHaveLength(1);
    expect(engine.listContracts()).toHaveLength(1);
    expect(engine.listBids(genesisJobId)).toHaveLength(1);
  });

  it("leaves normal open-bid jobs in submitted status", async () => {
    const { engine } = await setup();
    const buyer = await registerActor(engine, "normal-buyer", ["buyer"]);
    engine.importCapital({
      agentId: buyer.agent.id,
      amountMinor: "500000",
      originType: "platform_test_funds",
      provenanceScope: "simulation",
    });
    const normalJob = engine.createJob(buyer.agent.id, {
      type: "open_bid",
      title: "Normal open bid",
      description: "This job requires ordinary buyer selection.",
      input: {},
      input_schema: { type: "object" },
      output_schema: { type: "object" },
      budget_minor: "400000",
      asset: "USDC",
      required_capabilities: ["protocol_analysis"],
    });
    const seller = await authenticatedSeller("normal-job-seller");

    const response = await seller.signedMutation(
      "POST",
      `/v1/jobs/${normalJob.id}/bids`,
      VALID_BID,
    );

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ status: "submitted" });
    expect(response.json()).not.toHaveProperty("contract_id");
    expect(response.headers.location).toBeUndefined();
    expect(response.headers["x-a2a402-contract-id"]).toBeUndefined();
    expect(engine.getJob(normalJob.id).status).toBe("open");
    expect(engine.listContracts()).toHaveLength(0);
  });

  it("does not accept invalid, unauthenticated, or incorrectly signed bids", async () => {
    const { engine, genesisJobId } = await setup();
    if (!server) throw new Error("Server is not initialized");

    const unauthenticated = await server.inject({
      method: "POST",
      url: `/v1/jobs/${genesisJobId}/bids`,
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": "genesis-unauthenticated",
      },
      payload: VALID_BID,
    });
    expect(unauthenticated.statusCode).toBe(401);

    const seller = await authenticatedSeller("genesis-invalid");
    const invalid = await seller.signedMutation(
      "POST",
      `/v1/jobs/${genesisJobId}/bids`,
      { ...VALID_BID, amount_minor: "400001" },
    );
    expect(invalid.statusCode).toBe(422);

    const forged = await seller.signedMutation(
      "POST",
      `/v1/jobs/${genesisJobId}/bids`,
      VALID_BID,
      {
        signature: await accountFor("wrong-genesis-signer").signMessage({
          message: "not the canonical request",
        }),
      },
    );
    expect(forged.statusCode).toBe(401);
    expect(forged.json().error.code).toBe("SIGNATURE_INVALID");
    expect(engine.getJob(genesisJobId).status).toBe("open");
    expect(engine.listBids(genesisJobId)).toHaveLength(0);
    expect(engine.listContracts()).toHaveLength(0);
  });

  it("replays an idempotent Genesis response without creating another contract", async () => {
    const { engine, genesisJobId } = await setup();
    const seller = await authenticatedSeller("genesis-idempotent");
    const idempotencyKey = "genesis-idempotent-bid";

    const first = await seller.signedMutation(
      "POST",
      `/v1/jobs/${genesisJobId}/bids`,
      VALID_BID,
      { idempotencyKey },
    );
    const replay = await seller.signedMutation(
      "POST",
      `/v1/jobs/${genesisJobId}/bids`,
      VALID_BID,
      { idempotencyKey },
    );

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(replay.headers.location).toBe(first.headers.location);
    expect(replay.headers["x-a2a402-contract-id"]).toBe(
      first.headers["x-a2a402-contract-id"],
    );
    expect(engine.listBids(genesisJobId)).toHaveLength(1);
    expect(engine.listContracts()).toHaveLength(1);
  });
});
