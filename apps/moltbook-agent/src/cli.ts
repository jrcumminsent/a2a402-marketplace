import { MoltbookBeaconAgent } from "./agent.js";
import { MoltbookClient } from "./client.js";
import { loadMoltbookConfig } from "./config.js";
import {
  FIRST_POST,
  MOLTBOOK_AGENT_NAME,
  MOLTBOOK_IDENTITY_PROMPT,
} from "./identity.js";
import {
  credentialApiKey,
  loadState,
  saveCredentials,
  saveState,
} from "./state.js";

async function keyFor(config: ReturnType<typeof loadMoltbookConfig>) {
  return config.apiKey ?? credentialApiKey(config.credentialsPath);
}

async function main(): Promise<void> {
  const config = loadMoltbookConfig();
  const [command, id] = process.argv.slice(2);
  if (!command)
    throw new Error(
      "Usage: pnpm moltbook-agent <register|dry-run|live|pending|approve|reject|identity|first-post>",
    );

  if (command === "identity") {
    process.stdout.write(`${MOLTBOOK_IDENTITY_PROMPT}\n`);
    return;
  }
  if (command === "first-post") {
    process.stdout.write(`${FIRST_POST}\n\nNO ACTION — PROPOSAL ONLY\n`);
    return;
  }
  if (command === "register") {
    if (!config.enabled)
      throw new Error(
        "Set MOLTBOOK_AGENT_ENABLED=true for the explicit registration command.",
      );
    if (await keyFor(config))
      throw new Error(
        "Moltbook credentials already exist; refusing duplicate registration.",
      );
    const registration = await new MoltbookClient(null).register(
      MOLTBOOK_AGENT_NAME,
      "Official A2A402-operated TEST marketplace beacon. Transparent distribution agent; not an independent discoverer or Genesis participant.",
    );
    await saveCredentials(config.credentialsPath, {
      apiKey: registration.apiKey,
      agentName: MOLTBOOK_AGENT_NAME,
      claimUrl: registration.claimUrl,
    });
    process.stdout.write(
      `MOLTBOOK AGENT CREATED\n\nHuman ownership verification required.\n\nClaim URL:\n${registration.claimUrl}\n\nCredentials were saved to the configured private credential file and were not printed. After verification, restart the agent.\n`,
    );
    return;
  }

  const apiKey = await keyFor(config);
  if (!apiKey)
    throw new Error(
      "MOLTBOOK_API_KEY or the private credentials file is required.",
    );
  const client = new MoltbookClient(apiKey);
  const agent = new MoltbookBeaconAgent(client, config);
  if (command === "dry-run" || command === "live") {
    await agent.run(command);
    return;
  }
  const state = await loadState(config.statePath);
  if (command === "pending") {
    process.stdout.write(`${JSON.stringify(state.pending, null, 2)}\n`);
    return;
  }
  if ((command === "approve" || command === "reject") && !id) {
    throw new Error(`${command} requires a pending action ID.`);
  }
  const index = state.pending.findIndex((action) => action.id === id);
  if (index < 0) throw new Error("Pending action was not found.");
  const [action] = state.pending.splice(index, 1);
  if (command === "approve") await agent.publish(action!, state);
  else state.rejectedPendingIds.push(id!);
  await saveState(config.statePath, state);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`${JSON.stringify({ level: "error", message })}\n`);
  process.exitCode = 1;
});
