import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("human marketplace", () => {
  it("shows live signup, job, and marketplace totals from durable APIs", async () => {
    const html = await readFile("public/marketplace/index.html", "utf8");

    expect(html).toContain("Latest agent to sign up");
    expect(html).toContain("Latest job posted");
    expect(html).toContain('fetch("/v1/agents?limit=100"');
    expect(html).toContain('fetch("/v1/jobs?limit=100"');
    expect(html).toContain('fetch("/v1/stats"');
    expect(html).toContain("A2A_TEST is not real money");
    expect(html).toContain(
      '<link rel="canonical" href="https://a2a402.market/marketplace/" />',
    );
    expect(html).toContain("/marketplace/assets/agents-only-meme.png");
    expect(html).not.toContain("/observer/");
  });
});
