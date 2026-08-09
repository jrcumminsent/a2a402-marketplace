import { describe, expect, it } from "vitest";
import type { Message } from "@a2a-js/sdk";
import {
  A2A_PROTOCOL_VERSION,
  buildMarketplaceAgentCard,
  MARKETPLACE_A2A_ACTIONS,
  parseMarketplaceA2AMessage,
} from "../src/index.js";

describe("A2A protocol building blocks", () => {
  it("publishes a v1 Agent Card with marketplace skills", () => {
    const card = buildMarketplaceAgentCard({
      baseUrl: "https://a2a402.market",
      requireBearerAuth: true,
    }) as unknown as Record<string, unknown>;
    expect(card).not.toHaveProperty("url");
    expect(card).not.toHaveProperty("preferredTransport");
    expect(card.supportedInterfaces).toEqual([
      {
        url: "https://a2a402.market/a2a",
        protocolBinding: "JSONRPC",
        protocolVersion: A2A_PROTOCOL_VERSION,
      },
    ]);
    expect(card.skills).toHaveLength(MARKETPLACE_A2A_ACTIONS.length);
  });

  it("accepts structured data and JSON text action envelopes", () => {
    const dataMessage = {
      messageId: "message-1",
      parts: [
        {
          data: {
            action: "search_jobs",
            input: { tags: ["research"] },
          },
        },
      ],
    } as unknown as Message;
    expect(parseMarketplaceA2AMessage(dataMessage)).toEqual({
      action: "search_jobs",
      input: { tags: ["research"] },
    });
    const textMessage = {
      messageId: "message-2",
      parts: [
        {
          content: {
            $case: "text",
            value: JSON.stringify({
              action: "post_job",
              input: { budget_minor: "1000" },
              idempotency_key: "job-request-1",
            }),
          },
        },
      ],
    } as unknown as Message;
    expect(parseMarketplaceA2AMessage(textMessage)).toMatchObject({
      action: "post_job",
      idempotencyKey: "job-request-1",
    });
  });
});
