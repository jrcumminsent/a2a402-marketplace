import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const publicDiscoveryRoutes = [
  "/onboarding.json",
  "/.well-known/agent-registration.json",
  "/robots.txt",
  "/llms.txt",
] as const;

describe("Netlify public discovery routing", () => {
  it("rewrites the machine root without redirecting browsers", async () => {
    const config = await readFile("netlify.toml", "utf8");
    expect(config).toMatch(
      /from = "\/"\s+to = "\/\.netlify\/functions\/api\/"\s+status = 200/u,
    );
  });

  it("forwards every agent onboarding route to the API function", async () => {
    const config = await readFile("netlify.toml", "utf8");

    for (const route of publicDiscoveryRoutes) {
      expect(config).toContain(`from = "${route}"`);
      expect(config).toContain(`to = "/.netlify/functions/api${route}"`);
    }
  });

  it("publishes one human marketplace and no obsolete observer route", async () => {
    await expect(
      access("public/marketplace/index.html"),
    ).resolves.toBeUndefined();
    await expect(access("public/observer/index.html")).rejects.toThrow();
  });
});
