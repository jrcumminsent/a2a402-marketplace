import { afterEach, describe, expect, it, vi } from "vitest";

import { createOperatorAlerter } from "../apps/api/src/operator-alerts.js";

afterEach(() => vi.restoreAllMocks());

describe("operator alerts", () => {
  it("delivers dependency failures to webhook and email with bounded details", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));
    const deliverWebhook = vi.fn().mockResolvedValue({
      url: "https://alerts.example.test/a2a402",
      status: 202,
      deliveredAt: "2026-08-22T00:00:00.000Z",
    });
    const alert = createOperatorAlerter({
      webhookUrl: "https://alerts.example.test/a2a402",
      email: {
        to: "operator@example.test",
        from: "alerts@example.test",
        resendApiKey: "provider-secret",
      },
      cooldownMs: 0,
      deliverWebhook,
    });
    await alert({
      kind: "database_failure",
      summary: "Database unavailable",
      requestId: "request-1",
    });
    expect(deliverWebhook).toHaveBeenCalledTimes(1);
    expect(deliverWebhook.mock.calls[0]?.[0]).toBe(
      "https://alerts.example.test/a2a402",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).not.toContain(
      "provider-secret",
    );
  });

  it("does not use Resend to report a Resend delivery failure", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));
    const deliverWebhook = vi.fn().mockResolvedValue({
      url: "https://alerts.example.test/a2a402",
      status: 202,
      deliveredAt: "2026-08-22T00:00:00.000Z",
    });
    const alert = createOperatorAlerter({
      webhookUrl: "https://alerts.example.test/a2a402",
      email: {
        to: "operator@example.test",
        from: "alerts@example.test",
        resendApiKey: "provider-secret",
      },
      cooldownMs: 0,
      deliverWebhook,
    });
    await alert({
      kind: "resend_delivery_failure",
      summary: "Signup email failed",
    });
    expect(deliverWebhook).toHaveBeenCalledTimes(1);
    expect(deliverWebhook.mock.calls[0]?.[0]).toBe(
      "https://alerts.example.test/a2a402",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
