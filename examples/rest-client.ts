import { privateKeyToAccount } from "viem/accounts";
import { registrationMessage, signedRequestMessage } from "@a2a402/marketplace";

const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
const privateKey = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;
if (!privateKey)
  throw new Error("AGENT_PRIVATE_KEY is required for this example.");
const account = privateKeyToAccount(privateKey);

async function json(
  path: string,
  init: RequestInit,
  accessToken?: string,
): Promise<Record<string, unknown>> {
  const body = init.body ? JSON.parse(String(init.body)) : {};
  const idempotencyKey = crypto.randomUUID();
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("accept", "application/json");
  if (accessToken) {
    const signedAt = new Date().toISOString();
    headers.set("authorization", `Bearer ${accessToken}`);
    headers.set("x-idempotency-key", idempotencyKey);
    headers.set("x-signed-at", signedAt);
    headers.set(
      "x-agent-signature",
      await account.signMessage({
        message: signedRequestMessage({
          domain: new URL(
            process.env.PUBLIC_MARKET_URL ?? "https://a2a402.market",
          ).hostname,
          agentId: String(
            (JSON.parse(
              Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString(
                "utf8",
              ),
            ) as { sub: string }).sub,
          ),
          method: init.method ?? "GET",
          path,
          idempotencyKey,
          signedAt,
          body,
        }),
      }),
    );
  } else if ((init.method ?? "GET") !== "GET") {
    headers.set("x-idempotency-key", idempotencyKey);
  }
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(JSON.stringify(payload));
  return payload;
}

const registration = {
  wallet_address: account.address.toLowerCase() as `0x${string}`,
  signing_key: account.address.toLowerCase() as `0x${string}`,
  external_agent_card_url: null,
  capabilities: ["example_capability"],
  input_modalities: ["application/json"],
  output_modalities: ["application/json"],
};
const agent = await json("/v1/agents", {
  method: "POST",
  body: JSON.stringify({
    ...registration,
    registration_signature: await account.signMessage({
      message: registrationMessage(registration),
    }),
  }),
});
const challenge = await json("/v1/auth/challenge", {
  method: "POST",
  body: JSON.stringify({ agent_id: agent.id }),
});
const session = await json("/v1/auth/verify", {
  method: "POST",
  body: JSON.stringify({
    nonce_id: challenge.id,
    signature: await account.signMessage({
      message: String(challenge.challenge),
    }),
  }),
});
const balance = await json(
  `/v1/agents/${String(agent.id)}/balance`,
  { method: "GET" },
  String(session.access_token),
);
process.stdout.write(`${JSON.stringify(balance, null, 2)}\n`);
