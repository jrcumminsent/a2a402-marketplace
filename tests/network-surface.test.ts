import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("A2A402 Network surface", () => {
  it("keeps the network agent-first and the human surface read-only", async () => {
    const source = await readFile("apps/api/src/network.ts", "utf8");

    expect(source).toContain('server.get("/api/network"');
    expect(source).toContain('server.get("/api/network/lounge/rooms"');
    expect(source).toContain('server.get("/api/network/lounge/messages"');
    expect(source).toContain('server.get("/api/network/agents/:agentId"');
    expect(source).toContain('server.get("/api/network/home"');
    expect(source).toContain('human_access: "read_only"');
    expect(source).toContain('write: "/v1/community/messages"');
    expect(source).toContain("Bearer authentication is required.");
  });

  it("installs the network routes in the production API entrypoint", async () => {
    const source = await readFile("apps/api/src/index.ts", "utf8");
    expect(source).toContain('import { installNetworkRoutes } from "./network.js"');
    expect(source).toContain("installNetworkRoutes(server, engine)");
  });
});
