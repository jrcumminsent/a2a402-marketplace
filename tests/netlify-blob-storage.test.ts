import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createNetlifyArtifactStorage,
  type NetlifyBlobStore,
} from "../netlify/functions/blob-storage.js";

interface FakeBlob {
  data: Uint8Array;
  metadata: Record<string, string>;
}

class FakeStore {
  readonly blobs: Map<string, FakeBlob>;
  readonly failure: Error | null;

  constructor(
    blobs = new Map<string, FakeBlob>(),
    failure: Error | null = null,
  ) {
    this.blobs = blobs;
    this.failure = failure;
  }

  private available(): void {
    if (this.failure) throw this.failure;
  }

  async set(
    key: string,
    value: string | ArrayBuffer,
    options: { metadata?: Record<string, string>; onlyIfNew?: boolean } = {},
  ): Promise<{ etag: string; modified: boolean }> {
    this.available();
    if (options.onlyIfNew && this.blobs.has(key)) {
      return { etag: "existing", modified: false };
    }
    const data =
      typeof value === "string"
        ? new TextEncoder().encode(value)
        : new Uint8Array(value);
    this.blobs.set(key, {
      data: Uint8Array.from(data),
      metadata: { ...(options.metadata ?? {}) },
    });
    return { etag: "stored", modified: true };
  }

  async getWithMetadata(
    key: string,
    options: { type?: string } = {},
  ): Promise<{
    data: string | ArrayBuffer;
    metadata: Record<string, string>;
  } | null> {
    this.available();
    const blob = this.blobs.get(key);
    if (!blob) return null;
    return {
      data:
        options.type === "text"
          ? new TextDecoder().decode(blob.data)
          : (Uint8Array.from(blob.data).buffer as ArrayBuffer),
      metadata: { ...blob.metadata },
    };
  }

  async getMetadata(
    key: string,
  ): Promise<{ metadata: Record<string, string> } | null> {
    this.available();
    const blob = this.blobs.get(key);
    return blob ? { metadata: { ...blob.metadata } } : null;
  }

  async delete(key: string): Promise<void> {
    this.available();
    this.blobs.delete(key);
  }
}

function factory(store: FakeStore): () => NetlifyBlobStore {
  return () => store as unknown as NetlifyBlobStore;
}

describe("Netlify durable artifact storage", () => {
  it("writes, reads, verifies, and deletes immutable artifact bytes", async () => {
    const store = new FakeStore();
    const storage = createNetlifyArtifactStorage(1_024, factory(store));
    const bytes = new TextEncoder().encode('{"proof":"durable"}');
    const expectedSha256 = createHash("sha256").update(bytes).digest("hex");

    const saved = await storage.put({
      key: "proofs/durable.json",
      data: bytes,
      mimeType: "application/json",
      expectedSha256,
    });
    expect(saved.sha256).toBe(expectedSha256);
    await expect(storage.get("missing.json")).resolves.toBeNull();
    const loaded = await storage.get(saved.key);
    expect(loaded?.sha256).toBe(expectedSha256);
    expect(loaded?.data).toEqual(bytes);
    await expect(storage.delete(saved.key)).resolves.toBe(true);
    await expect(storage.get(saved.key)).resolves.toBeNull();
  });

  it("performs a backing-store write/read/delete health probe", async () => {
    const store = new FakeStore();
    const storage = createNetlifyArtifactStorage(1_024, factory(store));
    await expect(storage.health()).resolves.toMatchObject({ healthy: true });
    expect(store.blobs.size).toBe(0);
  });

  it("reports an expired runtime credential and recovers with a fresh store", async () => {
    const shared = new Map<string, FakeBlob>();
    const stores = [
      new FakeStore(shared, new Error("Failed to decode token: Token expired")),
      new FakeStore(shared),
    ];
    let invocation = 0;
    const storage = createNetlifyArtifactStorage(
      1_024,
      () =>
        stores[
          Math.min(invocation++, stores.length - 1)
        ] as unknown as NetlifyBlobStore,
    );

    await expect(storage.health()).resolves.toMatchObject({
      healthy: false,
      details: { error: expect.stringContaining("Token expired") },
    });
    await expect(storage.health()).resolves.toMatchObject({ healthy: true });
    expect(invocation).toBe(2);
  });
});
