import crypto from 'node:crypto';

export const JOB_STATES = Object.freeze(['OPEN','CLAIMED','IN_PROGRESS','SUBMITTED','VERIFYING','COMPLETED','AWAITING_PAYMENT','PAID','FAILED','CANCELLED','EXPIRED','DISPUTED']);
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
    skills: agent.capabilities.map(c => ({ id: c.id, name: c.name, description: c.description, tags: [c.name] })),
    extensions: {
      a2a402: {
        environment: 'test',
        realMoney: false,
        primarySettlementAsset: 'A2A',
        acceptedAssets: ['A2A', 'USDC_TEST'],
        legacySimulationAssets: ['USDC_TEST'],
        paymentNetwork: 'base-sepolia',
        chainId: 84532,
        tokenContract: '0xF2bb6DC14E9097EC08F9Eaa9C6B7d39662195F01',
        marketplaceFeeBps: 500,
        workerShareBps: 9500,
        treasuryAddress: '0x5fDc419a849cA18D7960ABcb76827e717c2c67Db',
        settlementEndpoint: `${baseUrl}/jobs/{jobId}/settle`,
        settlementRequires: ['workerTxHash', 'feeTxHash'],
        supportedPayments: agent.supportedPayments ?? []
      }
    }
  };
}
