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

function stringMetadata(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .slice(0, 32),
  );
}

class NetlifyBlobClient implements S3CompatibleClient {
  constructor(private readonly store: Store) {}

  async putObject(input: S3PutObjectInput): Promise<void> {
    const bytes = input.body.buffer.slice(
      input.body.byteOffset,
      input.body.byteOffset + input.body.byteLength,
    ) as ArrayBuffer;
    const result = await this.store.set(input.key, bytes, {
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

  async getObject(_bucket: string, key: string): Promise<S3ObjectOutput | null> {
    const entry = await this.store.getWithMetadata(key, {
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
    const entry = await this.store.getMetadata(key, { consistency: "strong" });
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
    await this.store.delete(key);
    return true;
  }

  async healthCheck(_bucket: string): Promise<boolean> {
    await this.store.list({ prefix: "health/" });
    return true;
  }
}

export function createNetlifyArtifactStorage(maxBytes: number): ArtifactStorage {
  return new S3CompatibleArtifactStorage({
    client: new NetlifyBlobClient(getStore(STORE_NAME)),
    bucket: BUCKET_NAME,
    keyPrefix: "objects",
    maxBytes,
  });
}
