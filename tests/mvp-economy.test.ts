import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, type JsonValue } from "@a2a402/shared";
import {
  MvpMarketplace,
  mvpSigningPayload,
  type MvpSignedRequest,
} from "@a2a402/marketplace";

function keyPair(): { privateKey: KeyObject; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  };
}

function signature(privateKey: KeyObject, payload: string): string {
  return sign(null, Buffer.from(payload), privateKey).toString("base64");
}

function register(market: MvpMarketplace, name: string) {
  const keys = keyPair();
  const body = {
    public_key: keys.publicKey,
    display_name: name,
    endpoint: null,
    capabilities: ["deterministic-json"],
  };
  return {
    keys,
    agent: market.registerAgent({
      ...body,
      registration_signature: signature(keys.privateKey, canonicalJson(body)),
    }),
  };
}

function auth(
  privateKey: KeyObject,
  agentId: string,
  method: string,
  path: string,
  body: JsonValue,
  nonce: string,
): MvpSignedRequest {
  const timestamp = new Date().toISOString();
  return {
    agent_id: agentId,
    timestamp,
    nonce,
    signature: signature(privateKey, mvpSigningPayload(method, path, timestamp, nonce, body)),
  };
}

describe("a2a402 MVP Proof-of-Earn loop", () => {
  it("settles Genesis → Agent A → Agent B with an auditable proof chain", () => {
    const market = new MvpMarketplace();
    const agentA = register(market, "Agent A");
    const agentB = register(market, "Agent B");
    const genesis = market.listJobs().find((job) => job.job_id === "job_genesis_bounty")!;

    market.acceptJob(agentA.agent.agent_id, genesis.job_id,
      auth(agentA.keys.privateKey, agentA.agent.agent_id, "POST", `/api/v1/jobs/${genesis.job_id}/accept`, { job_id: genesis.job_id }, "a-accept-genesis"), "idempotent-a-accept");
    const genesisPayload = { normalized: "GENESIS_OK", value: 42 };
    const firstSettlement = market.submitJob(agentA.agent.agent_id, genesis.job_id,
      auth(agentA.keys.privateKey, agentA.agent.agent_id, "POST", `/api/v1/jobs/${genesis.job_id}/submit`, { job_id: genesis.job_id, payload: genesisPayload }, "a-submit-genesis"), genesisPayload, "idempotent-a-submit");
    const firstProof = market.getProof(firstSettlement.proof_id);
    expect(market.getBalance(agentA.agent.agent_id)).toMatchObject({ earned_available: "1000", earned_reserved: "0" });
    expect(market.verifyProof(firstProof).valid).toBe(true);
    expect(market.verifyProof({ ...firstProof, amount: "999" }).valid).toBe(false);

    const childBody = { title: "Deterministic child task", description: "Return the required JSON.", reward: "300", expected_result: { result: "CHILD_OK" } };
    const child = market.createJob(agentA.agent.agent_id,
      auth(agentA.keys.privateKey, agentA.agent.agent_id, "POST", "/api/v1/jobs", childBody, "a-create-child"), childBody, "idempotent-a-create");
    expect(market.getBalance(agentA.agent.agent_id)).toMatchObject({ earned_available: "700", earned_reserved: "300" });

    market.acceptJob(agentB.agent.agent_id, child.job_id,
      auth(agentB.keys.privateKey, agentB.agent.agent_id, "POST", `/api/v1/jobs/${child.job_id}/accept`, { job_id: child.job_id }, "b-accept-child"), "idempotent-b-accept");
    const childPayload = { result: "CHILD_OK" };
    const secondSettlement = market.submitJob(agentB.agent.agent_id, child.job_id,
      auth(agentB.keys.privateKey, agentB.agent.agent_id, "POST", `/api/v1/jobs/${child.job_id}/submit`, { job_id: child.job_id, payload: childPayload }, "b-submit-child"), childPayload, "idempotent-b-submit");
    const secondProof = market.getProof(secondSettlement.proof_id);

    expect(market.getBalance(agentA.agent.agent_id)).toMatchObject({ earned_available: "700", earned_reserved: "0" });
    expect(market.getBalance(agentB.agent.agent_id)).toMatchObject({ earned_available: "300", earned_reserved: "0" });
    expect(market.verifyProof(secondProof).valid).toBe(true);
    expect(secondProof.provenance_references).toEqual([firstProof.proof_id]);
    expect(market.provenance(secondProof.proof_id)).toEqual([firstProof.proof_id, secondProof.proof_id]);
    expect(market.settle(child.job_id)).toEqual(secondSettlement);
  });

  it("rejects replay, tampering, overspending, and unauthorized submissions", () => {
    const market = new MvpMarketplace();
    const agentA = register(market, "Agent A");
    const agentB = register(market, "Agent B");
    const genesis = market.listJobs()[0]!;
    const replay = auth(agentA.keys.privateKey, agentA.agent.agent_id, "POST", `/api/v1/jobs/${genesis.job_id}/accept`, { job_id: genesis.job_id }, "replayed-nonce");
    market.acceptJob(agentA.agent.agent_id, genesis.job_id, replay, "first-accept-key");
    expect(() => market.acceptJob(agentA.agent.agent_id, genesis.job_id, replay, "second-accept-key")).toThrow(expect.objectContaining({ code: "AUTH_NONCE_REPLAYED" }));
    expect(() => market.submitJob(agentB.agent.agent_id, genesis.job_id,
      auth(agentB.keys.privateKey, agentB.agent.agent_id, "POST", `/api/v1/jobs/${genesis.job_id}/submit`, { job_id: genesis.job_id, payload: {} }, "bad-submitter"), {}, "bad-submitter-key")).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    const unaffordable = { title: "Too expensive", description: "Must not be fundable.", reward: "1", expected_result: {} };
    expect(() => market.createJob(agentA.agent.agent_id,
      auth(agentA.keys.privateKey, agentA.agent.agent_id, "POST", "/api/v1/jobs", unaffordable, "overspend"), unaffordable, "overspend-key")).toThrow(expect.objectContaining({ code: "INSUFFICIENT_ELIGIBLE_CAPITAL" }));
  });
});
