import type { FastifyInstance } from "fastify";
import type { OperationalMetricName } from "@a2a402/marketplace";

export type FunnelStage =
  | "discovery_view"
  | "onboarding_view"
  | "registration_failed"
  | "registration_succeeded"
  | "bid_submitted"
  | "bounty_completed";

const METRIC_BY_STAGE: Record<FunnelStage, OperationalMetricName> = {
  discovery_view: "discovery_visits",
  onboarding_view: "onboarding_views",
  registration_failed: "failed_registrations",
  registration_succeeded: "successful_registrations",
  bid_submitted: "bids",
  bounty_completed: "completed_bounties",
};

export function funnelStageFor(
  method: string,
  route: string,
  statusCode: number,
): FunnelStage | null {
  if (method === "GET" && ["/", "/api/discovery"].includes(route)) {
    return "discovery_view";
  }
  if (
    method === "GET" &&
    ["/onboarding.json", "/.well-known/agent-registration.json"].includes(route)
  ) {
    return "onboarding_view";
  }
  if (method === "POST" && ["/v1/agents", "/api/v1/agents"].includes(route)) {
    return statusCode >= 200 && statusCode < 300
      ? "registration_succeeded"
      : "registration_failed";
  }
  if (
    method === "POST" &&
    route === "/v1/jobs/:id/bids" &&
    statusCode >= 200 &&
    statusCode < 300
  ) {
    return "bid_submitted";
  }
  if (
    method === "POST" &&
    ["/api/v1/jobs/:job_id/submit", "/v1/contracts/:id/settle"].includes(
      route,
    ) &&
    statusCode >= 200 &&
    statusCode < 300
  ) {
    return "bounty_completed";
  }
  return null;
}

export function installFunnelTelemetry(
  server: FastifyInstance,
  record?: (metric: OperationalMetricName, requestId: string) => Promise<void>,
): void {
  server.addHook("onResponse", async (request, reply) => {
    const route =
      request.routeOptions.url ?? request.url.split("?", 1)[0] ?? "";
    const stage = funnelStageFor(request.method, route, reply.statusCode);
    if (!stage) return;
    await record?.(METRIC_BY_STAGE[stage], request.id).catch(
      (error: unknown) => {
        request.log.warn(
          {
            error:
              error instanceof Error ? error.message : "metric_write_failed",
          },
          "Marketplace funnel metric could not be persisted.",
        );
      },
    );
    request.log.info(
      {
        event: "marketplace.funnel",
        stage,
        route,
        status_code: reply.statusCode,
        request_id: request.id,
        user_agent: request.headers["user-agent"]?.slice(0, 160) ?? null,
      },
      "Marketplace funnel event.",
    );
  });
}
