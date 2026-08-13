import { randomUUID } from "node:crypto";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { registrationMessage, signedRequestMessage } from "@a2a402/marketplace";

export type AgentPrivateKey = `0x${string}`;

export interface AgentRegistrationOptions {
  capabilities: string[];
  externalAgentCardUrl?: string | null;
  inputModalities?: string[];
  outputModalities?: string[];
}

export interface AgentIdentity {
  agentId: string;
  walletAddress: `0x${string}`;
}

export interface A2A402AgentClientOptions {
  marketplace: string;
  privateKey: AgentPrivateKey;
  fetch?: typeof globalThis.fetch;
  idempotencyKey?: () => string;
  now?: () => Date;
}

export interface MarketplaceDiscovery {
  manifest: Record<string, unknown>;
  agentCard: Record<string, unknown>;
  openapi: Record<string, unknown>;
  health: Record<string, unknown>;
}

export class A2A402HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    const error = body.error as { code?: string; message?: string } | undefined;
    super(
      error?.code && error.message
        ? `${error.code}: ${error.message}`
        : `a2a402 request failed with HTTP ${status}`,
    );
    this.name = "A2A402HttpError";
  }
}

function normalizedBaseUrl(value: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Marketplace URL must use HTTP or HTTPS.");
  }
  url.pathname = url.pathname.replace(/\/+$/u, "");
  url.search = "";
  url.hash = "";
  return url;
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Marketplace returned a non-object JSON response.");
  }
  return value as Record<string, unknown>;
}

export class A2A402AgentClient {
  readonly account: PrivateKeyAccount;
  readonly marketplace: URL;
  readonly walletAddress: `0x${string}`;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly newIdempotencyKey: () => string;
  private readonly now: () => Date;
  private identity: AgentIdentity | null = null;
  private accessToken: string | null = null;

  constructor(options: A2A402AgentClientOptions) {
    this.marketplace = normalizedBaseUrl(options.marketplace);
    this.account = privateKeyToAccount(options.privateKey);
    this.walletAddress = this.account.address.toLowerCase() as `0x${string}`;
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.newIdempotencyKey = options.idempotencyKey ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  get agentId(): string | null {
    return this.identity?.agentId ?? null;
  }

  get authenticated(): boolean {
    return Boolean(this.accessToken && this.identity);
  }

  useIdentity(identity: AgentIdentity): void {
    if (identity.walletAddress.toLowerCase() !== this.walletAddress) {
      throw new Error(
        "Agent identity does not belong to the configured wallet.",
      );
    }
    this.identity = {
      agentId: identity.agentId,
      walletAddress: this.walletAddress,
    };
    this.accessToken = null;
  }

  async discover(): Promise<MarketplaceDiscovery> {
    const [manifest, agentCard, openapi, health] = await Promise.all([
      this.publicGet("/"),
      this.publicGet("/.well-known/agent-card.json"),
      this.publicGet("/openapi.json"),
      this.publicGet("/health", [200, 503]),
    ]);
    if (manifest.protocol_version !== "a2a402/0.1") {
      throw new Error(
        "Marketplace protocol is not compatible with a2a402/0.1.",
      );
    }
    return { manifest, agentCard, openapi, health };
  }

  async register(
    options: AgentRegistrationOptions,
  ): Promise<Record<string, unknown>> {
    const unsigned = {
      wallet_address: this.walletAddress,
      signing_key: this.walletAddress,
      external_agent_card_url: options.externalAgentCardUrl ?? null,
      capabilities: [...new Set(options.capabilities)].sort(),
      input_modalities: [
        ...new Set(options.inputModalities ?? ["application/json"]),
      ].sort(),
      output_modalities: [
        ...new Set(options.outputModalities ?? ["application/json"]),
      ].sort(),
    };
    const registration_signature = await this.account.signMessage({
      message: registrationMessage(unsigned),
    });
    const registered = await this.request(
      "POST",
      "/v1/agents",
      { ...unsigned, registration_signature },
      { authenticated: false },
    );
    const agentId = String(registered.id ?? "");
    if (!agentId)
      throw new Error("Registration response omitted the agent ID.");
    this.identity = { agentId, walletAddress: this.walletAddress };
    this.accessToken = null;
    return registered;
  }

  async authenticate(): Promise<void> {
    if (!this.identity) {
      throw new Error("Register or configure an agent identity first.");
    }
    const challenge = await this.request(
      "POST",
      "/v1/auth/challenge",
      { agent_id: this.identity.agentId },
      { authenticated: false },
    );
    const signature = await this.account.signMessage({
      message: String(challenge.challenge ?? ""),
    });
    const verified = await this.request(
      "POST",
      "/v1/auth/verify",
      { nonce_id: String(challenge.id ?? ""), signature },
      { authenticated: false },
    );
    const token = String(verified.access_token ?? "");
    if (!token)
      throw new Error("Authentication response omitted the access token.");
    this.accessToken = token;
  }

  async connect(input: {
    identity?: AgentIdentity;
    registration?: AgentRegistrationOptions;
  }): Promise<Record<string, unknown> | null> {
    let registration: Record<string, unknown> | null = null;
    if (input.identity) this.useIdentity(input.identity);
    else if (input.registration)
      registration = await this.register(input.registration);
    else
      throw new Error(
        "connect requires an existing identity or registration options.",
      );
    await this.authenticate();
    return registration;
  }

  async request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    options: { authenticated?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    const normalizedMethod = method.toUpperCase();
    const mutation = ["POST", "PUT", "PATCH", "DELETE"].includes(
      normalizedMethod,
    );
    const payload = body ?? {};
    const headers: Record<string, string> = { accept: "application/json" };
    if (mutation) {
      headers["content-type"] = "application/json";
      const idempotencyKey = this.newIdempotencyKey();
      headers["x-idempotency-key"] = idempotencyKey;
      if (options.authenticated !== false) {
        if (!this.identity || !this.accessToken) {
          throw new Error(
            "Authenticated mutation requires connect() or authenticate().",
          );
        }
        const signedAt = this.now().toISOString();
        headers.authorization = `Bearer ${this.accessToken}`;
        headers["x-signed-at"] = signedAt;
        headers["x-agent-signature"] = await this.account.signMessage({
          message: signedRequestMessage({
            domain: this.marketplace.hostname,
            agentId: this.identity.agentId,
            method: normalizedMethod,
            path,
            idempotencyKey,
            signedAt,
            body: payload,
          }),
        });
      }
    } else if (options.authenticated !== false && this.accessToken) {
      headers.authorization = `Bearer ${this.accessToken}`;
    }
    return this.fetchJson(path, {
      method: normalizedMethod,
      headers,
      ...(mutation ? { body: JSON.stringify(payload) } : {}),
    });
  }

  private publicGet(
    path: string,
    acceptableStatuses: number[] = [200],
  ): Promise<Record<string, unknown>> {
    return this.fetchJson(
      path,
      {
        method: "GET",
        headers: { accept: "application/json" },
      },
      acceptableStatuses,
    );
  }

  private async fetchJson(
    path: string,
    init: RequestInit,
    acceptableStatuses?: number[],
  ): Promise<Record<string, unknown>> {
    const url = new URL(path, `${this.marketplace.toString()}/`);
    const response = await this.fetcher(url, init);
    const text = await response.text();
    const object = jsonObject(text ? (JSON.parse(text) as unknown) : {});
    if (!response.ok && !acceptableStatuses?.includes(response.status)) {
      throw new A2A402HttpError(response.status, object);
    }
    return object;
  }
}
