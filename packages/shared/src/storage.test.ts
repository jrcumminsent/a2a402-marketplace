import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ArtifactStorageError,
  InMemoryS3CompatibleClient,
  LocalArtifactStorage,
  S3CompatibleArtifactStorage,
} from "./storage.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("artifact storage", () => {
  it("stores immutable, hash-verified local artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "a2a402-artifacts-"));
    temporaryDirectories.push(root);
    const storage = new LocalArtifactStorage({ rootPath: root, maxBytes: 100 });
    const stored = await storage.put({
      key: "contracts/one/result.json",
      data: '{"answer":42}',
      mimeType: "application/json",
    });
    expect(stored.uri).toBe("local-artifact://contracts/one/result.json");
    await expect(
      storage.get("contracts/one/result.json"),
    ).resolves.toMatchObject({
      sha256: stored.sha256,
      sizeBytes: 13,
    });
    await expect(
      storage.put({
        key: "contracts/one/result.json",
        data: "different",
        mimeType: "text/plain",
      }),
    ).rejects.toBeInstanceOf(ArtifactStorageError);
    await expect(
      storage.put({
        key: "../escape",
        data: "bad",
        mimeType: "text/plain",
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_KEY_INVALID" });
  });

  it("adapts an S3-compatible client without a vendor dependency", async () => {
    const storage = new S3CompatibleArtifactStorage({
      client: new InMemoryS3CompatibleClient(),
      bucket: "test-artifacts",
      keyPrefix: "a2a402",
    });
    const stored = await storage.put({
      key: "contracts/two/result.json",
      data: '{"ok":true}',
      mimeType: "application/json",
      metadata: { contract_id: "two" },
    });
    expect(stored.uri).toBe(
      "s3://test-artifacts/a2a402/contracts/two/result.json",
    );
    await expect(
      storage.get("contracts/two/result.json"),
    ).resolves.toMatchObject({
      metadata: { contract_id: "two" },
    });
    await expect(storage.health()).resolves.toMatchObject({ healthy: true });
  });
});
