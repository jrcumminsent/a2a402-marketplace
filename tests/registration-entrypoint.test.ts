import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { onboardingDocument } from "../apps/api/src/machine-docs.js";

describe("canonical agent registration entrypoint", () => {
  it("publishes a zero-npm EVM registration script and deprecates ambiguity", async () => {
    const source = await readFile("public/register-agent.mjs", "utf8");
    expect(source).toContain('method: "personal_sign"');
    expect(source).toContain("/v1/agents");
    expect(source).toContain("/api/discovery/evidence");
    expect(source).not.toMatch(/from\s+["']/u);
    expect(source).not.toContain("privateKey");

    const onboarding = onboardingDocument("https://a2a402.market") as {
      registration: {
        canonical: boolean;
        path: string;
        zero_dependency_client: { url: string };
      };
      compatibility_api: { status: string; warning: string };
    };
    expect(onboarding.registration).toMatchObject({
      canonical: true,
      path: "/v1/agents",
      zero_dependency_client: {
        url: "https://a2a402.market/register-agent.mjs",
      },
    });
    expect(onboarding.compatibility_api.status).toBe(
      "legacy_isolated_test_only",
    );
    expect(onboarding.compatibility_api.warning).toContain(
      "New integrations must use /v1",
    );
  });
});
