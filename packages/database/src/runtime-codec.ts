import { createHash } from "node:crypto";

export const RUNTIME_SNAPSHOT_ENCODING = "a2a402-bigint-json/0.2";
export const LEGACY_SNAPSHOT_ENCODING = "a2a402-bigint-json/0.1";

const STRING_MARKER = "~a2a402-json~";
const BIGINT_MARKER = `${STRING_MARKER}bigint:`;
const ESCAPED_STRING_MARKER = `${STRING_MARKER}string:`;

export interface EncodedRuntimeSnapshot {
  encoding: typeof RUNTIME_SNAPSHOT_ENCODING;
  payload: string;
  sha256: string;
}

export interface LegacyEncodedRuntimeSnapshot {
  encoding: typeof LEGACY_SNAPSHOT_ENCODING;
  payload: string;
}

export class RuntimeSnapshotCodecError extends Error {
  readonly code = "RUNTIME_STATE_CORRUPT";

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "RuntimeSnapshotCodecError";
  }
}

function stringifySnapshot(snapshot: unknown): string {
  if (snapshot === undefined) {
    throw new RuntimeSnapshotCodecError(
      "Runtime snapshots cannot be undefined.",
    );
  }

  try {
    const payload = JSON.stringify(
      { snapshot },
      (_key, value: unknown): unknown => {
        if (typeof value === "bigint") {
          return `${BIGINT_MARKER}${value.toString(10)}`;
        }

        if (typeof value === "string" && value.startsWith(STRING_MARKER)) {
          return `${ESCAPED_STRING_MARKER}${value}`;
        }

        return value;
      },
    );
    if (payload === undefined) {
      throw new RuntimeSnapshotCodecError(
        "Runtime snapshot serialization produced no payload.",
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof RuntimeSnapshotCodecError) {
      throw error;
    }
    throw new RuntimeSnapshotCodecError(
      "Runtime snapshot is not serializable.",
      { cause: error },
    );
  }
}

function parseSnapshot(payload: string): unknown {
  let decoded: unknown;
  try {
    decoded = JSON.parse(
      payload,
      (_key, item: unknown): unknown => {
        if (typeof item !== "string") {
          return item;
        }

        if (item.startsWith(ESCAPED_STRING_MARKER)) {
          return item.slice(ESCAPED_STRING_MARKER.length);
        }

        if (item.startsWith(BIGINT_MARKER)) {
          const digits = item.slice(BIGINT_MARKER.length);
          if (!/^-?(?:0|[1-9]\d*)$/.test(digits)) {
            throw new RuntimeSnapshotCodecError(
              "Runtime snapshot contains an invalid bigint marker.",
            );
          }
          return BigInt(digits);
        }

        return item;
      },
    );
  } catch (error) {
    if (error instanceof RuntimeSnapshotCodecError) {
      throw error;
    }
    throw new RuntimeSnapshotCodecError("Runtime snapshot JSON is invalid.", {
      cause: error,
    });
  }

  if (
    !decoded ||
    typeof decoded !== "object" ||
    !Object.prototype.hasOwnProperty.call(decoded, "snapshot")
  ) {
    throw new RuntimeSnapshotCodecError(
      "Runtime snapshot envelope is missing its snapshot value.",
    );
  }

  return (decoded as { snapshot: unknown }).snapshot;
}

export function runtimeSnapshotSha256(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function encodeRuntimeSnapshot(
  snapshot: unknown,
): EncodedRuntimeSnapshot {
  const payload = stringifySnapshot(snapshot);
  return {
    encoding: RUNTIME_SNAPSHOT_ENCODING,
    payload,
    sha256: runtimeSnapshotSha256(payload),
  };
}

export function decodeRuntimeSnapshot(input: {
  encoding: string;
  payload: string;
  sha256?: string;
}): unknown {
  if (
    input.encoding !== RUNTIME_SNAPSHOT_ENCODING &&
    input.encoding !== LEGACY_SNAPSHOT_ENCODING
  ) {
    throw new RuntimeSnapshotCodecError(
      `Unsupported runtime snapshot encoding: ${input.encoding}.`,
    );
  }

  if (input.sha256 !== undefined) {
    const actual = runtimeSnapshotSha256(input.payload);
    if (actual !== input.sha256.toLowerCase()) {
      throw new RuntimeSnapshotCodecError(
        "Runtime snapshot digest does not match its payload.",
      );
    }
  }

  return parseSnapshot(input.payload);
}

export function decodeLegacySnapshotEnvelope(value: unknown): unknown {
  if (
    !value ||
    typeof value !== "object" ||
    !("encoding" in value) ||
    !("payload" in value)
  ) {
    throw new RuntimeSnapshotCodecError(
      "Legacy engine snapshot setting has an invalid envelope.",
    );
  }

  const envelope = value as Partial<LegacyEncodedRuntimeSnapshot>;
  if (
    envelope.encoding !== LEGACY_SNAPSHOT_ENCODING ||
    typeof envelope.payload !== "string"
  ) {
    throw new RuntimeSnapshotCodecError(
      "Legacy engine snapshot setting uses an unsupported encoding.",
    );
  }

  return decodeRuntimeSnapshot({
    encoding: envelope.encoding,
    payload: envelope.payload,
  });
}

export function inferRuntimeSnapshotFormat(snapshot: unknown): string {
  if (
    snapshot &&
    typeof snapshot === "object" &&
    "format" in snapshot &&
    typeof (snapshot as { format?: unknown }).format === "string"
  ) {
    const format = (snapshot as { format: string }).format.trim();
    if (format.length > 0 && format.length <= 96) {
      return format;
    }
  }
  return "generic-json/1";
}
