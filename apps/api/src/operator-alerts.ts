import type { AgentSignupEmailConfig } from "./signup-notifications.js";
import {
  deliverWebhookSafely,
  type JsonValue,
  type WebhookDeliveryResult,
} from "@a2a402/shared";

export type OperatorAlertKind =
  | "api_crash"
  | "database_failure"
  | "storage_failure"
  | "resend_delivery_failure";

export interface OperatorAlert {
  kind: OperatorAlertKind;
  summary: string;
  requestId?: string;
  details?: Record<string, unknown>;
}

export function createOperatorAlerter(config: {
  webhookUrl: string | null;
  email: AgentSignupEmailConfig | null;
  cooldownMs?: number;
  deliverWebhook?: (
    url: string,
    payload: JsonValue,
    headers: Record<string, string>,
  ) => Promise<WebhookDeliveryResult>;
}): (alert: OperatorAlert) => Promise<void> {
  const sentAt = new Map<OperatorAlertKind, number>();
  const cooldownMs = config.cooldownMs ?? 5 * 60_000;
  return async (alert) => {
    const now = Date.now();
    if (now - (sentAt.get(alert.kind) ?? 0) < cooldownMs) return;
    sentAt.set(alert.kind, now);
    const payload = {
      event: "marketplace.operator_alert",
      severity: "error",
      kind: alert.kind,
      summary: alert.summary.slice(0, 500),
      request_id: alert.requestId ?? null,
      details: alert.details ?? {},
      occurred_at: new Date(now).toISOString(),
    };
    const deliveries: Promise<unknown>[] = [];
    if (config.webhookUrl) {
      deliveries.push(
        (config.deliverWebhook ?? deliverWebhookSafely)(
          config.webhookUrl,
          payload as JsonValue,
          {},
        ),
      );
    }
    if (config.email && alert.kind !== "resend_delivery_failure") {
      deliveries.push(
        fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.email.resendApiKey}`,
            "content-type": "application/json",
            "user-agent": "a2a402.market/0.1",
          },
          body: JSON.stringify({
            from: config.email.from,
            to: [config.email.to],
            subject: `[A2A402 alert] ${alert.kind}`,
            text: JSON.stringify(payload, null, 2),
          }),
          signal: AbortSignal.timeout(5_000),
        }).then((response) => {
          if (!response.ok)
            throw new Error(`Alert email returned HTTP ${response.status}.`);
        }),
      );
    }
    if (deliveries.length === 0) return;
    const outcomes = await Promise.allSettled(deliveries);
    if (outcomes.every((outcome) => outcome.status === "rejected")) {
      throw new Error("All configured operator alert channels failed.");
    }
  };
}
