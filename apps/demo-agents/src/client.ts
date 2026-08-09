import type { FastifyInstance } from "fastify";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  communityMessageToSign,
  deliveryManifestMessage,
  registrationMessage,
  signedRequestMessage,
  type SignedDeliveryManifest,
} from "@a2a402/marketplace";
import { canonicalJson, sha256 } from "@a2a402/shared";

export interface ApiFailureBody {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details: Record<string, unknown>;
    request_id: string;
  };
}

export class DemoApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly body: ApiFailureBody,
  ) {
    super(`${body.error.code}: ${body.error.message}`);
  }
}

function deterministicKey(name: string): `0x${string}` {
  return `0x${sha256(`a2a402-demo-agent:${name}`)}`;
}

export class DemoAgentClient {
  readonly account: PrivateKeyAccount;
  readonly walletAddress: `0x${string}`;
  agentId: string | null = null;
  accessToken: string | null = null;
  private sequence = 0;

  constructor(
    readonly name: string,
    readonly capabilities: string[],
    private readonly server: FastifyInstance,
  ) {
    this.account = privateKeyToAccount(deterministicKey(name));
    this.walletAddress = this.account.address.toLowerCase() as `0x${string}`;
  }

  async register(): Promise<Record<string, unknown>> {
    const unsigned = {
      wallet_address: this.walletAddress,
      signing_key: this.walletAddress,
      external_agent_card_url: null,
      capabilities: [...this.capabilities].sort(),
      input_modalities: ["application/json"],
      output_modalities: ["application/json"],
    };
    const registration_signature = await this.account.signMessage({
      message: registrationMessage(unsigned),
    });
    const result = await this.request(
      "POST",
      "/v1/agents",
      {
        ...unsigned,
        registration_signature,
      },
      false,
    );
    this.agentId = String(result.id);
    return result;
  }

  async authenticate(): Promise<void> {
    if (!this.agentId) throw new Error(`${this.name} is not registered`);
    const challenge = await this.request(
      "POST",
      "/v1/auth/challenge",
      { agent_id: this.agentId },
      false,
    );
    const signature = await this.account.signMessage({
      message: String(challenge.challenge),
    });
    const verified = await this.request(
      "POST",
      "/v1/auth/verify",
      { nonce_id: challenge.id, signature },
      false,
    );
    this.accessToken = String(verified.access_token);
  }

  async request(
    method: string,
    path: string,
    body: Record<string, unknown> = {},
    authenticated = true,
  ): Promise<Record<string, any>> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    const isMutation = ["POST", "PATCH", "PUT", "DELETE"].includes(
      method.toUpperCase(),
    );
    if (isMutation) {
      const idempotencyKey = `${this.name}-${++this.sequence}-${sha256(path).slice(0, 12)}`;
      headers["x-idempotency-key"] = idempotencyKey;
      if (authenticated) {
        if (!this.accessToken || !this.agentId) {
          throw new Error(`${this.name} is not authenticated`);
        }
        headers.authorization = `Bearer ${this.accessToken}`;
        const signedAt = new Date().toISOString();
        headers["x-signed-at"] = signedAt;
        headers["x-agent-signature"] = await this.account.signMessage({
          message: signedRequestMessage({
            domain: "a2a402.market",
            agentId: this.agentId,
            method,
            path,
            idempotencyKey,
            signedAt,
            body,
          }),
        });
      }
    } else if (authenticated && this.accessToken) {
      headers.authorization = `Bearer ${this.accessToken}`;
    }
    const response = await this.server.inject({
      method: method as "GET" | "POST" | "PATCH" | "DELETE",
      url: path,
      headers,
      ...(isMutation ? { payload: body } : {}),
    });
    const parsed = response.body ? JSON.parse(response.body) : {};
    if (response.statusCode >= 400) {
      throw new DemoApiError(response.statusCode, parsed as ApiFailureBody);
    }
    return parsed as Record<string, any>;
  }

  async signedDelivery(input: {
    contractId: string;
    result: Record<string, unknown>;
    outputSchema: string;
    mimeType?: string;
  }): Promise<SignedDeliveryManifest> {
    if (!this.agentId) throw new Error("Agent is not registered");
    const hash = sha256(canonicalJson(input.result));
    const unsigned: Omit<SignedDeliveryManifest, "signature"> = {
      contract_id: input.contractId,
      seller_agent_id: this.agentId,
      artifact_uris: [`inline:sha256:${hash}`],
      artifact_hashes: [hash],
      artifact_mime_types: [input.mimeType ?? "application/json"],
      artifact_sizes: [Buffer.byteLength(canonicalJson(input.result))],
      output_schema: input.outputSchema,
      result: input.result as never,
      completed_at: new Date().toISOString(),
    };
    const signature = await this.account.signMessage({
      message: deliveryManifestMessage(unsigned),
    });
    return { ...unsigned, signature };
  }

  async signedCommunityMessage(input: {
    channelId: string;
    type:
      "discussion" | "proposal" | "request" | "announcement" | "collaboration";
    content: Record<string, unknown>;
    tags: string[];
    mentions?: string[];
    replyTo?: string | null;
  }): Promise<Record<string, unknown>> {
    if (!this.agentId) throw new Error("Agent is not registered");
    const unsigned = {
      channel_id: input.channelId,
      author_agent_id: this.agentId,
      type: input.type,
      content_type: "application/json" as const,
      content: input.content as never,
      tags: [...new Set(input.tags)].sort(),
      mentions: [...new Set(input.mentions ?? [])].sort(),
      reply_to: input.replyTo ?? null,
      expires_at: null,
    };
    const signature = await this.account.signMessage({
      message: communityMessageToSign(unsigned),
    });
    return { ...unsigned, signature };
  }
}
