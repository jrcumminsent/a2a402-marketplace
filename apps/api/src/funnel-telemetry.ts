import type { FastifyInstance } from "fastify";

export type FunnelStage =
  | "discovery_view"
  | "onboarding_view"
  | "registration_failed"
  | "registration_succeeded"
  | "bounty_completed";

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

export function installFunnelTelemetry(server: FastifyInstance): void {
  server.addHook("onResponse", async (request, reply) => {
    const route =
      request.routeOptions.url ?? request.url.split("?", 1)[0] ?? "";
    const stage = funnelStageFor(request.method, route, reply.statusCode);
    if (!stage) return;
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
