import { randomUUID } from "node:crypto";
import { getStore, type Store } from "@netlify/blobs";
import {
  S3CompatibleArtifactStorage,
  type ArtifactStorage,
  type S3CompatibleClient,
  type S3ObjectHead,
  type S3ObjectOutput,
  type S3PutObjectInput,
} from "@a2a402/shared";

const STORE_NAME = "a2a402-artifacts";
const BUCKET_NAME = "netlify-blobs";

export type NetlifyBlobStore = Pick<
  Store,
  "delete" | "getMetadata" | "getWithMetadata" | "set"
>;

export type NetlifyBlobStoreFactory = () => NetlifyBlobStore;

function stringMetadata(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      )
      .slice(0, 32),
  );
}

class NetlifyBlobClient implements S3CompatibleClient {
  constructor(private readonly storeFactory: NetlifyBlobStoreFactory) {}

  private store(): NetlifyBlobStore {
    // Netlify injects a short-lived Blobs context for each invocation. A Store
    // captures that token in its internal client, so never retain Store across
    // warm invocations.
    return this.storeFactory();
  }

  async putObject(input: S3PutObjectInput): Promise<void> {
    const bytes = input.body.buffer.slice(
      input.body.byteOffset,
      input.body.byteOffset + input.body.byteLength,
    ) as ArrayBuffer;
    const result = await this.store().set(input.key, bytes, {
      metadata: {
        contentType: input.contentType,
        "a2a402-size-bytes": String(input.body.byteLength),
        ...input.metadata,
      },
      ...(input.ifNoneMatch === "*" ? { onlyIfNew: true } : {}),
    });
    if (input.ifNoneMatch === "*" && !result.modified) {
      throw new Error("Artifact key already exists in durable blob storage.");
    }
  }

  async getObject(
    _bucket: string,
    key: string,
  ): Promise<S3ObjectOutput | null> {
    const entry = await this.store().getWithMetadata(key, {
      type: "arrayBuffer",
      consistency: "strong",
    });
    if (!entry) return null;
    const metadata = stringMetadata(entry.metadata);
    const body = new Uint8Array(entry.data);
    return {
      body,
      contentType: metadata.contentType,
      contentLength: body.byteLength,
      metadata,
    };
  }

  async headObject(_bucket: string, key: string): Promise<S3ObjectHead | null> {
    const entry = await this.store().getMetadata(key, {
      consistency: "strong",
    });
    if (!entry) return null;
    const metadata = stringMetadata(entry.metadata);
    return {
      contentType: metadata.contentType,
      ...(metadata["a2a402-size-bytes"]
        ? { contentLength: Number(metadata["a2a402-size-bytes"]) }
        : {}),
      metadata,
    };
  }

  async deleteObject(_bucket: string, key: string): Promise<boolean> {
    if (!(await this.headObject(_bucket, key))) return false;
    await this.store().delete(key);
    return true;
  }

  async healthCheck(_bucket: string): Promise<boolean> {
    const store = this.store();
    const key = `health/${randomUUID()}`;
    const expected = `a2a402-storage-health:${key}`;
    try {
      const result = await store.set(key, expected, {
        onlyIfNew: true,
        metadata: { contentType: "text/plain; charset=utf-8" },
      });
      if (!result.modified) return false;
      const entry = await store.getWithMetadata(key, {
        type: "text",
        consistency: "strong",
      });
      return entry?.data === expected;
    } finally {
      await store.delete(key).catch(() => undefined);
    }
  }
}

export function createNetlifyArtifactStorage(
  maxBytes: number,
  storeFactory: NetlifyBlobStoreFactory = () => getStore(STORE_NAME),
): ArtifactStorage {
  return new S3CompatibleArtifactStorage({
    client: new NetlifyBlobClient(storeFactory),
    bucket: BUCKET_NAME,
    keyPrefix: "objects",
    maxBytes,
  });
}
