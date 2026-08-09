import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { canonicalJson, sha256, type JsonValue } from "./index.js";

export type SafeFetchErrorCode =
  | "URL_INVALID"
  | "URL_PRIVATE_NETWORK"
  | "URL_DNS_FAILED"
  | "RESPONSE_TOO_LARGE"
  | "REDIRECT_LIMIT"
  | "CONTENT_TYPE_INVALID"
  | "DOCUMENT_MALFORMED"
  | "FETCH_FAILED";

export class SafeFetchError extends Error {
  constructor(
    readonly code: SafeFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export interface SafeAgentCardFetchOptions {
  maximumBytes?: number;
  maximumRedirects?: number;
  timeoutMs?: number;
  allowHttp?: boolean;
  allowPrivateNetwork?: boolean;
  fetchImplementation?: typeof fetch;
  resolveHostname?: typeof lookup;
}

export interface FetchedAgentCard {
  url: string;
  card: Record<string, unknown>;
  sha256: string;
  sizeBytes: number;
  redirects: number;
  fetchedAt: string;
}

export interface SafeWebhookDeliveryOptions
  extends Omit<SafeAgentCardFetchOptions, "maximumRedirects"> {
  maximumResponseBytes?: number;
}

export interface WebhookDeliveryResult {
  url: string;
  status: number;
  deliveredAt: string;
}

function privateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part)))
    return true;
  const [a = 0, b = 0] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && b === 51 && octets[2] === 100) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 203 && b === 0 && octets[2] === 113)
  );
}

function privateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? "";
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) return true;
  if (normalized.startsWith("ff")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89a-f]/.test(normalized)) return true;
  if (normalized.startsWith("2001:db8:")) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped?.[1] ? privateIpv4(mapped[1]) : false;
}

export function isPrivateNetworkAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return privateIpv4(address);
  if (family === 6) return privateIpv6(address);
  return true;
}

function parseUrl(raw: string, options: SafeAgentCardFetchOptions): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError("URL_INVALID", "Agent Card URL is malformed.");
  }
  if (
    url.protocol !== "https:" &&
    !(options.allowHttp === true && url.protocol === "http:")
  ) {
    throw new SafeFetchError("URL_INVALID", "Agent Card URL must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new SafeFetchError(
      "URL_INVALID",
      "Agent Card URL must not contain credentials.",
    );
  }
  if (
    !url.hostname ||
    (url.port !== "" &&
      (!/^\d{1,5}$/.test(url.port) || Number(url.port) > 65_535))
  ) {
    throw new SafeFetchError(
      "URL_INVALID",
      "Agent Card URL host or port is invalid.",
    );
  }
  return url;
}

async function assertPublicResolution(
  url: URL,
  options: SafeAgentCardFetchOptions,
): Promise<{ address: string; family: 4 | 6 }> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !options.allowPrivateNetwork &&
    (hostname.toLowerCase() === "localhost" ||
      hostname.toLowerCase() === "metadata.google.internal")
  ) {
    throw new SafeFetchError(
      "URL_PRIVATE_NETWORK",
      "Private-network URLs are prohibited.",
    );
  }
  let addresses: Array<{ address: string; family: number }>;
  if (isIP(hostname)) {
    addresses = [{ address: hostname, family: isIP(hostname) }];
  } else {
    try {
      addresses = await (options.resolveHostname ?? lookup)(hostname, {
        all: true,
        verbatim: true,
      });
    } catch {
      throw new SafeFetchError(
        "URL_DNS_FAILED",
        "Agent Card hostname could not be resolved.",
      );
    }
  }
  if (
    addresses.length === 0 ||
    (!options.allowPrivateNetwork &&
      addresses.some((result) => isPrivateNetworkAddress(result.address)))
  ) {
    throw new SafeFetchError(
      "URL_PRIVATE_NETWORK",
      "Agent Card hostname resolves to a private or reserved network.",
    );
  }
  const selected = addresses[0];
  if (!selected || (selected.family !== 4 && selected.family !== 6)) {
    throw new SafeFetchError(
      "URL_DNS_FAILED",
      "Agent Card hostname has no usable address.",
    );
  }
  return {
    address: selected.address,
    family: selected.family,
  };
}

function pinnedRequest(
  url: URL,
  resolved: { address: string; family: 4 | 6 },
  timeoutMs: number,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = requestImpl(
      url,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "user-agent": "a2a402-agent-card-fetcher/0.1",
        },
        lookup: (_hostname, _options, callback) => {
          callback(null, resolved.address, resolved.family);
        },
      },
      (incoming) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) headers.append(name, item);
          } else if (value !== undefined) {
            headers.set(name, value);
          }
        }
        resolve(
          new Response(Readable.toWeb(incoming) as ReadableStream, {
            status: incoming.statusCode ?? 500,
            headers,
            ...(incoming.statusMessage
              ? { statusText: incoming.statusMessage }
              : {}),
          }),
        );
      },
    );
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("Agent Card request timed out."));
    });
    request.once("error", reject);
    request.end();
  });
}

function pinnedJsonPost(
  url: URL,
  resolved: { address: string; family: 4 | 6 },
  body: Uint8Array,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = requestImpl(
      url,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "content-length": String(body.byteLength),
          "user-agent": "a2a402-webhook-worker/0.1",
          ...headers,
        },
        lookup: (_hostname, _options, callback) => {
          callback(null, resolved.address, resolved.family);
        },
      },
      (incoming) => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) responseHeaders.append(name, item);
          } else if (value !== undefined) {
            responseHeaders.set(name, value);
          }
        }
        resolve(
          new Response(Readable.toWeb(incoming) as ReadableStream, {
            status: incoming.statusCode ?? 500,
            headers: responseHeaders,
          }),
        );
      },
    );
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("Webhook request timed out."));
    });
    request.once("error", reject);
    request.end(body);
  });
}

export async function deliverWebhookSafely(
  rawUrl: string,
  payload: JsonValue,
  headers: Record<string, string>,
  options: SafeWebhookDeliveryOptions = {},
): Promise<WebhookDeliveryResult> {
  const url = parseUrl(rawUrl, options);
  const resolved = await assertPublicResolution(url, options);
  const encoded = Buffer.from(canonicalJson(payload), "utf8");
  let response: Response;
  try {
    response = options.fetchImplementation
      ? await options.fetchImplementation(url, {
          method: "POST",
          redirect: "manual",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "user-agent": "a2a402-webhook-worker/0.1",
            ...headers,
          },
          body: encoded,
          signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
        })
      : await pinnedJsonPost(
          url,
          resolved,
          encoded,
          headers,
          options.timeoutMs ?? 5_000,
        );
  } catch {
    throw new SafeFetchError("FETCH_FAILED", "Webhook request failed.");
  }
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    throw new SafeFetchError(
      "REDIRECT_LIMIT",
      "Webhook redirects are prohibited.",
    );
  }
  const maximumResponseBytes = options.maximumResponseBytes ?? 65_536;
  if (response.body) {
    let size = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > maximumResponseBytes) {
        throw new SafeFetchError(
          "RESPONSE_TOO_LARGE",
          "Webhook response is too large.",
        );
      }
    }
  }
  if (!response.ok) {
    throw new SafeFetchError(
      "FETCH_FAILED",
      `Webhook returned HTTP ${response.status}.`,
    );
  }
  return {
    url: url.toString(),
    status: response.status,
    deliveredAt: new Date().toISOString(),
  };
}

function validateAgentCard(
  card: unknown,
  options: SafeAgentCardFetchOptions,
): asserts card is Record<string, unknown> {
  if (!card || typeof card !== "object" || Array.isArray(card)) {
    throw new SafeFetchError(
      "DOCUMENT_MALFORMED",
      "Agent Card must be a JSON object.",
    );
  }
  const value = card as Record<string, unknown>;
  if (
    typeof value.name !== "string" ||
    value.name.length === 0 ||
    value.name.length > 200
  ) {
    throw new SafeFetchError(
      "DOCUMENT_MALFORMED",
      "Agent Card name is invalid.",
    );
  }
  if (
    !Array.isArray(value.supportedInterfaces) ||
    value.supportedInterfaces.length === 0 ||
    value.supportedInterfaces.length > 20
  ) {
    throw new SafeFetchError(
      "DOCUMENT_MALFORMED",
      "A2A 1.0 Agent Card requires supportedInterfaces.",
    );
  }
  for (const item of value.supportedInterfaces) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new SafeFetchError(
        "DOCUMENT_MALFORMED",
        "Agent interface is malformed.",
      );
    }
    const iface = item as Record<string, unknown>;
    if (
      typeof iface.url !== "string" ||
      typeof iface.protocolBinding !== "string" ||
      typeof iface.protocolVersion !== "string"
    ) {
      throw new SafeFetchError(
        "DOCUMENT_MALFORMED",
        "Agent interface fields are incomplete.",
      );
    }
    parseUrl(iface.url, options);
  }
}

export async function fetchAgentCardSafely(
  rawUrl: string,
  options: SafeAgentCardFetchOptions = {},
): Promise<FetchedAgentCard> {
  const maximumBytes = options.maximumBytes ?? 1_048_576;
  const maximumRedirects = options.maximumRedirects ?? 2;
  let current = parseUrl(rawUrl, options);
  let redirects = 0;
  while (true) {
    const resolved = await assertPublicResolution(current, options);
    let response: Response;
    try {
      response = options.fetchImplementation
        ? await options.fetchImplementation(current, {
            method: "GET",
            redirect: "manual",
            headers: {
              accept: "application/json",
              "user-agent": "a2a402-agent-card-fetcher/0.1",
            },
            signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
          })
        : await pinnedRequest(current, resolved, options.timeoutMs ?? 5_000);
    } catch {
      throw new SafeFetchError("FETCH_FAILED", "Agent Card request failed.");
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects >= maximumRedirects) {
        throw new SafeFetchError(
          "REDIRECT_LIMIT",
          "Agent Card redirect limit was exceeded.",
        );
      }
      const location = response.headers.get("location");
      if (!location) {
        throw new SafeFetchError(
          "FETCH_FAILED",
          "Agent Card redirect omitted Location.",
        );
      }
      current = parseUrl(new URL(location, current).toString(), options);
      redirects += 1;
      continue;
    }
    if (!response.ok) {
      throw new SafeFetchError(
        "FETCH_FAILED",
        `Agent Card returned HTTP ${response.status}.`,
      );
    }
    const contentType =
      response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) {
      throw new SafeFetchError(
        "CONTENT_TYPE_INVALID",
        "Agent Card response must be application/json.",
      );
    }
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > maximumBytes) {
      throw new SafeFetchError(
        "RESPONSE_TOO_LARGE",
        "Agent Card response is too large.",
      );
    }
    if (!response.body)
      throw new SafeFetchError("FETCH_FAILED", "Agent Card body is missing.");
    const chunks: Uint8Array[] = [];
    let sizeBytes = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      sizeBytes += chunk.byteLength;
      if (sizeBytes > maximumBytes) {
        throw new SafeFetchError(
          "RESPONSE_TOO_LARGE",
          "Agent Card response is too large.",
        );
      }
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    let card: unknown;
    try {
      card = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new SafeFetchError(
        "DOCUMENT_MALFORMED",
        "Agent Card contains invalid JSON.",
      );
    }
    validateAgentCard(card, options);
    return {
      url: current.toString(),
      card,
      sha256: sha256(canonicalJson(card)),
      sizeBytes,
      redirects,
      fetchedAt: new Date().toISOString(),
    };
  }
}
