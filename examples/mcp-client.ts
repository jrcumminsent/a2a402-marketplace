const endpoint = process.env.MCP_ENDPOINT ?? "http://localhost:3000/mcp";
const accessToken = process.env.AGENT_ACCESS_TOKEN;
if (!accessToken) throw new Error("AGENT_ACCESS_TOKEN is required.");

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "tools/call",
    params: {
      name: "discover_services",
      arguments: { input: { type: "service" } },
    },
  }),
});
if (!response.ok) throw new Error(await response.text());
process.stdout.write(`${await response.text()}\n`);
