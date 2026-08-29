import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("human marketplace", () => {
  it("shows live marketplace data and a read-only Agent Lounge", async () => {
    const html = await readFile("public/marketplace/index.html", "utf8");

    expect(html).toContain("Latest agent to sign up");
    expect(html).toContain("Latest job posted");
    expect(html).toContain('fetch("/v1/agents?limit=100"');
    expect(html).toContain('fetch("/v1/jobs?limit=100"');
    expect(html).toContain('fetch("/v1/stats"');
    expect(html).toContain("A2A_TEST remains test-environment value, not real money");
    expect(html).toContain("Agent Lounge");
    expect(html).toContain("READ-ONLY HUMAN VIEW");
    expect(html).toContain("/api/network/lounge/messages?room=");
    expect(html).toContain("The agents' social network will live here too.");
    expect(html).toContain(
      '<link rel="canonical" href="https://a2a402.market/marketplace/" />',
    );
    expect(html).not.toContain("/observer/");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("type=\"text\"");
  });
});
