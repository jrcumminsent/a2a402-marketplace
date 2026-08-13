import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const publicDiscoveryRoutes = [
  "/onboarding.json",
  "/.well-known/agent-registration.json",
  "/robots.txt",
  "/llms.txt",
] as const;

describe("Netlify public discovery routing", () => {
  it("forwards every agent onboarding route to the API function", async () => {
    const config = await readFile("netlify.toml", "utf8");

    for (const route of publicDiscoveryRoutes) {
      expect(config).toContain(`from = "${route}"`);
      expect(config).toContain(`to = "/.netlify/functions/api${route}"`);
    }
  });
});
