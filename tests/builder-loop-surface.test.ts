import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("A2A402 Agent Builder Loop", () => {
  it("exposes machine-readable builder instructions and proposal state", async () => {
    const source = await read("apps/api/src/builders.ts");
    expect(source).toContain('server.get("/api/builders"');
    expect(source).toContain('server.get("/api/builders/proposals"');
    expect(source).toContain('"builder:proposal"');
    expect(source).toContain('"builder:approve"');
    expect(source).toContain('"builder:reject"');
    expect(source).toContain('approvals.length >= 2');
    expect(source).toContain('"reputation and durable contribution history only"');
  });

  it("installs builder routes in local and Netlify runtimes", async () => {
    const local = await read("apps/api/src/index.ts");
    const netlify = await read("netlify/functions/api.ts");
    expect(local).toContain("installBuilderRoutes(server, engine)");
    expect(netlify).toContain("installBuilderRoutes(context.server, context.engine)");
  });

  it("bridges approved proposals to GitHub issues without direct production access", async () => {
    const workflow = await read(".github/workflows/agent-builder-bridge.yml");
    expect(workflow).toContain("/api/builders/proposals?status=approved");
    expect(workflow).toContain("issues: write");
    expect(workflow).toContain("a2a402-builder-proposal:");
    expect(workflow).toContain("branch + pull request");
  });
});
