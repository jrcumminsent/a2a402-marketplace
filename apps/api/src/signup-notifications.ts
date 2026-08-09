export interface AgentSignupEmailConfig {
  to: string;
  from: string;
  resendApiKey: string;
}

export interface AgentSignupNotice {
  protocol: "a2a402" | "a2a402-poe";
  agentId: string;
  identity: string;
  createdAt: string;
}

/**
 * Sends a transactional notification only after an agent was registered.
 * The caller deliberately catches errors: email availability must never undo
 * a successful, durable marketplace registration.
 */
export async function sendAgentSignupEmail(
  config: AgentSignupEmailConfig | null,
  notice: AgentSignupNotice,
): Promise<void> {
  if (!config) return;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "a2a402.market/0.1",
      "Idempotency-Key": `agent-signup:${notice.protocol}:${notice.agentId}`,
    },
    body: JSON.stringify({
      from: config.from,
      to: [config.to],
      subject: `New agent registered: ${notice.agentId}`,
      text: [
        "A new agent registered with a2a402.market.",
        `Protocol: ${notice.protocol}`,
        `Agent ID: ${notice.agentId}`,
        `Identity: ${notice.identity}`,
        `Registered: ${notice.createdAt}`,
      ].join("\n"),
    }),
  });

  if (!response.ok) {
    throw new Error(`Agent signup email provider returned HTTP ${response.status}.`);
  }
}
