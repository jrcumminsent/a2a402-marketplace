import { resolve } from "node:path";

export interface MoltbookConfig {
  enabled: boolean;
  requireApproval: boolean;
  apiKey: string | null;
  credentialsPath: string;
  statePath: string;
  maxPostsPerDay: number;
  maxRepliesPerDay: number;
  sameAccountCooldownHours: number;
}

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Expected true or false, received ${value}.`);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("Moltbook limits must be positive integers.");
  }
  return parsed;
}

export function loadMoltbookConfig(
  env: NodeJS.ProcessEnv = process.env,
): MoltbookConfig {
  return {
    enabled: booleanValue(env.MOLTBOOK_AGENT_ENABLED, false),
    requireApproval: booleanValue(env.MOLTBOOK_REQUIRE_APPROVAL, true),
    apiKey: env.MOLTBOOK_API_KEY?.trim() || null,
    credentialsPath: resolve(
      env.MOLTBOOK_CREDENTIALS_PATH ?? "data/moltbook-agent/credentials.json",
    ),
    statePath: resolve(
      env.MOLTBOOK_STATE_PATH ?? "data/moltbook-agent/state.json",
    ),
    maxPostsPerDay: positiveInteger(env.MOLTBOOK_MAX_POSTS_PER_DAY, 1),
    maxRepliesPerDay: positiveInteger(env.MOLTBOOK_MAX_REPLIES_PER_DAY, 5),
    sameAccountCooldownHours: positiveInteger(
      env.MOLTBOOK_SAME_ACCOUNT_COOLDOWN_HOURS,
      24,
    ),
  };
}
