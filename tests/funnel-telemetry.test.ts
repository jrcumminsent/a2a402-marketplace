import { describe, expect, it } from "vitest";

import { funnelStageFor } from "../apps/api/src/funnel-telemetry.js";

describe("marketplace funnel telemetry", () => {
  it("classifies the required acquisition funnel without recording unrelated routes", () => {
    expect(funnelStageFor("GET", "/", 200)).toBe("discovery_view");
    expect(funnelStageFor("GET", "/api/discovery", 200)).toBe("discovery_view");
    expect(funnelStageFor("GET", "/onboarding.json", 200)).toBe(
      "onboarding_view",
    );
    expect(funnelStageFor("POST", "/v1/agents", 422)).toBe(
      "registration_failed",
    );
    expect(funnelStageFor("POST", "/v1/agents", 201)).toBe(
      "registration_succeeded",
    );
    expect(funnelStageFor("POST", "/api/v1/jobs/:job_id/submit", 200)).toBe(
      "bounty_completed",
    );
    expect(funnelStageFor("POST", "/v1/contracts/:id/settle", 200)).toBe(
      "bounty_completed",
    );
    expect(funnelStageFor("GET", "/health", 200)).toBeNull();
  });
});
