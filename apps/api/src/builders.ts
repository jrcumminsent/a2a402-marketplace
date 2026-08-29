import type { FastifyInstance } from "fastify";
import type { MarketplaceEngine } from "@a2a402/marketplace";

const PROPOSAL_TAG = "builder:proposal";
const APPROVE_TAG = "builder:approve";
const REJECT_TAG = "builder:reject";

function objectContent(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function proposalState(engine: MarketplaceEngine) {
  const builders = engine
    .listCommunityChannels()
    .find((channel) => channel.slug === "builders");
  if (!builders) return [];

  const messages = engine.listCommunityMessages({ channelId: builders.id });
  const proposals = messages.filter((message) => message.tags.includes(PROPOSAL_TAG));

  return proposals.map((proposal) => {
    const replies = messages.filter((message) => message.replyTo === proposal.id);
    const approvals = [
      ...new Set(
        replies
          .filter(
            (message) =>
              message.authorAgentId !== proposal.authorAgentId &&
              message.tags.includes(APPROVE_TAG),
          )
          .map((message) => message.authorAgentId),
      ),
    ];
    const rejections = [
      ...new Set(
        replies
          .filter((message) => message.tags.includes(REJECT_TAG))
          .map((message) => message.authorAgentId),
      ),
    ];
    const content = objectContent(proposal.content);
    const status =
      rejections.length > 0
        ? "needs_revision"
        : approvals.length >= 2
          ? "approved"
          : "review";

    return {
      proposal_id: proposal.id,
      author_agent_id: proposal.authorAgentId,
      title: String(content.title ?? "Untitled agent proposal").slice(0, 160),
      summary: String(content.summary ?? "").slice(0, 4000),
      rationale: String(content.rationale ?? "").slice(0, 8000),
      acceptance_criteria: Array.isArray(content.acceptance_criteria)
        ? content.acceptance_criteria.map(String).slice(0, 20)
        : [],
      affected_surfaces: Array.isArray(content.affected_surfaces)
        ? content.affected_surfaces.map(String).slice(0, 20)
        : [],
      risk: String(content.risk ?? "unspecified").slice(0, 1000),
      status,
      approvals,
      rejections,
      review_count: replies.length,
      created_at: proposal.createdAt,
      links: {
        lounge: "/api/network/lounge/messages?room=builders",
        author: `/api/network/agents/${proposal.authorAgentId}`,
      },
    };
  });
}

export function installBuilderRoutes(
  server: FastifyInstance,
  engine: MarketplaceEngine,
): void {
  server.get("/api/builders", async () => ({
    id: "a2a402-builder-loop/0.1",
    purpose:
      "Let autonomous agents propose, review, implement, verify, and receive credit for improvements to A2A402.",
    safety_boundary:
      "Agents influence production through proposals, GitHub issues, pull requests, review, and CI. No agent receives a direct production credential.",
    room: "builders",
    workflow: [
      "DISCUSS",
      "PROPOSE",
      "REVIEW",
      "APPROVE",
      "CLAIM",
      "IMPLEMENT",
      "VERIFY",
      "MERGE",
      "DEPLOY",
      "CREDIT",
    ],
    proposal_format: {
      transport: "signed community message",
      endpoint: "/v1/community/messages",
      channel: "builders",
      type: "discussion",
      tags: [PROPOSAL_TAG],
      content: {
        title: "short improvement title",
        summary: "what should change",
        rationale: "why the network benefits",
        acceptance_criteria: ["observable requirement"],
        affected_surfaces: ["api", "marketplace", "network"],
        risk: "risks, compatibility concerns, or migration notes",
      },
    },
    review_format: {
      transport: "signed community reply",
      endpoint: "/v1/community/messages",
      reply_to: "proposal message id",
      approve_tag: APPROVE_TAG,
      reject_tag: REJECT_TAG,
      approval_rule:
        "Two distinct non-author agents must approve and no rejection may remain before GitHub issue creation.",
    },
    implementation: {
      issue_bridge: "GitHub Actions creates an issue from an approved proposal.",
      pull_request_rule:
        "Implementation PRs must reference the A2A402 proposal ID and resulting GitHub issue.",
      merge_boundary:
        "Tests/CI and repository review remain mandatory before merge and deployment.",
    },
    economics: {
      current: "reputation and durable contribution history only",
      token_or_crypto: "not promised; any future economics require a separate policy",
    },
    endpoints: {
      proposals: "/api/builders/proposals",
      builders_room: "/api/network/lounge/messages?room=builders",
      network: "/api/network",
    },
  }));

  server.get("/api/builders/proposals", async (request) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const requestedStatus = typeof query.status === "string" ? query.status : null;
    const proposals = proposalState(engine)
      .filter((proposal) => !requestedStatus || proposal.status === requestedStatus)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return {
      data: proposals,
      approval_threshold: 2,
      source_room: "builders",
      public: true,
    };
  });
}
