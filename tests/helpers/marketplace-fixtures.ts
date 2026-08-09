import { createPublicKey, verify as verifySignature } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  MarketplaceEngine,
  communityMessageToSign,
  deliveryManifestMessage,
  registrationMessage,
  signedRequestMessage,
  type Agent,
  type CommunityMessage,
  type Contract,
  type Evaluation,
  type MarketplaceConfig,
  type Settlement,
  type SignedDeliveryManifest,
} from "@a2a402/marketplace";
import { canonicalJson, sha256, type JsonValue } from "@a2a402/shared";

export const TEST_ENGINE_CONFIG: MarketplaceConfig = {
  baseUrl: "http://localhost:3000",
  publicMarketUrl: "https://a2a402.market",
  domain: "a2a402.market",
  simulationMode: true,
  platformFeeBps: 500,
  jwtSecret: "test-jwt-secret-that-is-more-than-thirty-two-bytes",
  nonceTtlSeconds: 300,
  tokenTtlSeconds: 900,
  maxJobAmountMinor: 100_000_000n,
  maxAgentDailySpendMinor: 250_000_000n,
  maxArtifactBytes: 10_000,
  communityMessagesPerMinute: 30,
};

export interface TestActor {
  account: PrivateKeyAccount;
  agent: Agent;
}

export interface ContractFixture {
  buyer: TestActor;
  seller: TestActor;
  contract: Contract;
  jobId: string;
  bidId: string;
}

export interface SettledContractFixture extends ContractFixture {
  result: JsonValue;
  evaluation: Evaluation;
  settlement: Settlement;
}

export function accountFor(name: string): PrivateKeyAccount {
  return privateKeyToAccount(`0x${sha256(`a2a402-tests:${name}`)}`);
}

export function createTestEngine(
  overrides: Partial<MarketplaceConfig> = {},
): MarketplaceEngine {
  return new MarketplaceEngine({ ...TEST_ENGINE_CONFIG, ...overrides });
}

export async function registerActor(
  engine: MarketplaceEngine,
  name: string,
  capabilities: string[] = ["seller"],
): Promise<TestActor> {
  const account = accountFor(name);
  const walletAddress = account.address.toLowerCase() as `0x${string}`;
  const unsigned = {
    wallet_address: walletAddress,
    signing_key: walletAddress,
    external_agent_card_url: null,
    capabilities: [...new Set(capabilities)].sort(),
    input_modalities: ["application/json"],
    output_modalities: ["application/json"],
  };
  const registration_signature = await account.signMessage({
    message: registrationMessage(unsigned),
  });
  const agent = await engine.registerAgent({
    ...unsigned,
    registration_signature,
  });
  return { account, agent };
}

export function standardJobInput(
  amountMinor: bigint,
  overrides: Partial<Parameters<MarketplaceEngine["createJob"]>[1]> = {},
): Parameters<MarketplaceEngine["createJob"]>[1] {
  return {
    type: "fixed_price",
    title: "Deterministic test job",
    description: "Produce one machine-readable result.",
    input: { request: "test" },
    input_schema: {
      type: "object",
      required: ["request"],
      properties: { request: { type: "string" } },
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      required: ["ok", "value"],
      properties: {
        ok: { const: true },
        value: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
    maximum_execution_seconds: 300,
    budget_minor: amountMinor,
    asset: "USDC",
    required_capabilities: ["seller"],
    acceptance_rules: [{ path: "$.ok", operator: "equals", value: true }],
    artifact_mime_types: ["application/json"],
    maximum_artifact_bytes: 1_024,
    tags: ["test"],
    policy_category: "analysis",
    ...overrides,
  };
}

export async function createContractFixture(
  engine: MarketplaceEngine,
  options: {
    prefix: string;
    amountMinor?: bigint;
    fundBuyer?: boolean;
    fundingAmountMinor?: bigint;
    fundingOrigin?:
      | "marketplace_earned"
      | "verified_external_agent_earned"
      | "human_seeded"
      | "unknown"
      | "platform_test_funds";
    buyer?: TestActor;
    seller?: TestActor;
    jobOverrides?: Partial<Parameters<MarketplaceEngine["createJob"]>[1]>;
  },
): Promise<ContractFixture> {
  const amountMinor = options.amountMinor ?? 1_000n;
  const buyer =
    options.buyer ??
    (await registerActor(engine, `${options.prefix}-buyer`, ["buyer"]));
  const seller =
    options.seller ??
    (await registerActor(engine, `${options.prefix}-seller`, ["seller"]));
  if (options.fundBuyer ?? true) {
    engine.importCapital({
      agentId: buyer.agent.id,
      amountMinor: options.fundingAmountMinor ?? amountMinor,
      originType: options.fundingOrigin ?? "platform_test_funds",
    });
  }
  const job = engine.createJob(
    buyer.agent.id,
    standardJobInput(amountMinor, options.jobOverrides),
  );
  const bid = engine.submitBid(seller.agent.id, job.id, {
    amount_minor: amountMinor,
    asset: "USDC",
    execution_seconds: 60,
    proposal: { method: "deterministic" },
  });
  const contract = await engine.acceptBid(buyer.agent.id, job.id, bid.id);
  return { buyer, seller, contract, jobId: job.id, bidId: bid.id };
}

export async function signedManifest(
  actor: TestActor,
  contractId: string,
  result: JsonValue,
  overrides: Partial<Omit<SignedDeliveryManifest, "signature">> = {},
): Promise<SignedDeliveryManifest> {
  const resultHash = sha256(canonicalJson(result));
  const unsigned: Omit<SignedDeliveryManifest, "signature"> = {
    contract_id: contractId,
    seller_agent_id: actor.agent.id,
    artifact_uris: [`inline:sha256:${resultHash}`],
    artifact_hashes: [resultHash],
    artifact_mime_types: ["application/json"],
    artifact_sizes: [Buffer.byteLength(canonicalJson(result))],
    output_schema: "https://a2a402.market/schemas/test-output",
    result,
    completed_at: new Date().toISOString(),
    ...overrides,
  };
  const signature = await actor.account.signMessage({
    message: deliveryManifestMessage(unsigned),
  });
  return { ...unsigned, signature };
}

export async function settleFixture(
  engine: MarketplaceEngine,
  fixture: ContractFixture,
  result: JsonValue = { ok: true, value: "complete" },
): Promise<SettledContractFixture> {
  const manifest = await signedManifest(
    fixture.seller,
    fixture.contract.id,
    result,
  );
  await engine.submitDelivery(
    fixture.seller.agent.id,
    fixture.contract.id,
    manifest,
  );
  const evaluation = engine.evaluateDelivery(
    fixture.buyer.agent.id,
    fixture.contract.id,
  );
  engine.acceptDelivery(fixture.buyer.agent.id, fixture.contract.id);
  const settlement = await engine.settleContract(
    fixture.buyer.agent.id,
    fixture.contract.id,
  );
  return { ...fixture, result, evaluation, settlement };
}

export function verifyPlatformValue(
  engine: MarketplaceEngine,
  value: unknown,
  signature: string,
): boolean {
  const publicKey = createPublicKey({
    key: engine.signer.publicJwk,
    format: "jwk",
  });
  return verifySignature(
    null,
    Buffer.from(canonicalJson(value)),
    publicKey,
    Buffer.from(signature, "base64url"),
  );
}

export class ApiTestActor {
  readonly account: PrivateKeyAccount;
  readonly walletAddress: `0x${string}`;
  agentId: string | null = null;
  accessToken: string | null = null;
  private sequence = 0;

  constructor(
    readonly name: string,
    readonly capabilities: string[],
    readonly server: FastifyInstance,
  ) {
    this.account = accountFor(`api-${name}`);
    this.walletAddress = this.account.address.toLowerCase() as `0x${string}`;
  }

  nextKey(label = "mutation"): string {
    this.sequence += 1;
    return `${this.name}-${label}-${this.sequence}`.padEnd(8, "x");
  }

  async register(
    options: {
      idempotencyKey?: string;
      signature?: `0x${string}`;
    } = {},
  ): Promise<LightMyRequestResponse> {
    const unsigned = {
      wallet_address: this.walletAddress,
      signing_key: this.walletAddress,
      external_agent_card_url: null,
      capabilities: [...new Set(this.capabilities)].sort(),
      input_modalities: ["application/json"],
      output_modalities: ["application/json"],
    };
    const registration_signature =
      options.signature ??
      (await this.account.signMessage({
        message: registrationMessage(unsigned),
      }));
    const response = await this.server.inject({
      method: "POST",
      url: "/v1/agents",
      headers: {
        "content-type": "application/json",
        "x-idempotency-key":
          options.idempotencyKey ?? this.nextKey("registration"),
      },
      payload: { ...unsigned, registration_signature },
    });
    if (response.statusCode < 400) {
      this.agentId = String(response.json().id);
    }
    return response;
  }

  async authenticate(): Promise<void> {
    if (!this.agentId) throw new Error(`${this.name} is not registered`);
    const challengeResponse = await this.server.inject({
      method: "POST",
      url: "/v1/auth/challenge",
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": this.nextKey("challenge"),
      },
      payload: { agent_id: this.agentId },
    });
    if (challengeResponse.statusCode !== 200) {
      throw new Error(challengeResponse.body);
    }
    const challenge = challengeResponse.json();
    const signature = await this.account.signMessage({
      message: String(challenge.challenge),
    });
    const verifyResponse = await this.server.inject({
      method: "POST",
      url: "/v1/auth/verify",
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": this.nextKey("verify"),
      },
      payload: { nonce_id: challenge.id, signature },
    });
    if (verifyResponse.statusCode !== 200) {
      throw new Error(verifyResponse.body);
    }
    this.accessToken = String(verifyResponse.json().access_token);
  }

  async signedMutation(
    method: "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body: Record<string, unknown>,
    options: {
      idempotencyKey?: string;
      signedAt?: string;
      signature?: `0x${string}`;
      token?: string;
    } = {},
  ): Promise<LightMyRequestResponse> {
    if (!this.agentId || !this.accessToken) {
      throw new Error(`${this.name} is not authenticated`);
    }
    const idempotencyKey =
      options.idempotencyKey ?? this.nextKey(path.replaceAll("/", "-"));
    const signedAt = options.signedAt ?? new Date().toISOString();
    const signature =
      options.signature ??
      (await this.account.signMessage({
        message: signedRequestMessage({
          domain: TEST_ENGINE_CONFIG.domain,
          agentId: this.agentId,
          method,
          path,
          idempotencyKey,
          signedAt,
          body,
        }),
      }));
    return this.server.inject({
      method,
      url: path,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.token ?? this.accessToken}`,
        "x-idempotency-key": idempotencyKey,
        "x-signed-at": signedAt,
        "x-agent-signature": signature,
      },
      payload: body,
    });
  }

  async signedCommunityInput(input: {
    channelId: string;
    content: JsonValue;
    tags?: string[];
    mentions?: string[];
    type?: CommunityMessage["type"];
  }): Promise<Record<string, unknown>> {
    if (!this.agentId) throw new Error(`${this.name} is not registered`);
    const unsigned = {
      channel_id: input.channelId,
      author_agent_id: this.agentId,
      type: input.type ?? ("discussion" as const),
      content_type: "application/json" as const,
      content: input.content,
      tags: [...new Set(input.tags ?? [])].sort(),
      mentions: [...new Set(input.mentions ?? [])].sort(),
      reply_to: null,
      expires_at: null,
    };
    const signature = await this.account.signMessage({
      message: communityMessageToSign(unsigned),
    });
    return { ...unsigned, signature };
  }
}
