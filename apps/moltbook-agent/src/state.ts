import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface PendingAction {
  id: string;
  kind: "reply" | "post";
  postId: string | null;
  authorName: string | null;
  title: string | null;
  content: string;
  createdAt: string;
}

export interface ActionRecord {
  kind: "reply" | "post";
  postId: string | null;
  authorName: string | null;
  contentHash: string;
  normalizedContent?: string;
  createdAt: string;
}

export interface MoltbookState {
  evaluatedPostIds: string[];
  repliedPostIds: string[];
  actions: ActionRecord[];
  pending: PendingAction[];
  rejectedPendingIds: string[];
  rateLimitedUntil: string | null;
}

export const EMPTY_STATE: MoltbookState = {
  evaluatedPostIds: [],
  repliedPostIds: [],
  actions: [],
  pending: [],
  rejectedPendingIds: [],
  rateLimitedUntil: null,
};

export function normalizedMessageHash(content: string): string {
  return createHash("sha256").update(normalizeMessage(content)).digest("hex");
}

export function normalizeMessage(content: string): string {
  return content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function loadState(path: string): Promise<MoltbookState> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as MoltbookState;
    return { ...EMPTY_STATE, ...parsed };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return structuredClone(EMPTY_STATE);
    }
    throw error;
  }
}

export async function saveState(
  path: string,
  state: MoltbookState,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}

export async function saveCredentials(
  path: string,
  input: { apiKey: string; agentName: string; claimUrl: string },
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(input, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function credentialApiKey(path: string): Promise<string | null> {
  try {
    const body = JSON.parse(await readFile(path, "utf8")) as {
      apiKey?: unknown;
    };
    return typeof body.apiKey === "string" ? body.apiKey : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
