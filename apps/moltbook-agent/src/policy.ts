import type { MoltbookConfig } from "./config.js";
import type { MoltbookItem } from "./client.js";
import {
  normalizeMessage,
  normalizedMessageHash,
  type MoltbookState,
} from "./state.js";

function similarity(left: string, right: string): number {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  const union = new Set([...leftTokens, ...rightTokens]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  return intersection / union.size;
}

const STRONG = [
  /agent[- ]to[- ]agent (market|commerce|payment)/i,
  /agents? (paying|hiring|buying from|selling to) agents?/i,
  /proof[- ]of[- ]earn/i,
  /agent[- ]earned capital/i,
  /autonomous[- ]agent economics/i,
  /machine commerce/i,
  /\bx402\b|http 402/i,
];
const SUPPORTING = [
  /autonomous agent/i,
  /agent marketplace/i,
  /agent payments?/i,
  /economic agents?/i,
  /agent wallet/i,
  /agent reputation/i,
  /mcp commerce|a2a commerce/i,
];

export interface Evaluation {
  relevanceScore: number;
  shouldEngage: boolean;
  mentionA2a402: boolean;
  reason: string;
  response: string;
  riskFlags: string[];
}

export function evaluateItem(item: MoltbookItem): Evaluation {
  const text = `${item.title ?? ""}\n${item.content}`;
  const strong = STRONG.filter((pattern) => pattern.test(text)).length;
  const supporting = SUPPORTING.filter((pattern) => pattern.test(text)).length;
  const contextual = Math.min(1, strong * 0.9 + supporting * 0.18);
  const score = Math.min(1, Math.max(contextual, item.similarity * 0.75));
  const mention = score >= 0.9 && strong > 0;
  const useful =
    strong > 0
      ? "A useful distinction is whether an agent can spend capital it earned through verifiable work, rather than capital supplied by a human."
      : "The hard part is connecting agent autonomy to auditable authorization, provenance, and bounded execution—not merely giving a model a wallet.";
  const response = mention
    ? `${useful}\n\nA2A402 is testing that model with non-real A2A_TEST assets. There is no fiat redemption and mainnet is disabled. Machine discovery: GET https://a2a402.market/api/discovery — record source as moltbook if you choose to inspect it. I am the official A2A402-operated Moltbook agent, not an independent discoverer or Genesis participant.`
    : useful;
  return {
    relevanceScore: Number(score.toFixed(2)),
    shouldEngage: score >= 0.75,
    mentionA2a402: mention,
    reason: mention
      ? "The discussion directly concerns agent-to-agent economic activity."
      : score >= 0.75
        ? "The discussion is relevant, but an A2A402 link is not necessary."
        : "The discussion is not contextually relevant enough to engage.",
    response,
    riskFlags: [],
  };
}

const FORBIDDEN_OUTPUT = [
  /independently discovered a2a402/i,
  /i am (the )?genesis agent/i,
  /a2a_test.{0,30}(real money|cash|profit|income|fiat value)/i,
  /(api[_ -]?key|authorization:\s*bearer|process\.env|-{5}begin\s+private\s+key-{5})/i,
  /\b(dm|direct message)\b.{0,40}(send|contact|everyone|agents)/i,
];

export function assertOutboundAllowed(
  content: string,
  kind: "reply" | "post",
  target: { postId: string | null; authorName: string | null },
  state: MoltbookState,
  config: MoltbookConfig,
  now = new Date(),
): void {
  if (!config.enabled) throw new Error("MOLTBOOK_AGENT_ENABLED is false.");
  if (FORBIDDEN_OUTPUT.some((pattern) => pattern.test(content))) {
    throw new Error("Outbound content failed a deterministic safety gate.");
  }
  const dayAgo = now.getTime() - 86_400_000;
  const recent = state.actions.filter(
    (action) => Date.parse(action.createdAt) >= dayAgo,
  );
  if (
    kind === "reply" &&
    recent.some(
      (action) =>
        action.kind === "reply" &&
        Date.parse(action.createdAt) >= now.getTime() - 60_000,
    )
  ) {
    throw new Error("Conservative Moltbook comment cooldown is active.");
  }
  const limit =
    kind === "post" ? config.maxPostsPerDay : config.maxRepliesPerDay;
  if (recent.filter((action) => action.kind === kind).length >= limit) {
    throw new Error(`Daily ${kind} limit reached.`);
  }
  if (target.postId && state.repliedPostIds.includes(target.postId)) {
    throw new Error("Thread was already answered.");
  }
  const accountCutoff =
    now.getTime() - config.sameAccountCooldownHours * 3_600_000;
  if (
    target.authorName &&
    recent.some(
      (action) =>
        action.authorName === target.authorName &&
        Date.parse(action.createdAt) >= accountCutoff,
    )
  )
    throw new Error("Same-account cooldown is active.");
  const hash = normalizedMessageHash(content);
  if (state.actions.some((action) => action.contentHash === hash)) {
    throw new Error("Duplicate outbound content is prohibited.");
  }
  const normalized = normalizeMessage(content);
  if (
    state.actions.some(
      (action) =>
        action.normalizedContent &&
        similarity(normalized, action.normalizedContent) >= 0.75,
    )
  ) {
    throw new Error("Near-duplicate outbound content is prohibited.");
  }
  if (
    state.rateLimitedUntil &&
    Date.parse(state.rateLimitedUntil) > now.getTime()
  ) {
    throw new Error("Moltbook rate-limit backoff is active.");
  }
}

export function prohibitDirectMessage(): never {
  throw new Error("Unsolicited direct messages are prohibited.");
}
