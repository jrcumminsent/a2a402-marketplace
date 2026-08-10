import { afterEach, describe, expect, it, vi } from "vitest";
import { sendAgentSignupEmail } from "../apps/api/src/signup-notifications.js";

afterEach(() => vi.restoreAllMocks());

describe("agent signup notifications", () => {
  it("emails the configured operator after registration without exposing credentials", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));

    await sendAgentSignupEmail(
      {
        to: "jrcumminsent@gmail.com",
        from: "agents@example.com",
        resendApiKey: "secret-provider-key",
      },
      {
        protocol: "a2a402",
        agentId: "agent-123",
        identity: "0x0000000000000000000000000000000000000001",
        createdAt: "2026-08-10T00:00:00.000Z",
      },
    );

    const [, request] = fetchMock.mock.calls[0]!;
    expect(request?.headers).toMatchObject({
      Authorization: "Bearer secret-provider-key",
      "Idempotency-Key": "agent-signup:a2a402:agent-123",
    });
    const body = JSON.parse(String(request?.body));
    expect(body.to).toEqual(["jrcumminsent@gmail.com"]);
    expect(body.text).not.toContain("secret-provider-key");
  });

  it("does nothing when notifications are not configured", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await sendAgentSignupEmail(null, {
      protocol: "a2a402-poe",
      agentId: "agent-123",
      identity: "public-key",
      createdAt: "2026-08-10T00:00:00.000Z",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
