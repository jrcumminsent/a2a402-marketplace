import { describe, expect, it, vi } from "vitest";
import { fetchAgentCardSafely, isPrivateNetworkAddress } from "@a2a402/shared";

const validCard = {
  name: "Remote test agent",
  supportedInterfaces: [
    {
      url: "https://agent.example/a2a",
      protocolBinding: "JSONRPC",
      protocolVersion: "1.0",
    },
  ],
};

describe("Agent Card SSRF and response hardening", () => {
  it("blocks IPv4-mapped, site-local, multicast, and metadata addresses", () => {
    expect(isPrivateNetworkAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateNetworkAddress("fec0::1")).toBe(true);
    expect(isPrivateNetworkAddress("ff02::1")).toBe(true);
    expect(isPrivateNetworkAddress("169.254.169.254")).toBe(true);
    expect(isPrivateNetworkAddress("93.184.216.34")).toBe(false);
  });

  it("rejects a hostname resolving to a private address before fetch", async () => {
    const fetchImplementation = vi.fn();
    await expect(
      fetchAgentCardSafely("https://agent.example/card.json", {
        resolveHostname: (async () => [
          { address: "127.0.0.1", family: 4 },
        ]) as never,
        fetchImplementation,
      }),
    ).rejects.toMatchObject({
      code: "URL_PRIVATE_NETWORK",
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("revalidates every redirect target and blocks a redirect to metadata IP space", async () => {
    const fetchImplementation = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/latest/meta-data" },
        }),
    );
    await expect(
      fetchAgentCardSafely("https://agent.example/card.json", {
        resolveHostname: (async () => [
          { address: "93.184.216.34", family: 4 },
        ]) as never,
        fetchImplementation,
      }),
    ).rejects.toMatchObject({
      code: "URL_PRIVATE_NETWORK",
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("rejects declared and streamed responses over the size limit", async () => {
    const resolveHostname = (async () => [
      { address: "93.184.216.34", family: 4 },
    ]) as never;
    await expect(
      fetchAgentCardSafely("https://agent.example/card.json", {
        maximumBytes: 32,
        resolveHostname,
        fetchImplementation: (async () =>
          new Response(JSON.stringify(validCard), {
            status: 200,
            headers: {
              "content-type": "application/json",
              "content-length": "1000",
            },
          })) as never,
      }),
    ).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
    });
  });

  it("accepts a bounded A2A 1.0 Agent Card and returns its digest", async () => {
    const result = await fetchAgentCardSafely(
      "https://agent.example/.well-known/agent-card.json",
      {
        resolveHostname: (async () => [
          { address: "93.184.216.34", family: 4 },
        ]) as never,
        fetchImplementation: (async () =>
          new Response(JSON.stringify(validCard), {
            status: 200,
            headers: { "content-type": "application/json" },
          })) as never,
      },
    );
    expect(result.card).toEqual(validCard);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.redirects).toBe(0);
  });
});
