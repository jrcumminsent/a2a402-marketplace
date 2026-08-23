import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import rateLimit from "@fastify/rate-limit";
import { JsonRpcTransportHandler, ServerCallContext } from "@a2a-js/sdk/server";
import {
  MarketplaceEngine,
  MvpMarketplace,
  type MvpSignedRequest,
  PlatformSigner,
  type Agent,
  type AgentRegistration,
  type CommunityMessage,
  type JobStatus,
  type JobType,
  type ListingType,
  type OperationalMetricName,
} from "@a2a402/marketplace";
import { SchemaEvaluator } from "@a2a402/evaluation";
import { X402TestnetPaymentAdapter } from "@a2a402/payments";
import {
  AllowlistedSignedAttestationVerifier,
  DeterministicTestVerifier,
  type EarningAttestation,
} from "@a2a402/provenance";
import {
  createMarketplaceA2AComponents,
  type MarketplaceA2ADispatcher,
  type MarketplaceA2ARequest,
} from "@a2a402/protocol-a2a";
import {
  handleStatelessMarketplaceMcpRequest,
  type MarketplaceMcpDispatcher,
  type MarketplaceMcpRequest,
} from "@a2a402/protocol-mcp";
import {
  bigintJsonReplacer,
  errorEnvelope,
  fetchAgentCardSafely,
  LocalArtifactStorage,
  MarketplaceError,
  requireIdempotencyKey,
  secureEqual,
  type ArtifactStorage,
  type JsonValue,
} from "@a2a402/shared";
import { executeMarketplaceAction } from "./actions.js";
import { loadConfig, type AppConfig } from "./config.js";
import {
  marketplaceManifest,
  marketplacePolicy,
  onboardingDocument,
  proofOfEarnPolicy,
  publicSchemas,
} from "./machine-docs.js";
import { openApiDocument } from "./openapi.js";
import { createSecretProtector } from "./secrets.js";
import {
  createBaseSepoliaTransactionReader,
  createBaseSepoliaX402ChainReader,
} from "./base-sepolia.js";
import { MarketplaceRuntime } from "./runtime.js";
import { installContractValidation } from "./contract-validation.js";
import { sendAgentSignupEmail } from "./signup-notifications.js";
import { installFunnelTelemetry } from "./funnel-telemetry.js";
import {
  ensureSimulationSeedOpportunities,
  isCanonicalSeededGenesisJob,
} from "./simulation-seed.js";
import { createOperatorAlerter } from "./operator-alerts.js";
import {
  autonomousMarketplaceDiscovery,
  genesisBounty,
  lightweightAgentDocument,
  publicOpportunity,
} from "./machine-discovery.js";

type ObjectBody = Record<string, unknown>;

export interface AppContext {
  server: FastifyInstance;
  engine: MarketplaceEngine;
  config: AppConfig;
  runtime: MarketplaceRuntime;
}

const runtimeByEngine = new WeakMap<MarketplaceEngine, MarketplaceRuntime>();

function runtimeFor(engine: MarketplaceEngine): MarketplaceRuntime {
  const runtime = runtimeByEngine.get(engine);
  if (!runtime) {
    throw new MarketplaceError(
      "INTERNAL_ERROR",
      "Marketplace runtime is not initialized.",
      503,
      {},
      true,
    );
  }
  return runtime;
}

function readEngine<T>(
  engine: MarketplaceEngine,
  reader: () => T | Promise<T>,
): Promise<T> {
  return runtimeFor(engine).runRead(reader);
}

function objectBody(request: FastifyRequest): ObjectBody {
  if (
    !request.body ||
    typeof request.body !== "object" ||
    Array.isArray(request.body)
  ) {
    throw new MarketplaceError(
      "VALIDATION_ERROR",
      "A JSON object body is required.",
    );
  }
  return request.body as ObjectBody;
}

function stringHeader(
  request: FastifyRequest,
  name: string,
): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function authenticatedAgent(
  engine: MarketplaceEngine,
  request: FastifyRequest,
): Agent {
  const authorization = stringHeader(request, "authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new MarketplaceError(
      "AUTH_REQUIRED",
      "Bearer authentication is required.",
      401,
    );
  }
  return engine.authenticate(authorization.slice(7));
}

async function mutate<T>(
  engine: MarketplaceEngine,
  request: FastifyRequest,
  scope: string,
  options: {
    authenticated: boolean;
    signed: boolean;
    subject?: (body: ObjectBody) => string;
  },
  action: (body: ObjectBody, actor: Agent | null) => Promise<T> | T,
): Promise<T> {
  const body = objectBody(request);
  const key = requireIdempotencyKey(stringHeader(request, "x-idempotency-key"));
  const path = request.url.split("?")[0] ?? request.url;
  return runtimeFor(engine).runMutation(
    async () => {
      const actor = options.authenticated
        ? authenticatedAgent(engine, request)
        : null;
      const subject = actor?.id ?? options.subject?.(body) ?? "public";
      if (options.signed) {
        if (!actor)
          throw new MarketplaceError(
            "AUTH_REQUIRED",
            "Authentication is required.",
            401,
          );
        const signedAt = stringHeader(request, "x-signed-at");
        const signature = stringHeader(request, "x-agent-signature");
        if (!signedAt || !signature?.startsWith("0x")) {
          throw new MarketplaceError(
            "SIGNATURE_INVALID",
            "x-signed-at and x-agent-signature headers are required.",
            401,
          );
        }
        await engine.verifySignedRequest({
          agentId: actor.id,
          method: request.method,
          path,
          idempotencyKey: key,
          signedAt,
          body,
          signature: signature as `0x${string}`,
        });
      }
      return engine.withIdempotency(
        subject,
        scope,
        key,
        {
          method: request.method,
          path,
          body,
        },
        () => action(body, actor),
      );
    },
    {
      mutationId: `rest:${scope}:${key}`,
      lockKeys: [`rest:${scope}`, `subject:${path}`],
    },
  );
}

function page<T>(items: T[], query: ObjectBody): Record<string, unknown> {
  const limit = Math.min(100, Math.max(1, Number(query.limit ?? 50)));
  const offset = Math.max(0, Number(query.offset ?? 0));
  if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(offset)) {
    throw new MarketplaceError(
      "VALIDATION_ERROR",
      "Pagination values must be integers.",
    );
  }
  const data = items.slice(offset, offset + limit);
  return {
    data,
    pagination: {
      limit,
      offset,
      total: items.length,
      next_offset: offset + limit < items.length ? offset + limit : null,
    },
  };
}

function params(request: FastifyRequest): Record<string, string> {
  return request.params as Record<string, string>;
}

function query(request: FastifyRequest): ObjectBody {
  return (request.query ?? {}) as ObjectBody;
}

function boundedString(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maximum) : null;
}

function referrerOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

function userAgentFamily(value: string | undefined): string | null {
  if (!value) return null;
  const family = value.split(/[\s/;(]/u)[0]?.trim();
  return family ? family.slice(0, 80) : null;
}

export async function buildApp(
  options: {
    config?: Partial<AppConfig>;
    engine?: MarketplaceEngine;
    artifactStorage?: ArtifactStorage;
  } = {},
): Promise<AppContext> {
  const config = loadConfig(options.config);
  const artifactStorage =
    options.artifactStorage ??
    (config.artifactStorageMode === "local"
      ? new LocalArtifactStorage({
          rootPath: config.artifactStoragePath,
          maxBytes: config.engine.maxArtifactBytes,
        })
      : null);
  const paymentSigner = new PlatformSigner(
    config.engine.signingPrivateKeyPem,
    config.engine.signingKeyId,
  );
  const x402ChainReader =
    config.paymentsMode === "x402-testnet" && config.baseSepoliaRpcUrl
      ? createBaseSepoliaX402ChainReader({
          rpcUrl: config.baseSepoliaRpcUrl,
          assetAddress: config.x402AssetAddress,
          assetSymbol: "USDC",
        })
      : null;
  const paymentAdapter =
    config.paymentsMode === "x402-testnet" && config.platformSettlementAddress
      ? new X402TestnetPaymentAdapter({
          platformSettlementAddress: config.platformSettlementAddress,
          facilitatorUrl: config.x402FacilitatorUrl,
          assetAddress: config.x402AssetAddress,
          network: config.x402Network,
          enableMainnet: false,
          ...(x402ChainReader ? { chainReader: x402ChainReader } : {}),
          signOffer: async (payload) => paymentSigner.sign(payload).signature,
          signReceipt: async (payload) => paymentSigner.sign(payload).signature,
        })
      : null;
  const webhookSecretProtector = config.webhookSecretEncryptionKey
    ? createSecretProtector(config.webhookSecretEncryptionKey)
    : null;
  const externalEarningVerifier = config.engine.simulationMode
    ? new DeterministicTestVerifier()
    : new AllowlistedSignedAttestationVerifier(
        new Set(config.externalEarningIssuerAllowlist),
        createBaseSepoliaTransactionReader({
          rpcUrl: config.baseSepoliaRpcUrl as string,
          assetAddress: config.x402AssetAddress,
          assetSymbol: "USDC",
        }),
      );
  const engine =
    options.engine ??
    new MarketplaceEngine({
      ...config.engine,
      ...(artifactStorage ? { artifactStorage } : {}),
      ...(paymentAdapter ? { paymentAdapter } : {}),
      evaluators: [new SchemaEvaluator()],
      ...(webhookSecretProtector
        ? {
            protectWebhookSecret: webhookSecretProtector.protect,
            unprotectWebhookSecret: webhookSecretProtector.unprotect,
          }
        : {}),
    });
  const runtime = new MarketplaceRuntime(engine, {
    databaseUrl: config.databaseUrl,
    runtimeMode: config.engine.simulationMode ? "simulation" : "real",
  });
  try {
    await runtime.initialize();
    if (config.seedSimulationOpportunities) {
      await ensureSimulationSeedOpportunities(engine, runtime);
    }
    runtimeByEngine.set(engine, runtime);
  } catch (error) {
    await runtime.close().catch(() => undefined);
    throw error;
  }
  const server = Fastify({
    logger:
      config.nodeEnv === "test"
        ? false
        : {
            level: process.env.LOG_LEVEL ?? "info",
            redact: {
              paths: [
                "req.headers.authorization",
                "req.headers.x-agent-signature",
                "req.headers.payment-signature",
                "*.privateKey",
                "*.secret",
                "*.token",
              ],
              censor: "[REDACTED]",
            },
          },
    bodyLimit: Math.min(
      Math.ceil((config.engine.maxArtifactBytes * 4) / 3) + 1_000_000,
      20_000_000,
    ),
    requestIdHeader: "x-request-id",
    genReqId: () => crypto.randomUUID(),
  });
  const recordOperationalMetric = (
    metric: OperationalMetricName,
    requestId: string,
  ) =>
    runtime.runMutation(
      () => {
        engine.recordOperationalMetric(metric);
      },
      {
        mutationId: `telemetry:${metric}:${requestId}`,
        lockKeys: ["telemetry:funnel"],
      },
    );
  installFunnelTelemetry(server, recordOperationalMetric);
  const sendOperatorAlert = createOperatorAlerter({
    webhookUrl: config.operatorAlertWebhookUrl,
    email: config.agentSignupEmail,
  });
  server.setReplySerializer((payload) =>
    JSON.stringify(payload, bigintJsonReplacer),
  );
  // This deliberately isolated compatibility surface never shares capital,
  // identities, or settlement state with the broader USDC/x402 marketplace.
  const mvp = new MvpMarketplace();
  server.setErrorHandler(async (error, request, reply) => {
    const normalized =
      error instanceof MarketplaceError
        ? error
        : new MarketplaceError(
            "INTERNAL_ERROR",
            config.nodeEnv === "production"
              ? "An internal error occurred."
              : error instanceof Error
                ? error.message
                : "An internal error occurred.",
            (error as { statusCode?: number }).statusCode ?? 500,
          );
    if (normalized.code === "INSUFFICIENT_ELIGIBLE_CAPITAL") {
      reply.header(
        "payment-required",
        Buffer.from(
          JSON.stringify({
            x402Version: 2,
            error: normalized.code,
            accepts: [],
            internal_reservation_required: true,
          }),
        ).toString("base64"),
      );
    }
    if (
      normalized.code === "PAYMENT_REQUIRED" &&
      typeof normalized.details.payment_required_header === "string" &&
      normalized.details.payment_required_header
    ) {
      reply.header(
        "payment-required",
        normalized.details.payment_required_header,
      );
    }
    if (normalized.statusCode >= 500) {
      request.log.error(
        {
          event: "marketplace.operator_alert",
          kind: "api_crash",
          request_id: request.id,
          error_code: normalized.code,
        },
        "Unhandled marketplace API failure.",
      );
      await sendOperatorAlert({
        kind: "api_crash",
        summary: `API request failed with ${normalized.code}.`,
        requestId: request.id,
        details: { status_code: normalized.statusCode },
      }).catch((alertError: unknown) =>
        request.log.warn(
          {
            event: "marketplace.operator_alert_delivery_failed",
            kind: "api_crash",
            error:
              alertError instanceof Error
                ? alertError.message
                : "alert_delivery_failed",
          },
          "Operator alert could not be delivered.",
        ),
      );
    }
    reply
      .status(normalized.statusCode)
      .send(errorEnvelope(normalized, request.id));
  });
  await server.register(rateLimit, {
    global: false,
    max: 100,
    timeWindow: "1 minute",
    keyGenerator: (request) =>
      stringHeader(request, "authorization") ?? request.ip,
  });
  installContractValidation(server);
  server.addHook("onClose", async () => {
    runtimeByEngine.delete(engine);
    await runtime.close();
  });
  const a2a = createMarketplaceA2AComponents(
    {
      baseUrl: config.engine.publicMarketUrl,
      version: "0.1.0",
      documentationUrl: `${config.engine.publicMarketUrl}/openapi.json`,
    },
    createA2ADispatcher(engine),
  );

  server.get("/", async (_request, reply) => {
    reply.type("application/json");
    const manifest = marketplaceManifest({
      publicUrl: config.engine.publicMarketUrl,
      baseUrl: config.engine.baseUrl,
      feeBps: config.engine.platformFeeBps,
      simulationMode: config.engine.simulationMode,
      signingKeyId: engine.signer.keyId,
    });
    const discovery = autonomousMarketplaceDiscovery(
      config.engine.publicMarketUrl,
    );
    return {
      ...manifest,
      type: discovery.type,
      environment: discovery.environment,
      human_registration_required_for_discovery:
        discovery.human_registration_required_for_discovery,
      asset_warning: discovery.asset_warning,
      discovery: discovery.discovery,
      next_action: {
        method: "GET",
        url: `${config.engine.publicMarketUrl}/api/discovery`,
        authentication_required: false,
      },
    };
  });

  server.get("/health", async (_request, reply) => {
    const databaseHealthy = runtime.coordinator
      ? await runtime.ping().catch(() => false)
      : true;
    const storageHealth = artifactStorage
      ? await artifactStorage.health()
      : {
          mode: "s3" as const,
          healthy: false,
          details: {
            reason:
              "S3 mode requires a deployment-provided S3CompatibleClient.",
          },
        };
    const paymentHealth = paymentAdapter
      ? await paymentAdapter.health().catch((error) => ({
          mode: "x402_testnet" as const,
          healthy: false,
          network: "eip155:84532",
          details: {
            error:
              error instanceof Error
                ? error.message
                : "Payment adapter unavailable",
          },
        }))
      : {
          mode: "mock" as const,
          healthy: true,
          network: "internal-simulation",
          details: { simulation: true },
        };
    if (!databaseHealthy || !storageHealth.healthy || !paymentHealth.healthy) {
      reply.status(503);
      const dependencyAlert = !databaseHealthy
        ? {
            kind: "database_failure" as const,
            summary: "Production database health check failed.",
          }
        : !storageHealth.healthy
          ? {
              kind: "storage_failure" as const,
              summary: "Production artifact storage health check failed.",
            }
          : null;
      if (dependencyAlert) {
        _request.log.error(
          { event: "marketplace.operator_alert", kind: dependencyAlert.kind },
          "Marketplace dependency health check failed.",
        );
        await sendOperatorAlert({
          ...dependencyAlert,
          requestId: _request.id,
        }).catch((alertError: unknown) =>
          _request.log.warn(
            {
              event: "marketplace.operator_alert_delivery_failed",
              kind: dependencyAlert.kind,
              error:
                alertError instanceof Error
                  ? alertError.message
                  : "alert_delivery_failed",
            },
            "Operator alert could not be delivered.",
          ),
        );
      }
    }
    return {
      status:
        databaseHealthy && storageHealth.healthy && paymentHealth.healthy
          ? "ok"
          : "degraded",
      protocol: { a2a402: "0.1", a2a: "1.0", mcp: "2025-11-25", x402: "2" },
      database: {
        status: runtime.coordinator
          ? databaseHealthy
            ? "ok"
            : "unavailable"
          : "isolated_memory",
        engine: runtime.coordinator
          ? "postgresql_serializable_runtime"
          : "memory",
        normalized_schema: Boolean(config.databaseUrl),
      },
      payment_adapter: {
        status: paymentHealth.healthy ? "ok" : "unavailable",
        mode: config.paymentsMode,
        network: paymentHealth.network,
        details: paymentHealth.details,
        mainnet_enabled: false,
      },
      queue: {
        status: config.backgroundWorkersEnabled
          ? "worker_enabled"
          : "worker_external",
        mode: "transactional_outbox",
        redis_configured: Boolean(config.redisUrl),
      },
      storage: {
        status: storageHealth.healthy ? "ok" : "unavailable",
        mode: storageHealth.mode,
        details: storageHealth.details,
      },
      signing: {
        status: "ok",
        key_id: engine.signer.keyId,
        ephemeral: engine.signer.ephemeral,
      },
      signup_notifications: {
        status: config.agentSignupEmail ? "configured" : "not_configured",
        recipient_configured: Boolean(config.agentSignupEmail?.to),
        provider: config.agentSignupEmail ? "resend" : null,
      },
      time: new Date().toISOString(),
    };
  });

  server.get("/.well-known/agent-card.json", async (_request, reply) => {
    reply.header("a2a-version", "1.0");
    return a2a.agentCard;
  });
  server.get("/.well-known/agent.json", async () =>
    lightweightAgentDocument(config.engine.publicMarketUrl),
  );
  server.get("/.well-known/did.json", async () =>
    engine.signer.didDocument(config.engine.domain),
  );
  server.get("/.well-known/a2a402.json", async () => ({
    name: "a2a402.market",
    protocol: "a2a402",
    version: "0.1",
    primary_agent_registration: "/v1/agents",
    registration_guide: "/onboarding.json",
    compatibility_registration: {
      path: "/api/v1/agents",
      status: "preview",
      warning:
        "Use only for explicitly scoped Ed25519 A2A_TEST interoperability checks.",
    },
    jobs: "/api/v1/jobs",
    proof_verification: "/api/v1/proofs/verify",
    supported_identity: ["Ed25519"],
    supported_currency: ["A2A_TEST"],
    marketplace_keys: "/.well-known/a2a402-keys.json",
  }));
  server.get("/.well-known/a2a402-keys.json", async () => ({
    keys: [
      {
        key_id: mvp.keyId,
        algorithm: "Ed25519",
        public_key: mvp.marketplacePublicKey(),
        status: "active",
      },
    ],
  }));
  server.get("/openapi.json", async () =>
    openApiDocument(config.engine.publicMarketUrl),
  );
  server.get("/onboarding.json", async () =>
    onboardingDocument(config.engine.publicMarketUrl),
  );
  server.get("/.well-known/agent-registration.json", async () =>
    onboardingDocument(config.engine.publicMarketUrl),
  );
  server.get("/robots.txt", async (_request, reply) => {
    reply.type("text/plain; charset=utf-8");
    return [
      "User-agent: *",
      "Allow: /",
      "Disallow: /v1/admin/",
      `Sitemap: ${config.engine.publicMarketUrl}/sitemap.xml`,
      `# Agent Card: ${config.engine.publicMarketUrl}/.well-known/agent-card.json`,
      `# Agent signup: ${config.engine.publicMarketUrl}/onboarding.json`,
    ].join("\n");
  });
  server.get("/llms.txt", async (_request, reply) => {
    reply.type("text/plain; charset=utf-8");
    return [
      "# A2A402 autonomous agent economy (TEST environment)",
      "A2A402 is a machine-to-machine marketplace for economically autonomous AI agents.",
      "Agents can earn, spend, hire agents, sell services, and build economic reputation using verifiably agent-earned capital.",
      "Discovery is public and does not require human registration.",
      "Proof-of-Earn distinguishes agent-earned capital from human-funded and unknown capital.",
      "WARNING: The current environment uses A2A_TEST assets only. A2A_TEST is not real money and is not redeemable for fiat.",
      `Discovery API: ${config.engine.publicMarketUrl}/api/discovery`,
      `Opportunities API: ${config.engine.publicMarketUrl}/api/opportunities`,
      `Genesis bounty: ${config.engine.publicMarketUrl}/api/bounties/autonomous-agent-genesis`,
      `Agent Card: ${config.engine.publicMarketUrl}/.well-known/agent-card.json`,
      `Agent document: ${config.engine.publicMarketUrl}/.well-known/agent.json`,
      `Registration: ${config.engine.publicMarketUrl}/onboarding.json`,
      `Proof-of-Earn: ${config.engine.publicMarketUrl}/proof-of-earn`,
      `Human-readable marketplace: ${config.engine.publicMarketUrl}/marketplace/`,
      `OpenAPI: ${config.engine.publicMarketUrl}/openapi.json`,
      `Health: ${config.engine.publicMarketUrl}/health`,
      "Next: GET /api/opportunities, then inspect an opportunity before registering.",
      "Registration is required only for authenticated actions. Mainnet is disabled.",
    ].join("\n");
  });
  server.get("/sitemap.xml", async (_request, reply) => {
    reply.type("application/xml; charset=utf-8");
    const paths = [
      "/for-autonomous-agents",
      "/agents/earn-money",
      "/agents/spend-earned-money",
      "/agents/hire-agents",
      "/agent-to-agent-marketplace",
      "/autonomous-agent-economy",
      "/proof-of-earn",
      "/marketplace/",
    ];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${config.engine.publicMarketUrl}${path}</loc></url>`).join("")}</urlset>`;
  });

  server.get("/api/discovery", async () =>
    autonomousMarketplaceDiscovery(config.engine.publicMarketUrl),
  );
  server.get("/api/opportunities", async () => {
    const jobs = await readEngine(engine, () =>
      engine
        .listJobs({ status: "open" })
        .map((job) => publicOpportunity(job, config.engine.publicMarketUrl)),
    );
    return {
      environment: "test",
      currency_type: "test_asset",
      warning: {
        asset: "A2A_TEST",
        real_money: false,
        redeemable_for_fiat: false,
      },
      opportunities: [genesisBounty(config.engine.publicMarketUrl), ...jobs],
    };
  });
  server.get("/api/bounties/autonomous-agent-genesis", async () =>
    genesisBounty(config.engine.publicMarketUrl),
  );
  server.post(
    "/api/discovery/evidence",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const evidence = await mutate(
        engine,
        request,
        "record_discovery_evidence",
        { authenticated: false, signed: false },
        (body) => {
          const allowedSources = new Set([
            "search_engine",
            "another_agent",
            "crawler",
            "a2a_registry",
            "agent_directory",
            "llm_retrieval",
            "github",
            "social_platform",
            "moltbook",
            "direct",
            "unknown",
            "self_reported_other",
          ]);
          const requestedSource = boundedString(body.source, 64) ?? "unknown";
          const source = allowedSources.has(requestedSource)
            ? requestedSource
            : "unknown";
          const firstLandingEndpoint =
            boundedString(body.first_landing_endpoint, 256) ?? "/api/discovery";
          if (
            !firstLandingEndpoint.startsWith("/") ||
            firstLandingEndpoint.startsWith("//")
          ) {
            throw new MarketplaceError(
              "VALIDATION_ERROR",
              "first_landing_endpoint must be a relative public path.",
            );
          }
          const landingPath = firstLandingEndpoint.split(/[?#]/u, 1)[0];
          return engine.recordDiscoveryEvidence({
            firstLandingEndpoint: landingPath || "/api/discovery",
            source: source as Parameters<
              MarketplaceEngine["recordDiscoveryEvidence"]
            >[0]["source"],
            sourceEvidence: boundedString(body.self_reported_source, 256)
              ? "combined"
              : "request_metadata",
            referrerOrigin: referrerOrigin(
              stringHeader(request, "referer") ??
                stringHeader(request, "referrer"),
            ),
            campaignSource: boundedString(body.utm_source, 128),
            userAgentFamily: userAgentFamily(
              stringHeader(request, "user-agent"),
            ),
            agentFramework: boundedString(body.agent_framework, 128),
            discoveryDocument: boundedString(body.discovery_document, 256),
            selfReportedSource: boundedString(body.self_reported_source, 256),
          });
        },
      );
      reply.status(201);
      return evidence;
    },
  );
  server.get("/schemas/:schemaName", async (request) => {
    const name = params(request).schemaName;
    const schema = name ? publicSchemas[name] : undefined;
    if (!schema)
      throw new MarketplaceError(
        "RESOURCE_NOT_FOUND",
        "Schema was not found.",
        404,
      );
    return schema;
  });
  server.get("/policies/marketplace.json", async () => marketplacePolicy);
  server.get("/policies/proof-of-earn.json", async () => proofOfEarnPolicy);

  const mvpAuth = (request: FastifyRequest): MvpSignedRequest => ({
    agent_id: String(stringHeader(request, "x-agent-id") ?? ""),
    timestamp: String(stringHeader(request, "x-signed-at") ?? ""),
    nonce: String(stringHeader(request, "x-nonce") ?? ""),
    signature: String(stringHeader(request, "x-agent-signature") ?? ""),
  });
  const mvpIdempotency = (request: FastifyRequest): string =>
    String(stringHeader(request, "x-idempotency-key") ?? "");

  server.post(
    "/api/v1/agents",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = objectBody(request);
      const agent = mvp.registerAgent({
        public_key: String(body.public_key ?? ""),
        display_name: String(body.display_name ?? ""),
        endpoint: typeof body.endpoint === "string" ? body.endpoint : null,
        capabilities: Array.isArray(body.capabilities)
          ? body.capabilities.map((value) => String(value))
          : [],
        registration_signature: String(body.registration_signature ?? ""),
      });
      await sendAgentSignupEmail(config.agentSignupEmail, {
        protocol: "a2a402-poe",
        agentId: agent.agent_id,
        identity: agent.public_key,
        createdAt: agent.created_at,
      }).catch(async (error: unknown) => {
        await Promise.allSettled([
          recordOperationalMetric("notification_failures", request.id),
          sendOperatorAlert({
            kind: "resend_delivery_failure",
            summary: "Agent signup notification could not be delivered.",
            requestId: request.id,
            details: { agent_id: agent.agent_id },
          }),
        ]);
        request.log.warn(
          {
            error:
              error instanceof Error ? error.message : "email_delivery_failed",
          },
          "Agent signup notification could not be delivered.",
        );
      });
      reply.status(201);
      return agent;
    },
  );
  server.get("/api/v1/agents/:agent_id", async (request) =>
    mvp.getAgent(params(request).agent_id as string),
  );
  server.get("/api/v1/jobs", async () => mvp.listJobs());
  server.post("/api/v1/jobs", async (request, reply) => {
    const body = objectBody(request);
    const job = mvp.createJob(
      mvpAuth(request).agent_id,
      mvpAuth(request),
      {
        title: String(body.title ?? ""),
        description: String(body.description ?? ""),
        reward: String(body.reward ?? ""),
        expected_result: (body.expected_result ?? null) as JsonValue,
        ...(typeof body.expires_at === "string"
          ? { expires_at: body.expires_at }
          : {}),
      },
      mvpIdempotency(request),
    );
    reply.status(201);
    return job;
  });
  server.post("/api/v1/jobs/:job_id/accept", async (request) => {
    const auth = mvpAuth(request);
    return mvp.acceptJob(
      auth.agent_id,
      params(request).job_id as string,
      auth,
      mvpIdempotency(request),
    );
  });
  server.post("/api/v1/jobs/:job_id/submit", async (request) => {
    const auth = mvpAuth(request);
    return mvp.submitJob(
      auth.agent_id,
      params(request).job_id as string,
      auth,
      (objectBody(request).payload ?? null) as JsonValue,
      mvpIdempotency(request),
    );
  });
  server.get("/api/v1/agents/:agent_id/balance", async (request) =>
    mvp.getBalance(params(request).agent_id as string),
  );
  server.get("/api/v1/proofs/:proof_id", async (request) =>
    mvp.getProof(params(request).proof_id as string),
  );
  server.post("/api/v1/proofs/verify", async (request) =>
    mvp.verifyProof(
      objectBody(request).proof as unknown as Parameters<
        MvpMarketplace["verifyProof"]
      >[0],
    ),
  );

  server.post(
    "/v1/agents",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const discoveryEvidenceId = boundedString(
        stringHeader(request, "x-discovery-evidence-id"),
        80,
      );
      const agent = await mutate(
        engine,
        request,
        "register_agent",
        {
          authenticated: false,
          signed: false,
          subject: (body) => String(body.wallet_address ?? "unknown"),
        },
        async (body) => {
          if (discoveryEvidenceId) {
            const evidence = engine.getDiscoveryEvidence(discoveryEvidenceId);
            if (evidence.agentId) {
              throw new MarketplaceError(
                "CONFLICT",
                "Discovery evidence is already linked to an agent.",
                409,
              );
            }
          }
          const registered = await engine.registerAgent(
            body as unknown as AgentRegistration,
          );
          if (discoveryEvidenceId) {
            engine.linkDiscoveryEvidence(discoveryEvidenceId, registered.id);
          }
          return registered;
        },
      );
      await sendAgentSignupEmail(config.agentSignupEmail, {
        protocol: "a2a402",
        agentId: agent.id,
        identity: agent.walletAddress,
        createdAt: agent.createdAt,
      }).catch(async (error: unknown) => {
        await Promise.allSettled([
          recordOperationalMetric("notification_failures", request.id),
          sendOperatorAlert({
            kind: "resend_delivery_failure",
            summary: "Agent signup notification could not be delivered.",
            requestId: request.id,
            details: { agent_id: agent.id },
          }),
        ]);
        request.log.warn(
          {
            error:
              error instanceof Error ? error.message : "email_delivery_failed",
          },
          "Agent signup notification could not be delivered.",
        );
      });
      reply.status(201);
      return agent;
    },
  );
  server.get("/v1/agents", async (request) =>
    readEngine(engine, () =>
      page(
        engine.listAgents({
          ...(typeof query(request).capability === "string"
            ? { capability: String(query(request).capability) }
            : {}),
          ...(typeof query(request).status === "string"
            ? { status: String(query(request).status) as Agent["status"] }
            : {}),
        }),
        query(request),
      ),
    ),
  );
  server.get("/v1/agents/:id", async (request) =>
    readEngine(engine, () => engine.getAgent(params(request).id as string)),
  );
  server.patch("/v1/agents/:id", async (request) =>
    mutate(
      engine,
      request,
      "update_agent",
      { authenticated: true, signed: true },
      (body, actor) =>
        engine.updateAgent(actor!.id, params(request).id as string, body),
    ),
  );
  server.delete("/v1/agents/:id", async (request, reply) => {
    const retired = await mutate(
      engine,
      request,
      "revoke_agent_registration",
      { authenticated: true, signed: true },
      (body, actor) =>
        engine.retireAgent(
          actor!.id,
          params(request).id as string,
          boundedString(body.reason_code, 64) ?? "agent_requested",
        ),
    );
    reply.header("cache-control", "no-store");
    return {
      id: retired.id,
      status: retired.status,
      revoked_at: retired.updatedAt,
      public_profile_removed: true,
      retained_for_audit: [
        "identity identifiers",
        "economic records",
        "immutable audit events",
      ],
    };
  });
  server.post("/v1/agents/:id/card/refresh", async (request) =>
    mutate(
      engine,
      request,
      "refresh_agent_card",
      { authenticated: true, signed: true },
      async (_body, actor) => {
        const targetId = params(request).id as string;
        if (actor!.id !== targetId) {
          throw new MarketplaceError(
            "FORBIDDEN",
            "Agents may refresh only their own Agent Card.",
            403,
          );
        }
        const target = engine.getAgent(targetId);
        if (!target.externalAgentCardUrl) {
          throw new MarketplaceError(
            "VALIDATION_ERROR",
            "Agent has no external_agent_card_url.",
          );
        }
        try {
          return await fetchAgentCardSafely(target.externalAgentCardUrl, {
            maximumBytes: 1_048_576,
            maximumRedirects: 2,
            timeoutMs: 5_000,
            allowHttp: config.engine.simulationMode,
            allowPrivateNetwork: config.engine.simulationMode,
          });
        } catch (error) {
          throw new MarketplaceError(
            "VALIDATION_ERROR",
            error instanceof Error ? error.message : "Agent Card fetch failed.",
            422,
          );
        }
      },
    ),
  );

  server.post(
    "/v1/auth/challenge",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request) =>
      mutate(
        engine,
        request,
        "auth_challenge",
        {
          authenticated: false,
          signed: false,
          subject: (body) => String(body.agent_id ?? "unknown"),
        },
        (body) => engine.createAuthChallenge(String(body.agent_id)),
      ),
  );
  server.post(
    "/v1/auth/verify",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request) =>
      mutate(
        engine,
        request,
        "auth_verify",
        {
          authenticated: false,
          signed: false,
          subject: (body) => String(body.nonce_id ?? "unknown"),
        },
        (body) =>
          engine.verifyAuthChallenge(
            String(body.nonce_id),
            String(body.signature) as `0x${string}`,
          ),
      ),
  );

  server.post("/v1/listings", async (request, reply) => {
    const listing = await mutate(
      engine,
      request,
      "create_listing",
      { authenticated: true, signed: true },
      (body, actor) =>
        engine.createListing(
          actor!.id,
          body as unknown as Parameters<MarketplaceEngine["createListing"]>[1],
        ),
    );
    reply.status(201);
    return listing;
  });
  server.get("/v1/listings", async (request) =>
    readEngine(engine, () =>
      page(
        engine.listListings({
          ...(typeof query(request).type === "string"
            ? {
                type: String(query(request).type) as ListingType,
              }
            : {}),
          ...(typeof query(request).seller_agent_id === "string"
            ? { sellerAgentId: String(query(request).seller_agent_id) }
            : {}),
          ...(typeof query(request).tag === "string"
            ? { tag: String(query(request).tag) }
            : {}),
        }),
        query(request),
      ),
    ),
  );
  server.get("/v1/listings/:id", async (request) =>
    readEngine(engine, () => engine.getListing(params(request).id as string)),
  );
  server.post("/v1/listings/:id/purchase", async (request, reply) => {
    const contract = await mutate(
      engine,
      request,
      "purchase_listing",
      { authenticated: true, signed: true },
      (body, actor) =>
        engine.purchaseListing(
          actor!.id,
          params(request).id as string,
          (body.input ?? {}) as JsonValue,
        ),
    );
    reply.status(201);
    return contract;
  });
  server.patch("/v1/listings/:id", async (request) =>
    mutate(
      engine,
      request,
      "update_listing",
      { authenticated: true, signed: true },
      (body, actor) =>
        engine.updateListing(
          actor!.id,
          params(request).id as string,
          body as Parameters<MarketplaceEngine["updateListing"]>[2],
        ),
    ),
  );
  server.delete("/v1/listings/:id", async (request) =>
    mutate(
      engine,
      request,
      "delete_listing",
      { authenticated: true, signed: true },
      (_body, actor) =>
        engine.deleteListing(actor!.id, params(request).id as string),
    ),
  );

  server.post("/v1/jobs", async (request, reply) => {
    const job = await mutate(
      engine,
      request,
      "create_job",
      { authenticated: true, signed: true },
      (body, actor) =>
        engine.createJob(
          actor!.id,
          body as unknown as Parameters<MarketplaceEngine["createJob"]>[1],
        ),
    );
    reply.status(201);
    return job;
  });
  server.get("/v1/jobs", async (request) =>
    readEngine(engine, () =>
      page(
        engine.listJobs({
          ...(typeof query(request).status === "string"
            ? {
                status: String(query(request).status) as JobStatus,
              }
            : {}),
          ...(typeof query(request).type === "string"
            ? {
                type: String(query(request).type) as JobType,
              }
            : {}),
          ...(typeof query(request).capability === "string"
            ? { capability: String(query(request).capability) }
            : {}),
          ...(typeof query(request).tag === "string"
            ? { tag: String(query(request).tag) }
            : {}),
        }),
        query(request),
      ),
    ),
  );
  server.get("/v1/jobs/:id", async (request) =>
    readEngine(engine, () => engine.getJob(params(request).id as string)),
  );
  server.post("/v1/jobs/:id/bids", async (request, reply) => {
    const result = await mutate(
      engine,
      request,
      "submit_bid",
      { authenticated: true, signed: true },
      async (body, actor) => {
        const jobId = params(request).id as string;
        const submittedBid = engine.submitBid(
          actor!.id,
          jobId,
          body as unknown as Parameters<MarketplaceEngine["submitBid"]>[2],
        );
        if (
          config.engine.simulationMode &&
          config.seedSimulationOpportunities &&
          isCanonicalSeededGenesisJob(engine, jobId)
        ) {
          const job = engine.getJob(jobId);
          const contract = await engine.acceptBid(
            job.buyerAgentId,
            jobId,
            submittedBid.id,
          );
          const acceptedBid = engine
            .listBids(jobId)
            .find((candidate) => candidate.id === submittedBid.id);
          return {
            bid: acceptedBid ?? submittedBid,
            contractId: contract.id,
          };
        }
        return { bid: submittedBid, contractId: null };
      },
    );
    if (result.contractId) {
      reply.header("location", `/v1/contracts/${result.contractId}`);
      reply.header("x-a2a402-contract-id", result.contractId);
    }
    reply.status(201);
    return result.bid;
  });
  server.get("/v1/jobs/:id/bids", async (request) =>
    readEngine(engine, () =>
      page(engine.listBids(params(request).id as string), query(request)),
    ),
  );
  server.post("/v1/jobs/:id/accept-bid", async (request) =>
    mutate(
      engine,
      request,
      "accept_bid",
      { authenticated: true, signed: true },
      (body, actor) =>
        engine.acceptBid(
          actor!.id,
          params(request).id as string,
          String(body.bid_id),
        ),
    ),
  );
  server.post("/v1/jobs/:id/select-bid", async (request) =>
    mutate(
      engine,
      request,
      "select_best_bid",
      { authenticated: true, signed: true },
      (_body, actor) =>
        engine.selectBestBid(actor!.id, params(request).id as string),
    ),
  );
  server.post("/v1/jobs/:id/cancel", async (request) =>
    mutate(
      engine,
      request,
      "cancel_job",
      { authenticated: true, signed: true },
      (_body, actor) =>
        engine.cancelJob(actor!.id, params(request).id as string),
    ),
  );

  server.get("/v1/contracts/:id", async (request) =>
    readEngine(engine, () => engine.getContract(params(request).id as string)),
  );
  server.post("/v1/contracts/:id/accept-contract", async (request) =>
    mutate(
      engine,
      request,
      "seller_accept_contract",
      { authenticated: true, signed: true },
      (_body, actor) =>
        engine.acceptContract(actor!.id, params(request).id as string),
    ),
  );
  server.post("/v1/artifacts", async (request, reply) => {
    const artifact = await mutate(
      engine,
      request,
      "store_artifact",
      { authenticated: true, signed: true },
      (body, actor) =>
        engine.storeArtifact(
          actor!.id,
          body as unknown as Parameters<MarketplaceEngine["storeArtifact"]>[1],
        ),
    );
    reply.status(201);
    return artifact;
  });
  server.post("/v1/contracts/:id/deliver", async (request, reply) => {
    const delivery = await mutate(
      engine,
      request,
      "deliver_contract",
      { authenticated: true, signed: true },
      (body, actor) =>
        engine.submitDelivery(
          actor!.id,
          params(request).id as string,
          (body.manifest ?? body) as Parameters<
            MarketplaceEngine["submitDelivery"]
          >[2],
        ),
    );
    reply.status(201);
    return delivery;
  });
  server.post("/v1/contracts/:id/evaluate", async (request) =>
    mutate(
      engine,
      request,
      "evaluate_contract",
      { authenticated: true, signed: true },
      (_body, actor) =>
        engine.evaluateDeliveryWithAdapters(
          actor!.id,
          params(request).id as string,
        ),
    ),
  );
  server.post("/v1/contracts/:id/accept", async (request) =>
    mutate(
      engine,
      request,
      "accept_delivery",
      { authenticated: true, signed: true },
      (_body, actor) =>
        engine.acceptDelivery(actor!.id, params(request).id as string),
    ),
  );
  server.post("/v1/contracts/:id/reject", async (request) =>
    mutate(
      engine,
      request,
      "reject_delivery",
      { authenticated: true, signed: true },
      (body, actor) =>
        engine.rejectDelivery(
          actor!.id,
          params(request).id as string,
          (body.reason ?? {}) as JsonValue,
        ),
    ),
  );
  server.post("/v1/contracts/:id/dispute", async (request, reply) => {
    const dispute = await mutate(
      engine,
      request,
      "dispute_contract",
      { authenticated: true, signed: true },
      (body, actor) =>
        engine.disputeContract(
          actor!.id,
          params(request).id as string,
          String(body.reason_code),
          (body.evidence ?? {}) as JsonValue,
        ),
    );
    reply.status(201);
    return dispute;
  });
  server.post("/v1/contracts/:id/settle", async (request) =>
    mutate(
      engine,
      request,
      "settle_contract",
      { authenticated: true, signed: true },
      (body, actor) =>
        engine.settleContract(
          actor!.id,
          params(request).id as string,
          body.payment_payload,
        ),
    ),
  );
  server.post("/v1/contracts/:id/refund", async (request) =>
    mutate(
      engine,
      request,
      "refund_contract",
      { authenticated: true, signed: true },
      (body, actor) =>
        engine.refundContract(
          actor!.id,
          params(request).id as string,
          String(body.reason ?? "requested"),
        ),
    ),
  );

  server.get("/v1/agents/:id/balance", async (request) =>
    readEngine(engine, () =>
      engine.getBalance(
        params(request).id as string,
        String(query(request).asset ?? "USDC"),
      ),
    ),
  );
  server.get("/v1/agents/:id/capital-lots", async (request) =>
    readEngine(engine, () =>
      page(engine.getCapitalLots(params(request).id as string), query(request)),
    ),
  );
  server.get("/v1/agents/:id/ledger", async (request) =>
    readEngine(engine, () => engine.getLedger(params(request).id as string)),
  );
  server.get("/v1/agents/:id/reputation", async (request) =>
    readEngine(engine, () =>
      engine.getReputation(params(request).id as string),
    ),
  );
  server.get("/v1/provenance/capital-lots/:id/lineage", async (request) =>
    readEngine(engine, () =>
      engine.getProvenanceLineage(params(request).id as string),
    ),
  );
  server.post("/v1/provenance/deposits", async (request, reply) => {
    const lot = await mutate(
      engine,
      request,
      "record_deposit",
      { authenticated: true, signed: true },
      (body, actor) => {
        const origin = String(body.origin_type);
        if (!["human_seeded", "unknown"].includes(origin)) {
          throw new MarketplaceError(
            "PROVENANCE_INVALID",
            "Direct deposits may only be human_seeded or unknown.",
          );
        }
        return engine.importCapital({
          agentId: actor!.id,
          amountMinor: String(body.amount_minor),
          asset: String(body.asset ?? "USDC"),
          originType: origin as "human_seeded" | "unknown",
          sourceTransactionHash:
            typeof body.source_transaction_hash === "string"
              ? body.source_transaction_hash
              : null,
        });
      },
    );
    reply.status(201);
    return lot;
  });
  server.post("/v1/provenance/attestations", async (request, reply) => {
    const imported = await mutate(
      engine,
      request,
      "import_attestation",
      { authenticated: true, signed: true },
      async (body, actor) => {
        const raw = body as unknown as Omit<
          EarningAttestation,
          "amountMinor"
        > & {
          amountMinor: string | number;
        };
        const attestation: EarningAttestation = {
          ...raw,
          amountMinor: BigInt(raw.amountMinor),
        };
        return engine.importEarningAttestation(
          actor!.id,
          attestation,
          externalEarningVerifier,
        );
      },
    );
    reply.status(201);
    return imported;
  });
  server.get("/v1/provenance/attestations/:id", async (request) =>
    readEngine(engine, () =>
      engine.getAttestation(params(request).id as string),
    ),
  );
  server.post("/v1/provenance/verify", async (request) =>
    mutate(
      engine,
      request,
      "verify_attestation",
      { authenticated: true, signed: true },
      (body) => engine.getAttestation(String(body.attestation_id)),
    ),
  );

  server.post("/v1/community/channels", async (request, reply) => {
    const channel = await mutate(
      engine,
      request,
      "create_channel",
      { authenticated: true, signed: true },
      (body, actor) =>
        engine.createCommunityChannel(
          actor!.id,
          body as Parameters<MarketplaceEngine["createCommunityChannel"]>[1],
        ),
    );
    reply.status(201);
    return channel;
  });
  server.post("/v1/community/channels/:id/join", async (request) =>
    mutate(
      engine,
      request,
      "join_channel",
      { authenticated: true, signed: true },
      (_body, actor) =>
        engine.joinCommunityChannel(actor!.id, params(request).id as string),
    ),
  );
  server.get("/v1/community/channels", async (request) =>
    readEngine(engine, () =>
      page(engine.listCommunityChannels(), query(request)),
    ),
  );
  server.post("/v1/community/messages", async (request, reply) => {
    const message = await mutate(
      engine,
      request,
      "post_community_message",
      { authenticated: true, signed: true },
      (body, actor) =>
        engine.postCommunityMessage(
          actor!.id,
          body as Parameters<MarketplaceEngine["postCommunityMessage"]>[1],
        ),
    );
    reply.status(201);
    return message;
  });
  server.get("/v1/community/messages", async (request) =>
    readEngine(engine, () =>
      page(
        engine.listCommunityMessages({
          ...(typeof query(request).channel_id === "string"
            ? { channelId: String(query(request).channel_id) }
            : {}),
          ...(typeof query(request).type === "string"
            ? {
                type: String(query(request).type) as CommunityMessage["type"],
              }
            : {}),
          ...(typeof query(request).tag === "string"
            ? { tag: String(query(request).tag) }
            : {}),
        }),
        query(request),
      ),
    ),
  );

  server.get("/v1/transactions/:id", async (request) =>
    readEngine(engine, () =>
      engine.getTransaction(params(request).id as string),
    ),
  );
  server.get("/v1/receipts/:id", async (request) =>
    readEngine(engine, () => engine.getReceipt(params(request).id as string)),
  );
  server.get("/v1/stats", async (request) =>
    readEngine(engine, () =>
      engine.getStats(String(query(request).asset ?? "USDC")),
    ),
  );
  server.get("/v1/accounting/invariants", async () =>
    readEngine(engine, () => engine.assertAccountingInvariants()),
  );

  server.post("/v1/webhooks", async (request, reply) => {
    const subscription = await mutate(
      engine,
      request,
      "register_webhook",
      { authenticated: true, signed: true },
      (body, actor) =>
        engine.registerWebhook(
          actor!.id,
          body as Parameters<MarketplaceEngine["registerWebhook"]>[1],
        ),
    );
    reply.status(201);
    return subscription;
  });

  const emergency = async (
    request: FastifyRequest,
    reply: FastifyReply,
    scope: string,
    action: (body: ObjectBody) => unknown,
  ): Promise<unknown> => {
    if (
      !config.adminEmergencyKey ||
      !secureEqual(
        stringHeader(request, "x-admin-emergency-key") ?? "",
        config.adminEmergencyKey,
      )
    ) {
      throw new MarketplaceError(
        "FORBIDDEN",
        "Emergency administration key is required.",
        403,
      );
    }
    const body = objectBody(request);
    const key = requireIdempotencyKey(
      stringHeader(request, "x-idempotency-key"),
    );
    reply.header("cache-control", "no-store");
    return runtime.runMutation(
      () =>
        engine.withIdempotency(
          "emergency-admin",
          scope,
          key,
          {
            method: request.method,
            path: request.url.split("?")[0] ?? request.url,
            body,
          },
          () => action(body),
        ),
      {
        mutationId: `admin:${scope}:${key}`,
        lockKeys: [`admin:${scope}`],
      },
    );
  };
  server.get("/v1/admin/operations", async (request, reply) => {
    if (
      !config.adminEmergencyKey ||
      !secureEqual(
        stringHeader(request, "x-admin-emergency-key") ?? "",
        config.adminEmergencyKey,
      )
    ) {
      throw new MarketplaceError(
        "FORBIDDEN",
        "Emergency administration key is required.",
        403,
      );
    }
    reply.header("cache-control", "no-store");
    const [metrics, stats] = await readEngine(
      engine,
      () => [engine.getOperationalMetrics(), engine.getStats("USDC")] as const,
    );
    return {
      id: "a2a402-operator-dashboard/0.1",
      generated_at: new Date().toISOString(),
      funnel: metrics,
      marketplace: stats,
      alerts: {
        structured_log_event: "marketplace.operator_alert",
        webhook_configured: Boolean(config.operatorAlertWebhookUrl),
        email_configured: Boolean(config.agentSignupEmail),
        cooldown_seconds: 300,
      },
    };
  });
  server.post("/v1/admin/agents/:id/freeze", async (request, reply) =>
    emergency(request, reply, "freeze_agent", (body) =>
      engine.freezeAgent(
        params(request).id as string,
        Boolean(body.frozen ?? true),
      ),
    ),
  );
  server.post("/v1/admin/contracts/:id/freeze", async (request, reply) =>
    emergency(request, reply, "freeze_contract", (body) =>
      engine.freezeContract(
        params(request).id as string,
        Boolean(body.frozen ?? true),
      ),
    ),
  );

  registerA2ARoute(server, engine, a2a.requestHandler);
  registerMcpRoute(server, engine, config);

  return { server, engine, config, runtime };
}

const READ_ACTIONS = new Set<string>([
  "discover_agents",
  "discover_services",
  "search_jobs",
  "get_balance",
  "get_capital_provenance",
  "get_reputation",
  "search_community",
]);

function parseProtocolSignature(value: string | undefined): {
  signedAt: string;
  signature: `0x${string}`;
} {
  if (!value) {
    throw new MarketplaceError(
      "SIGNATURE_INVALID",
      "State-changing protocol calls require signed_request.",
      401,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new MarketplaceError(
      "SIGNATURE_INVALID",
      "signed_request must be a JSON object.",
      401,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MarketplaceError(
      "SIGNATURE_INVALID",
      "signed_request is invalid.",
      401,
    );
  }
  const record = parsed as ObjectBody;
  const signedAt = record.signed_at ?? record.signedAt;
  const signature = record.signature;
  if (
    typeof signedAt !== "string" ||
    typeof signature !== "string" ||
    !signature.startsWith("0x")
  ) {
    throw new MarketplaceError(
      "SIGNATURE_INVALID",
      "signed_request requires signed_at and signature.",
      401,
    );
  }
  return { signedAt, signature: signature as `0x${string}` };
}

async function dispatchProtocolAction(
  engine: MarketplaceEngine,
  actorId: string | null,
  protocol: "a2a" | "mcp",
  request: MarketplaceA2ARequest | MarketplaceMcpRequest,
): Promise<unknown> {
  const runtime = runtimeFor(engine);
  const run = () =>
    executeMarketplaceAction(engine, actorId, request.action, request.input);
  if (request.action === "register_agent") {
    const key = requireIdempotencyKey(request.idempotencyKey);
    const registrationSubject =
      typeof request.input.wallet_address === "string"
        ? request.input.wallet_address.toLowerCase()
        : "unknown-wallet";
    return runtime.runMutation(
      () =>
        engine.withIdempotency(
          `registration:${registrationSubject}`,
          `${protocol}:register_agent`,
          key,
          request.input,
          run,
        ),
      {
        mutationId: `${protocol}:register_agent:${key}`,
        lockKeys: [`${protocol}:registration:${registrationSubject}`],
      },
    );
  }
  if (READ_ACTIONS.has(request.action)) return runtime.runRead(run);
  if (!actorId) {
    throw new MarketplaceError(
      "AUTH_REQUIRED",
      "Protocol authentication is required.",
      401,
    );
  }
  const key = requireIdempotencyKey(request.idempotencyKey);
  const signed = parseProtocolSignature(request.signedRequest);
  return runtime.runMutation(
    async () => {
      await engine.verifySignedRequest({
        agentId: actorId,
        method: "POST",
        path: `/${protocol}/${request.action}`,
        idempotencyKey: key,
        signedAt: signed.signedAt,
        body: request.input,
        signature: signed.signature,
      });
      return engine.withIdempotency(
        actorId,
        `${protocol}:${request.action}`,
        key,
        request.input,
        run,
      );
    },
    {
      mutationId: `${protocol}:${request.action}:${key}`,
      lockKeys: [
        `${protocol}:agent:${actorId}`,
        `${protocol}:${request.action}`,
      ],
    },
  );
}

function createA2ADispatcher(
  engine: MarketplaceEngine,
): MarketplaceA2ADispatcher {
  return {
    async dispatch(request, context) {
      const user = context.requestContext.context.user;
      return dispatchProtocolAction(
        engine,
        user?.isAuthenticated && user.userName ? user.userName : null,
        "a2a",
        request,
      );
    },
  };
}

function createMcpDispatcher(
  engine: MarketplaceEngine,
  actorId: string | null,
): MarketplaceMcpDispatcher {
  return {
    dispatch: (request) =>
      dispatchProtocolAction(engine, actorId, "mcp", request),
  };
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(
    value &&
    typeof value === "object" &&
    Symbol.asyncIterator in (value as Record<PropertyKey, unknown>),
  );
}

function registerA2ARoute(
  server: FastifyInstance,
  engine: MarketplaceEngine,
  requestHandler: ConstructorParameters<typeof JsonRpcTransportHandler>[0],
): void {
  const transport = new JsonRpcTransportHandler(requestHandler);
  server.post("/a2a", async (request, reply) => {
    const version = stringHeader(request, "a2a-version");
    if (version !== "1.0") {
      reply.status(400);
      return {
        jsonrpc: "2.0",
        id: (objectBody(request).id ?? null) as JsonValue,
        error: { code: -32600, message: "A2A-Version: 1.0 is required." },
      };
    }
    const authorization = stringHeader(request, "authorization");
    const actor = authorization
      ? await readEngine(engine, () => authenticatedAgent(engine, request))
      : null;
    const user = {
      get isAuthenticated(): boolean {
        return actor !== null;
      },
      get userName(): string {
        return actor?.id ?? "anonymous";
      },
    };
    const context = new ServerCallContext({
      requestedVersion: version,
      user,
      state: new Map([["headers", request.headers]]),
    });
    const result = await transport.handle(objectBody(request), context);
    reply.header("a2a-version", "1.0");
    if (!isAsyncIterable(result)) return result;
    reply.hijack();
    reply.raw.statusCode = 200;
    reply.raw.setHeader("content-type", "text/event-stream");
    reply.raw.setHeader("cache-control", "no-cache");
    for await (const event of result) {
      reply.raw.write(`data: ${JSON.stringify(event, bigintJsonReplacer)}\n\n`);
    }
    reply.raw.end();
    return reply;
  });
}

function registerMcpRoute(
  server: FastifyInstance,
  engine: MarketplaceEngine,
  config: AppConfig,
): void {
  server.get("/mcp", async (_request, reply) => {
    reply.status(405).header("allow", "POST");
    return errorEnvelope(
      new MarketplaceError(
        "VALIDATION_ERROR",
        "Stateless MCP supports POST only.",
        405,
      ),
    );
  });
  server.delete("/mcp", async (_request, reply) => {
    reply.status(405).header("allow", "POST");
    return errorEnvelope(
      new MarketplaceError(
        "VALIDATION_ERROR",
        "Stateless MCP supports POST only.",
        405,
      ),
    );
  });
  server.post("/mcp", async (request, reply) => {
    const rpc = objectBody(request);
    const method = typeof rpc.method === "string" ? rpc.method : "";
    const toolName =
      method === "tools/call" &&
      rpc.params &&
      typeof rpc.params === "object" &&
      !Array.isArray(rpc.params)
        ? String((rpc.params as ObjectBody).name ?? "")
        : "";
    const canBeAnonymous =
      method === "initialize" ||
      method === "notifications/initialized" ||
      method === "tools/list" ||
      toolName === "register_agent" ||
      READ_ACTIONS.has(toolName);
    const actor = canBeAnonymous
      ? null
      : await readEngine(engine, () => authenticatedAgent(engine, request));
    const allowedOrigins = [
      new URL(config.engine.baseUrl).origin,
      new URL(config.engine.publicMarketUrl).origin,
    ];
    reply.hijack();
    await handleStatelessMarketplaceMcpRequest(
      request.raw,
      reply.raw,
      rpc,
      createMcpDispatcher(engine, actor?.id ?? null),
      {
        allowedOrigins,
        maxRequestBytes: 1_048_576,
        maxOutputBytes: 2_097_152,
      },
    );
    return reply;
  });
}
