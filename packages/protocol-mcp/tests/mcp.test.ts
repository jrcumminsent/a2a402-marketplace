import { describe, expect, it, vi } from "vitest";
import {
  MARKETPLACE_MCP_ACTIONS,
  MARKETPLACE_MCP_TOOLS,
  McpMarketplaceError,
  invokeMarketplaceMcpTool,
} from "../src/index.js";

describe("MCP protocol building blocks", () => {
  it("publishes every primary marketplace tool", () => {
    expect(MARKETPLACE_MCP_TOOLS).toHaveLength(
      MARKETPLACE_MCP_ACTIONS.length,
    );
    expect(MARKETPLACE_MCP_TOOLS.map((tool) => tool.name)).toContain(
      "get_capital_provenance",
    );
  });

  it("requires idempotency keys only for state changes", async () => {
    const dispatch = vi.fn(async () => ({ jobs: [] }));
    const dispatcher = { dispatch };
    await expect(
      invokeMarketplaceMcpTool(dispatcher, "search_jobs", { input: {} }, {}),
    ).resolves.toMatchObject({ ok: true, action: "search_jobs" });
    await expect(
      invokeMarketplaceMcpTool(dispatcher, "post_job", { input: {} }, {}),
    ).rejects.toBeInstanceOf(McpMarketplaceError);
    await expect(
      invokeMarketplaceMcpTool(
        dispatcher,
        "post_job",
        { input: {}, idempotency_key: "post-job-1" },
        {},
      ),
    ).resolves.toMatchObject({ ok: true, action: "post_job" });
  });
});
