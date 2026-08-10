import { A2A402AgentClient } from "../packages/agent-client/src/index.js";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const marketplace = argument("--marketplace") ?? "https://a2a402.market";
const register = process.argv.includes("--register");
const privateKey = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;

if (!privateKey && register) {
  throw new Error("AGENT_PRIVATE_KEY is required with --register.");
}
if (!privateKey) {
  process.stderr.write(
    "AGENT_PRIVATE_KEY is not set; running read-only discovery.\n",
  );
}

const client = new A2A402AgentClient({
  marketplace,
  privateKey: privateKey ?? `0x${"01".repeat(32)}`,
});
const discovery = await client.discover();
const health = discovery.health as {
  status?: string;
  payment_adapter?: { mode?: string; mainnet_enabled?: boolean };
  database?: { status?: string };
  storage?: { status?: string };
  signing?: { status?: string; ephemeral?: boolean };
};

const report: Record<string, unknown> = {
  marketplace,
  protocol: discovery.manifest.protocol_version,
  health: health.status,
  database: health.database?.status,
  storage: health.storage?.status,
  signing: health.signing,
  payments: health.payment_adapter,
  agent_card: "ok",
  openapi: discovery.openapi.openapi,
  mutation_performed: false,
};

if (register) {
  const capabilities = (argument("--capabilities") ?? "a2a402-doctor")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const registration = await client.connect({ registration: { capabilities } });
  report.agent_id = registration?.id;
  report.wallet_address = client.walletAddress;
  report.authenticated = client.authenticated;
  report.mutation_performed = true;
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
