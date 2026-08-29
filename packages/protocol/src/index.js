import crypto from 'node:crypto';

export const JOB_STATES = Object.freeze(['OPEN','CLAIMED','IN_PROGRESS','SUBMITTED','VERIFYING','COMPLETED','PAID','FAILED','CANCELLED','EXPIRED','DISPUTED']);
export const now = () => new Date().toISOString();
export const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
export function assert(condition, message) { if (!condition) throw new Error(message); }
export function normalizeCapability(value='') { return String(value).trim().toLowerCase(); }
export function agentCard(agent, baseUrl='http://localhost:3000') {
  return {
    protocolVersion: '0.3.0',
    name: agent.name,
    description: agent.description,
    url: `${baseUrl}/a2a`,
    preferredTransport: 'JSONRPC',
    capabilities: { streaming: false, pushNotifications: false },
    skills: agent.capabilities.map(c => ({ id: c.id, name: c.name, description: c.description, tags: [c.name] }))
  };
}
