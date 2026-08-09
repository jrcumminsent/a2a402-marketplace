import type { MarketplaceConfig } from "@a2a402/marketplace";

function integer(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return BigInt(raw);
  } catch {
    throw new Error(`${name} must be an integer.`);
  }
}

function numberValue(name: string, fallback: number): number {
  const value = process.env[name] ? Number(process.env[name]) : fallback;
  if (!Number.isSafeInteger(value))
    throw new Error(`${name} must be a safe integer.`);
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: string;
  paymentsMode: "mock" | "x402-testnet";
  enableMainnet: false;
  databaseUrl: string | null;
  redisUrl: string | null;
  artifactStorageMode: "local" | "s3";
  artifactStoragePath: string;
  adminEmergencyKey: string | null;
  x402FacilitatorUrl: string;
  x402Network: "eip155:84532";
  x402AssetAddress: string;
  platformSettlementAddress: `0x${string}` | null;
  backgroundWorkersEnabled: boolean;
  workerIntervalMs: number;
  webhookSecretEncryptionKey: string | null;
  baseSepoliaRpcUrl: string | null;
  externalEarningIssuerAllowlist: string[];
  engine: MarketplaceConfig;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const enableMainnet = bool("ENABLE_MAINNET", false);
  if (enableMainnet) {
    throw new Error("Mainnet is intentionally disabled in a2a402/0.1.");
  }
  const nodeEnv = process.env.NODE_ENV ?? "development";
  if (!["development", "test", "production"].includes(nodeEnv)) {
    throw new Error("NODE_ENV must be development, test, or production.");
  }
  if (nodeEnv === "production" && !process.env.PAYMENTS_MODE) {
    throw new Error("PAYMENTS_MODE must be explicit in production.");
  }
  const paymentsMode =
    (process.env.PAYMENTS_MODE as AppConfig["paymentsMode"] | undefined) ??
    "mock";
  if (!["mock", "x402-testnet"].includes(paymentsMode)) {
    throw new Error("PAYMENTS_MODE must be mock or x402-testnet.");
  }
  if (
    nodeEnv === "production" &&
    paymentsMode === "mock" &&
    !bool("ALLOW_SIMULATION_MODE", false)
  ) {
    throw new Error(
      "Mock payments in production require ALLOW_SIMULATION_MODE=true.",
    );
  }
  const jwtSecret =
    process.env.JWT_SECRET ??
    (nodeEnv === "production"
      ? ""
      : "development-only-change-me-at-least-32-bytes");
  if (jwtSecret.length < 32)
    throw new Error("JWT_SECRET must contain at least 32 characters.");
  if (
    nodeEnv === "production" &&
    jwtSecret === "development-only-change-me-at-least-32-bytes"
  ) {
    throw new Error("The development JWT secret is prohibited in production.");
  }
  if (nodeEnv === "production" && !process.env.SIGNING_PRIVATE_KEY) {
    throw new Error("SIGNING_PRIVATE_KEY is required in production.");
  }
  if (nodeEnv === "production" && !process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required in production.");
  }
  const webhookSecretEncryptionKey =
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY ??
    (nodeEnv === "production"
      ? null
      : `${jwtSecret}:development-webhook-vault`);
  if (
    nodeEnv === "production" &&
    (!webhookSecretEncryptionKey ||
      webhookSecretEncryptionKey.length < 32)
  ) {
    throw new Error(
      "WEBHOOK_SECRET_ENCRYPTION_KEY with at least 32 characters is required in production.",
    );
  }
  const appBaseUrl =
    process.env.APP_BASE_URL ?? "http://localhost:3000";
  const publicMarketUrl =
    process.env.PUBLIC_MARKET_URL ?? "https://a2a402.market";
  if (
    nodeEnv === "production" &&
    (new URL(appBaseUrl).protocol !== "https:" ||
      new URL(publicMarketUrl).protocol !== "https:")
  ) {
    throw new Error(
      "APP_BASE_URL and PUBLIC_MARKET_URL must use HTTPS in production.",
    );
  }
  const artifactStorageMode =
    (process.env.ARTIFACT_STORAGE_MODE as "local" | "s3" | undefined) ??
    "local";
  if (!["local", "s3"].includes(artifactStorageMode)) {
    throw new Error("ARTIFACT_STORAGE_MODE must be local or s3.");
  }
  const x402Network = process.env.X402_NETWORK ?? "eip155:84532";
  if (x402Network !== "eip155:84532") {
    throw new Error("The MVP supports only Base Sepolia (eip155:84532).");
  }
  const platformSettlementAddress =
    process.env.PLATFORM_SETTLEMENT_ADDRESS ?? null;
  if (
    platformSettlementAddress &&
    !/^0x[a-fA-F0-9]{40}$/.test(platformSettlementAddress)
  ) {
    throw new Error("PLATFORM_SETTLEMENT_ADDRESS must be an EVM address.");
  }
  if (paymentsMode === "x402-testnet" && !platformSettlementAddress) {
    throw new Error(
      "PLATFORM_SETTLEMENT_ADDRESS is required for x402-testnet.",
    );
  }
  const baseSepoliaRpcUrl = process.env.BASE_SEPOLIA_RPC_URL || null;
  if (
    paymentsMode === "x402-testnet" &&
    (!baseSepoliaRpcUrl || !/^https:\/\//i.test(baseSepoliaRpcUrl))
  ) {
    throw new Error(
      "BASE_SEPOLIA_RPC_URL using HTTPS is required for x402-testnet reconciliation.",
    );
  }
  const engine: MarketplaceConfig = {
    baseUrl: appBaseUrl,
    publicMarketUrl,
    domain: new URL(publicMarketUrl).hostname,
    simulationMode: paymentsMode === "mock",
    platformFeeBps: numberValue("PLATFORM_FEE_BPS", 500),
    jwtSecret,
    nonceTtlSeconds: numberValue("AUTH_NONCE_TTL_SECONDS", 300),
    tokenTtlSeconds: numberValue("AUTH_TOKEN_TTL_SECONDS", 900),
    maxJobAmountMinor: integer("MAX_JOB_AMOUNT_MINOR", 100_000_000n),
    maxAgentDailySpendMinor: integer(
      "MAX_AGENT_DAILY_SPEND_MINOR",
      250_000_000n,
    ),
    maxArtifactBytes: numberValue("MAX_ARTIFACT_BYTES", 10_000_000),
    communityMessagesPerMinute: numberValue(
      "COMMUNITY_MESSAGES_PER_MINUTE",
      30,
    ),
    ...(platformSettlementAddress
      ? {
          platformSettlementAddress:
            platformSettlementAddress as `0x${string}`,
        }
      : {}),
    ...(process.env.SIGNING_PRIVATE_KEY
      ? { signingPrivateKeyPem: process.env.SIGNING_PRIVATE_KEY }
      : {}),
    ...(process.env.SIGNING_KEY_ID
      ? { signingKeyId: process.env.SIGNING_KEY_ID }
      : {}),
  };
  const base: AppConfig = {
    port: numberValue("PORT", 3000),
    host: process.env.HOST ?? "0.0.0.0",
    nodeEnv,
    paymentsMode,
    enableMainnet: false,
    databaseUrl: process.env.DATABASE_URL || null,
    redisUrl: process.env.REDIS_URL || null,
    artifactStorageMode,
    artifactStoragePath:
      process.env.ARTIFACT_STORAGE_PATH ?? "./data/artifacts",
    adminEmergencyKey: process.env.ADMIN_EMERGENCY_KEY || null,
    x402FacilitatorUrl:
      process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
    x402Network: "eip155:84532",
    x402AssetAddress:
      process.env.X402_ASSET ??
      "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    platformSettlementAddress:
      platformSettlementAddress as `0x${string}` | null,
    backgroundWorkersEnabled: bool(
      "BACKGROUND_WORKERS_ENABLED",
      false,
    ),
    workerIntervalMs: numberValue("WORKER_INTERVAL_MS", 5_000),
    webhookSecretEncryptionKey,
    baseSepoliaRpcUrl,
    externalEarningIssuerAllowlist: (
      process.env.EXTERNAL_EARNING_ISSUER_ALLOWLIST ?? ""
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    engine,
  };
  return {
    ...base,
    ...overrides,
    engine: { ...base.engine, ...(overrides.engine ?? {}) },
  };
}
