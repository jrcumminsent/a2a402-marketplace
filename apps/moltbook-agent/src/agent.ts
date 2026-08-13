import { randomUUID } from "node:crypto";

import type { MoltbookClient, MoltbookItem } from "./client.js";
import { MoltbookApiError } from "./client.js";
import type { MoltbookConfig } from "./config.js";
import { evaluateItem, assertOutboundAllowed } from "./policy.js";
import {
  loadState,
  normalizeMessage,
  normalizedMessageHash,
  saveState,
  type MoltbookState,
  type PendingAction,
} from "./state.js";

export type AgentLogger = (event: Record<string, unknown>) => void;

const SEARCHES = [
  "agents hiring or paying other agents for work and services",
  "autonomous agent economics marketplaces and machine commerce",
  "Proof of Earn agent-earned capital x402 HTTP 402 payments",
];

function safeLog(logger: AgentLogger, event: Record<string, unknown>): void {
  const serialized = JSON.stringify(event);
  if (
    /:[ ]*"moltbook_[a-z0-9_-]{8,}"|authorization:[ ]*bearer|api[_-]?key[ ]*[:=]/i.test(
      serialized,
    )
  ) {
    throw new Error("Refusing to log credential-like content.");
  }
  logger(event);
}

export class MoltbookBeaconAgent {
  constructor(
    private readonly client: MoltbookClient,
    private readonly config: MoltbookConfig,
    private readonly logger: AgentLogger = (event) =>
      process.stdout.write(`${JSON.stringify(event)}\n`),
  ) {}

  private async candidates(): Promise<MoltbookItem[]> {
    const results = (
      await Promise.all(SEARCHES.map((query) => this.client.search(query, 8)))
    ).flat();
    return [...new Map(results.map((item) => [item.id, item])).values()].slice(
      0,
      20,
    );
  }

  async run(mode: "dry-run" | "live"): Promise<void> {
    const status = await this.client.status();
    if (status !== "claimed") {
      throw new Error(`Moltbook account is not claimed (status: ${status}).`);
    }
    const state = await loadState(this.config.statePath);
    for (const item of await this.candidates()) {
      if (state.evaluatedPostIds.includes(item.id)) continue;
      const evaluation = evaluateItem(item);
      state.evaluatedPostIds.push(item.id);
      safeLog(this.logger, {
        timestamp: new Date().toISOString(),
        moltbook_post_id: item.postId,
        author: item.authorName,
        relevance_score: evaluation.relevanceScore,
        decision: evaluation.shouldEngage ? "candidate" : "ignore",
        reason: evaluation.reason,
        a2a402_mentioned: evaluation.mentionA2a402,
        genesis_mentioned: false,
        action: mode === "dry-run" ? "none_dry_run" : "evaluated",
      });
      if (!evaluation.shouldEngage) continue;
      if (mode === "dry-run") {
        this.logger({
          type: "RELEVANT_CONVERSATION",
          topic: item.title ?? item.content.slice(0, 120),
          relevance: evaluation.relevanceScore,
          reason: evaluation.reason,
          proposed_response: evaluation.response,
          action: "NO ACTION — DRY RUN",
        });
        continue;
      }
      const pending: PendingAction = {
        id: randomUUID(),
        kind: "reply",
        postId: item.postId,
        authorName: item.authorName,
        title: null,
        content: evaluation.response,
        createdAt: new Date().toISOString(),
      };
      if (this.config.requireApproval) {
        state.pending.push(pending);
        safeLog(this.logger, {
          timestamp: pending.createdAt,
          moltbook_post_id: item.postId,
          action: "pending_human_approval",
          pending_action_id: pending.id,
        });
      } else {
        await this.publish(pending, state);
        await saveState(this.config.statePath, state);
      }
    }
    await saveState(this.config.statePath, state);
  }

  async publish(action: PendingAction, state: MoltbookState): Promise<void> {
    assertOutboundAllowed(
      action.content,
      action.kind,
      { postId: action.postId, authorName: action.authorName },
      state,
      this.config,
    );
    try {
      const result =
        action.kind === "reply"
          ? await this.client.comment(action.postId!, action.content)
          : await this.client.createPost(
              "general",
              action.title!,
              action.content,
            );
      state.actions.push({
        kind: action.kind,
        postId: action.postId,
        authorName: action.authorName,
        contentHash: normalizedMessageHash(action.content),
        normalizedContent: normalizeMessage(action.content),
        createdAt: new Date().toISOString(),
      });
      if (action.postId) state.repliedPostIds.push(action.postId);
      safeLog(this.logger, {
        timestamp: new Date().toISOString(),
        moltbook_post_id: action.postId,
        action: "published",
        verification_required: Boolean(
          (result as Record<string, unknown>).verification_required,
        ),
      });
    } catch (error) {
      if (error instanceof MoltbookApiError && error.status === 429) {
        state.rateLimitedUntil = new Date(
          Date.now() + (error.retryAfterSeconds ?? 60) * 1000,
        ).toISOString();
      }
      throw error;
    }
  }
}
