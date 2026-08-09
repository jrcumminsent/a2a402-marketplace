import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { JsonValue } from "./index.js";

export type ArtifactStorageMode = "local" | "s3";

export interface ArtifactWrite {
  key: string;
  data: Uint8Array | string;
  mimeType: string;
  expectedSha256?: string;
  metadata?: Record<string, JsonValue>;
}

export interface StoredArtifact {
  key: string;
  uri: string;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: string;
  metadata: Record<string, JsonValue>;
}

export interface ArtifactObject extends StoredArtifact {
  data: Uint8Array;
}

export interface ArtifactStorageHealth {
  mode: ArtifactStorageMode;
  healthy: boolean;
  details: Record<string, JsonValue>;
}

export interface ArtifactStorage {
  readonly mode: ArtifactStorageMode;
  put(input: ArtifactWrite): Promise<StoredArtifact>;
  get(key: string): Promise<ArtifactObject | null>;
  getByUri(uri: string): Promise<ArtifactObject | null>;
  head(key: string): Promise<StoredArtifact | null>;
  headByUri(uri: string): Promise<StoredArtifact | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  health(): Promise<ArtifactStorageHealth>;
}

export type ArtifactStorageErrorCode =
  | "ARTIFACT_KEY_INVALID"
  | "ARTIFACT_TOO_LARGE"
  | "ARTIFACT_HASH_MISMATCH"
  | "ARTIFACT_ALREADY_EXISTS"
  | "ARTIFACT_CORRUPT"
  | "ARTIFACT_STORAGE_UNAVAILABLE";

export class ArtifactStorageError extends Error {
  constructor(
    readonly code: ArtifactStorageErrorCode,
    message: string,
    readonly details: Record<string, JsonValue> = {},
  ) {
    super(message);
    this.name = "ArtifactStorageError";
  }
}

function normalizeHash(value: string): string {
  return value.toLowerCase().replace(/^sha256:/, "");
}

function digest(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function toBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === "string" ? Buffer.from(data, "utf8") : data;
}

function validateArtifactKey(key: string): string {
  if (
    !key ||
    key.length > 1_024 ||
    isAbsolute(key) ||
    key.startsWith("/") ||
    key.startsWith("\\") ||
    key.includes("\\") ||
    key.includes("\0") ||
    /[\u0000-\u001f\u007f]/.test(key)
  ) {
    throw new ArtifactStorageError(
      "ARTIFACT_KEY_INVALID",
      "Artifact key must be a relative, forward-slash-delimited key.",
    );
  }
  const segments = key.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        segment.endsWith(".") ||
        segment.endsWith(" "),
    )
  ) {
    throw new ArtifactStorageError(
      "ARTIFACT_KEY_INVALID",
      "Artifact key contains an unsafe path segment.",
    );
  }
  return segments.join("/");
}

function assertContained(root: string, target: string): void {
  const fromRoot = relative(root, target);
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new ArtifactStorageError(
      "ARTIFACT_KEY_INVALID",
      "Artifact key resolves outside the configured storage root.",
    );
  }
}

function encodeKey(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function decodeEncodedKey(value: string): string {
  try {
    return value
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    throw new ArtifactStorageError(
      "ARTIFACT_KEY_INVALID",
      "Artifact URI contains malformed path encoding.",
    );
  }
}

export interface LocalArtifactStorageOptions {
  rootPath: string;
  maxBytes?: number;
  now?: () => Date;
}

export class LocalArtifactStorage implements ArtifactStorage {
  readonly mode = "local" as const;

  private readonly rootPath: string;
  private readonly objectRoot: string;
  private readonly metadataRoot: string;
  private readonly maxBytes: number;
  private readonly now: () => Date;

  constructor(options: LocalArtifactStorageOptions) {
    if (!options.rootPath) {
      throw new ArtifactStorageError(
        "ARTIFACT_STORAGE_UNAVAILABLE",
        "A local artifact storage root is required.",
      );
    }
    this.rootPath = resolve(options.rootPath);
    this.objectRoot = resolve(this.rootPath, "objects");
    this.metadataRoot = resolve(this.rootPath, "metadata");
    this.maxBytes = options.maxBytes ?? 50 * 1024 * 1024;
    this.now = options.now ?? (() => new Date());
  }

  async put(input: ArtifactWrite): Promise<StoredArtifact> {
    const key = validateArtifactKey(input.key);
    const bytes = toBytes(input.data);
    if (bytes.byteLength > this.maxBytes) {
      throw new ArtifactStorageError(
        "ARTIFACT_TOO_LARGE",
        "Artifact exceeds the configured maximum size.",
        { size_bytes: bytes.byteLength, max_bytes: this.maxBytes },
      );
    }
    const sha256 = digest(bytes);
    if (
      input.expectedSha256 &&
      normalizeHash(input.expectedSha256) !== sha256
    ) {
      throw new ArtifactStorageError(
        "ARTIFACT_HASH_MISMATCH",
        "Artifact bytes do not match the expected SHA-256 hash.",
        {
          expected_sha256: normalizeHash(input.expectedSha256),
          actual_sha256: sha256,
        },
      );
    }
    await this.initialize();
    const objectPath = this.objectPath(key);
    const metadataPath = this.metadataPath(key);
    await mkdir(resolve(objectPath, ".."), { recursive: true });
    await mkdir(resolve(metadataPath, ".."), { recursive: true });

    const existing = await this.head(key);
    if (existing) {
      if (
        existing.sha256 === sha256 &&
        existing.mimeType === input.mimeType &&
        existing.sizeBytes === bytes.byteLength
      ) {
        return existing;
      }
      throw new ArtifactStorageError(
        "ARTIFACT_ALREADY_EXISTS",
        "Artifact keys are immutable and the key already contains different data.",
        { key },
      );
    }

    const stored: StoredArtifact = {
      key,
      uri: `local-artifact://${encodeKey(key)}`,
      sha256,
      sizeBytes: bytes.byteLength,
      mimeType: input.mimeType,
      createdAt: this.now().toISOString(),
      metadata: input.metadata ?? {},
    };
    const objectTemp = `${objectPath}.${randomUUID()}.tmp`;
    const metadataTemp = `${metadataPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(objectTemp, bytes, { flag: "wx" });
      await writeFile(metadataTemp, JSON.stringify(stored), {
        encoding: "utf8",
        flag: "wx",
      });
      await rename(objectTemp, objectPath);
      await rename(metadataTemp, metadataPath);
    } catch (error) {
      await Promise.all([
        unlink(objectTemp).catch(() => undefined),
        unlink(metadataTemp).catch(() => undefined),
      ]);
      throw new ArtifactStorageError(
        "ARTIFACT_STORAGE_UNAVAILABLE",
        error instanceof Error
          ? error.message
          : "Failed to write local artifact.",
      );
    }
    return stored;
  }

  async get(keyInput: string): Promise<ArtifactObject | null> {
    const key = validateArtifactKey(keyInput);
    const metadata = await this.head(key);
    if (!metadata) return null;
    let data: Uint8Array;
    try {
      data = await readFile(this.objectPath(key));
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        throw new ArtifactStorageError(
          "ARTIFACT_CORRUPT",
          "Artifact metadata exists but object bytes are missing.",
          { key },
        );
      }
      throw error;
    }
    if (
      data.byteLength !== metadata.sizeBytes ||
      digest(data) !== metadata.sha256
    ) {
      throw new ArtifactStorageError(
        "ARTIFACT_CORRUPT",
        "Stored artifact no longer matches its immutable metadata.",
        { key },
      );
    }
    return { ...metadata, data };
  }

  async getByUri(uri: string): Promise<ArtifactObject | null> {
    return this.get(this.keyFromUri(uri));
  }

  async head(keyInput: string): Promise<StoredArtifact | null> {
    const key = validateArtifactKey(keyInput);
    try {
      const raw = await readFile(this.metadataPath(key), "utf8");
      const parsed = JSON.parse(raw) as StoredArtifact;
      if (
        parsed.key !== key ||
        typeof parsed.sha256 !== "string" ||
        typeof parsed.sizeBytes !== "number" ||
        typeof parsed.mimeType !== "string"
      ) {
        throw new ArtifactStorageError(
          "ARTIFACT_CORRUPT",
          "Stored artifact metadata is malformed.",
          { key },
        );
      }
      return parsed;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      if (error instanceof ArtifactStorageError) throw error;
      throw new ArtifactStorageError(
        "ARTIFACT_CORRUPT",
        error instanceof Error
          ? error.message
          : "Stored artifact metadata could not be read.",
        { key },
      );
    }
  }

  async headByUri(uri: string): Promise<StoredArtifact | null> {
    return this.head(this.keyFromUri(uri));
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }

  async delete(keyInput: string): Promise<boolean> {
    const key = validateArtifactKey(keyInput);
    const exists = await this.head(key);
    if (!exists) return false;
    await Promise.all([
      unlink(this.objectPath(key)),
      unlink(this.metadataPath(key)),
    ]);
    return true;
  }

  async health(): Promise<ArtifactStorageHealth> {
    try {
      await this.initialize();
      await Promise.all([stat(this.objectRoot), stat(this.metadataRoot)]);
      return {
        mode: this.mode,
        healthy: true,
        details: {
          root_path: this.rootPath,
          max_bytes: this.maxBytes,
        },
      };
    } catch (error) {
      return {
        mode: this.mode,
        healthy: false,
        details: {
          error:
            error instanceof Error
              ? error.message
              : "Local storage unavailable",
        },
      };
    }
  }

  private async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.objectRoot, { recursive: true }),
      mkdir(this.metadataRoot, { recursive: true }),
    ]);
  }

  private objectPath(key: string): string {
    const target = resolve(this.objectRoot, ...key.split("/"));
    assertContained(this.objectRoot, target);
    return target;
  }

  private metadataPath(key: string): string {
    const target = resolve(this.metadataRoot, ...key.split("/")) + ".json";
    assertContained(this.metadataRoot, target);
    return target;
  }

  private keyFromUri(uri: string): string {
    const prefix = "local-artifact://";
    if (!uri.startsWith(prefix)) {
      throw new ArtifactStorageError(
        "ARTIFACT_KEY_INVALID",
        "Artifact URI does not belong to local storage.",
      );
    }
    return validateArtifactKey(decodeEncodedKey(uri.slice(prefix.length)));
  }
}

export interface S3PutObjectInput {
  bucket: string;
  key: string;
  body: Uint8Array;
  contentType: string;
  metadata: Record<string, string>;
  ifNoneMatch?: "*";
}

export interface S3ObjectOutput {
  body: Uint8Array;
  contentType?: string;
  contentLength?: number;
  metadata: Record<string, string>;
}

export interface S3ObjectHead {
  contentType?: string;
  contentLength?: number;
  metadata: Record<string, string>;
}

/**
 * Deliberately mirrors S3 semantics without depending on one vendor SDK.
 * Production wiring can adapt AWS SDK v3, MinIO, Cloudflare R2, or Supabase
 * Storage to this interface.
 */
export interface S3CompatibleClient {
  putObject(input: S3PutObjectInput): Promise<void>;
  getObject(bucket: string, key: string): Promise<S3ObjectOutput | null>;
  headObject(bucket: string, key: string): Promise<S3ObjectHead | null>;
  deleteObject(bucket: string, key: string): Promise<boolean>;
  healthCheck(bucket: string): Promise<boolean>;
}

export interface S3CompatibleArtifactStorageOptions {
  client: S3CompatibleClient;
  bucket: string;
  keyPrefix?: string;
  maxBytes?: number;
  now?: () => Date;
}

export class S3CompatibleArtifactStorage implements ArtifactStorage {
  readonly mode = "s3" as const;

  private readonly client: S3CompatibleClient;
  private readonly bucket: string;
  private readonly keyPrefix: string;
  private readonly maxBytes: number;
  private readonly now: () => Date;

  constructor(options: S3CompatibleArtifactStorageOptions) {
    if (!options.bucket) {
      throw new ArtifactStorageError(
        "ARTIFACT_STORAGE_UNAVAILABLE",
        "An S3-compatible bucket is required.",
      );
    }
    this.client = options.client;
    this.bucket = options.bucket;
    this.keyPrefix = options.keyPrefix
      ? `${validateArtifactKey(options.keyPrefix).replace(/\/+$/, "")}/`
      : "";
    this.maxBytes = options.maxBytes ?? 50 * 1024 * 1024;
    this.now = options.now ?? (() => new Date());
  }

  async put(input: ArtifactWrite): Promise<StoredArtifact> {
    const key = validateArtifactKey(input.key);
    const bytes = toBytes(input.data);
    if (bytes.byteLength > this.maxBytes) {
      throw new ArtifactStorageError(
        "ARTIFACT_TOO_LARGE",
        "Artifact exceeds the configured maximum size.",
        { size_bytes: bytes.byteLength, max_bytes: this.maxBytes },
      );
    }
    const sha256 = digest(bytes);
    if (
      input.expectedSha256 &&
      normalizeHash(input.expectedSha256) !== sha256
    ) {
      throw new ArtifactStorageError(
        "ARTIFACT_HASH_MISMATCH",
        "Artifact bytes do not match the expected SHA-256 hash.",
        {
          expected_sha256: normalizeHash(input.expectedSha256),
          actual_sha256: sha256,
        },
      );
    }
    const existing = await this.head(key);
    if (existing) {
      if (
        existing.sha256 === sha256 &&
        existing.mimeType === input.mimeType &&
        existing.sizeBytes === bytes.byteLength
      ) {
        return existing;
      }
      throw new ArtifactStorageError(
        "ARTIFACT_ALREADY_EXISTS",
        "Artifact keys are immutable and the key already contains different data.",
        { key },
      );
    }
    const stored: StoredArtifact = {
      key,
      uri: `s3://${this.bucket}/${encodeKey(this.fullKey(key))}`,
      sha256,
      sizeBytes: bytes.byteLength,
      mimeType: input.mimeType,
      createdAt: this.now().toISOString(),
      metadata: input.metadata ?? {},
    };
    await this.client.putObject({
      bucket: this.bucket,
      key: this.fullKey(key),
      body: bytes,
      contentType: input.mimeType,
      metadata: {
        "a2a402-sha256": sha256,
        "a2a402-created-at": stored.createdAt,
        "a2a402-metadata": Buffer.from(
          JSON.stringify(stored.metadata),
          "utf8",
        ).toString("base64"),
      },
      ifNoneMatch: "*",
    });
    return stored;
  }

  async get(keyInput: string): Promise<ArtifactObject | null> {
    const key = validateArtifactKey(keyInput);
    const object = await this.client.getObject(this.bucket, this.fullKey(key));
    if (!object) return null;
    const metadata = this.metadataFromHead(key, object);
    if (
      object.body.byteLength !== metadata.sizeBytes ||
      digest(object.body) !== metadata.sha256
    ) {
      throw new ArtifactStorageError(
        "ARTIFACT_CORRUPT",
        "S3-compatible artifact bytes do not match immutable metadata.",
        { key },
      );
    }
    return { ...metadata, data: object.body };
  }

  async getByUri(uri: string): Promise<ArtifactObject | null> {
    return this.get(this.keyFromUri(uri));
  }

  async head(keyInput: string): Promise<StoredArtifact | null> {
    const key = validateArtifactKey(keyInput);
    const head = await this.client.headObject(this.bucket, this.fullKey(key));
    return head ? this.metadataFromHead(key, head) : null;
  }

  async headByUri(uri: string): Promise<StoredArtifact | null> {
    return this.head(this.keyFromUri(uri));
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }

  async delete(keyInput: string): Promise<boolean> {
    const key = validateArtifactKey(keyInput);
    return this.client.deleteObject(this.bucket, this.fullKey(key));
  }

  async health(): Promise<ArtifactStorageHealth> {
    try {
      const healthy = await this.client.healthCheck(this.bucket);
      return {
        mode: this.mode,
        healthy,
        details: {
          bucket: this.bucket,
          key_prefix: this.keyPrefix,
          max_bytes: this.maxBytes,
        },
      };
    } catch (error) {
      return {
        mode: this.mode,
        healthy: false,
        details: {
          bucket: this.bucket,
          error:
            error instanceof Error ? error.message : "S3 storage unavailable",
        },
      };
    }
  }

  private fullKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  private keyFromUri(uri: string): string {
    const prefix = `s3://${this.bucket}/`;
    if (!uri.startsWith(prefix)) {
      throw new ArtifactStorageError(
        "ARTIFACT_KEY_INVALID",
        "Artifact URI does not belong to the configured S3 bucket.",
      );
    }
    const fullKey = decodeEncodedKey(uri.slice(prefix.length));
    if (!fullKey.startsWith(this.keyPrefix)) {
      throw new ArtifactStorageError(
        "ARTIFACT_KEY_INVALID",
        "Artifact URI is outside the configured S3 key prefix.",
      );
    }
    return validateArtifactKey(fullKey.slice(this.keyPrefix.length));
  }

  private metadataFromHead(key: string, head: S3ObjectHead): StoredArtifact {
    const sha256 = head.metadata["a2a402-sha256"];
    const createdAt = head.metadata["a2a402-created-at"];
    if (!sha256 || !createdAt || head.contentLength === undefined) {
      throw new ArtifactStorageError(
        "ARTIFACT_CORRUPT",
        "S3-compatible object is missing required a2a402 metadata.",
        { key },
      );
    }
    let metadata: Record<string, JsonValue> = {};
    const encodedMetadata = head.metadata["a2a402-metadata"];
    if (encodedMetadata) {
      try {
        metadata = JSON.parse(
          Buffer.from(encodedMetadata, "base64").toString("utf8"),
        ) as Record<string, JsonValue>;
      } catch {
        throw new ArtifactStorageError(
          "ARTIFACT_CORRUPT",
          "S3-compatible object metadata is malformed.",
          { key },
        );
      }
    }
    return {
      key,
      uri: `s3://${this.bucket}/${encodeKey(this.fullKey(key))}`,
      sha256,
      sizeBytes: head.contentLength,
      mimeType: head.contentType ?? "application/octet-stream",
      createdAt,
      metadata,
    };
  }
}

interface InMemoryS3Object {
  body: Uint8Array;
  contentType: string;
  metadata: Record<string, string>;
}

/** Test adapter with the same immutability behavior expected from S3 If-None-Match. */
export class InMemoryS3CompatibleClient implements S3CompatibleClient {
  private readonly objects = new Map<string, InMemoryS3Object>();

  async putObject(input: S3PutObjectInput): Promise<void> {
    const id = `${input.bucket}/${input.key}`;
    if (input.ifNoneMatch === "*" && this.objects.has(id)) {
      throw new ArtifactStorageError(
        "ARTIFACT_ALREADY_EXISTS",
        "S3 object already exists.",
      );
    }
    this.objects.set(id, {
      body: Uint8Array.from(input.body),
      contentType: input.contentType,
      metadata: { ...input.metadata },
    });
  }

  async getObject(bucket: string, key: string): Promise<S3ObjectOutput | null> {
    const object = this.objects.get(`${bucket}/${key}`);
    if (!object) return null;
    return {
      body: Uint8Array.from(object.body),
      contentType: object.contentType,
      contentLength: object.body.byteLength,
      metadata: { ...object.metadata },
    };
  }

  async headObject(bucket: string, key: string): Promise<S3ObjectHead | null> {
    const object = this.objects.get(`${bucket}/${key}`);
    if (!object) return null;
    return {
      contentType: object.contentType,
      contentLength: object.body.byteLength,
      metadata: { ...object.metadata },
    };
  }

  async deleteObject(bucket: string, key: string): Promise<boolean> {
    return this.objects.delete(`${bucket}/${key}`);
  }

  async healthCheck(_bucket: string): Promise<boolean> {
    return true;
  }
}
