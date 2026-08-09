import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

export const PROTOCOL_VERSION = "a2a402/0.1" as const;
export const MARKET_ID = "a2a402" as const;
export const DEFAULT_ASSET = "USDC" as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type CapitalOrigin =
  | "marketplace_earned"
  | "verified_external_agent_earned"
  | "human_seeded"
  | "unknown"
  | "platform_test_funds";

export type AgentStatus = "active" | "suspended" | "restricted" | "retired";

export type MarketplaceErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "AUTH_NONCE_EXPIRED"
  | "AUTH_NONCE_REPLAYED"
  | "SIGNATURE_INVALID"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "INSUFFICIENT_ELIGIBLE_CAPITAL"
  | "INVALID_STATE_TRANSITION"
  | "SCHEMA_VALIDATION_FAILED"
  | "ARTIFACT_HASH_MISMATCH"
  | "ARTIFACT_TOO_LARGE"
  | "POLICY_VIOLATION"
  | "RESOURCE_NOT_FOUND"
  | "FORBIDDEN"
  | "PAYMENT_REPLAYED"
  | "PAYMENT_REQUIRED"
  | "PAYMENT_INVALID"
  | "PAYMENT_ADAPTER_UNAVAILABLE"
  | "PROVENANCE_INVALID"
  | "PROVENANCE_CIRCULAR"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR";

export class MarketplaceError extends Error {
  readonly statusCode: number;
  readonly code: MarketplaceErrorCode;
  readonly retryable: boolean;
  readonly details: Record<string, JsonValue>;

  constructor(
    code: MarketplaceErrorCode,
    message: string,
    statusCode = 400,
    details: Record<string, JsonValue> = {},
    retryable = false,
  ) {
    super(message);
    this.name = "MarketplaceError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.retryable = retryable;
  }
}

export interface ErrorEnvelope {
  error: {
    code: MarketplaceErrorCode;
    message: string;
    retryable: boolean;
    details: Record<string, JsonValue>;
    request_id: string;
  };
}

export function errorEnvelope(
  error: unknown,
  requestId: string = randomUUID(),
): ErrorEnvelope {
  const normalized =
    error instanceof MarketplaceError
      ? error
      : new MarketplaceError(
          "INTERNAL_ERROR",
          "An internal error occurred.",
          500,
        );
  return {
    error: {
      code: normalized.code,
      message: normalized.message,
      retryable: normalized.retryable,
      details: normalized.details,
      request_id: requestId,
    },
  };
}

function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, normalize(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function uuid(): string {
  return randomUUID();
}

export function bigintJsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseMinor(
  value: string | number | bigint,
  field = "amount_minor",
): bigint {
  let parsed: bigint;
  try {
    if (typeof value === "number" && !Number.isSafeInteger(value))
      throw new Error();
    parsed = BigInt(value);
  } catch {
    throw new MarketplaceError(
      "VALIDATION_ERROR",
      `${field} must be an integer minor-unit amount.`,
      400,
      { field },
    );
  }
  if (parsed < 0n) {
    throw new MarketplaceError(
      "VALIDATION_ERROR",
      `${field} cannot be negative.`,
      400,
      {
        field,
      },
    );
  }
  return parsed;
}

export function requireIdempotencyKey(value: string | undefined): string {
  if (!value || value.length < 8 || value.length > 200) {
    throw new MarketplaceError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "A unique x-idempotency-key of 8-200 characters is required.",
      400,
    );
  }
  return value;
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

export * from "./storage.js";
export * from "./safe-fetch.js";
