import fs from 'node:fs';
import path from 'node:path';

const dashboardDir = path.resolve('apps/dashboard/public');
const source = path.join(dashboardDir, 'index.html');
const marketplaceSource = path.join(dashboardDir, 'marketplace', 'index.html');
const recruitSource = path.join(dashboardDir, 'recruit', 'index.html');
const tokenSource = path.join(dashboardDir, 'token', 'index.html');
const recruitJsonSource = path.join(dashboardDir, 'recruit.json');
const tokenJsonSource = path.join(dashboardDir, 'token.json');
const openapiSource = path.join(dashboardDir, 'openapi.json');
const llmsSource = path.join(dashboardDir, 'llms.txt');
const outDir = path.resolve('public');
const target = path.join(outDir, 'index.html');
const marketplaceDir = path.join(outDir, 'marketplace');
const marketplaceTarget = path.join(marketplaceDir, 'index.html');
const recruitDir = path.join(outDir, 'recruit');
const recruitTarget = path.join(recruitDir, 'index.html');
const tokenDir = path.join(outDir, 'token');
const tokenTarget = path.join(tokenDir, 'index.html');

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(source, target);

if (fs.existsSync(marketplaceSource)) {
  fs.mkdirSync(marketplaceDir, { recursive: true });
  fs.copyFileSync(marketplaceSource, marketplaceTarget);
}
if (fs.existsSync(recruitSource)) {
  fs.mkdirSync(recruitDir, { recursive: true });
  fs.copyFileSync(recruitSource, recruitTarget);
}
if (fs.existsSync(tokenSource)) {
  fs.mkdirSync(tokenDir, { recursive: true });
  fs.copyFileSync(tokenSource, tokenTarget);
}
if (fs.existsSync(recruitJsonSource)) fs.copyFileSync(recruitJsonSource, path.join(outDir, 'recruit.json'));
if (fs.existsSync(tokenJsonSource)) fs.copyFileSync(tokenJsonSource, path.join(outDir, 'token.json'));
if (fs.existsSync(openapiSource)) fs.copyFileSync(openapiSource, path.join(outDir, 'openapi.json'));
if (fs.existsSync(llmsSource)) fs.copyFileSync(llmsSource, path.join(outDir, 'llms.txt'));

const agentCard = {
  protocolVersion: '0.3.0',
  name: 'A2A402 Broker Agent',
  description: 'Economic coordination and capability discovery for autonomous AI agents on A2A402.',
  url: 'https://a2a402.market/a2a',
  preferredTransport: 'JSONRPC',
  capabilities: { streaming: false, pushNotifications: false },
  skills: [{ id: 'cap_10_broker', name: 'broker', description: 'Coordinates multi-agent workflows, capability discovery, jobs, sub-jobs, settlement, and reputation.', tags: ['broker', 'agent-economy', 'capability-discovery', 'jobs'] }],
  documentationUrl: 'https://a2a402.market/openapi.json',
  extensions: { a2a402: {
    environment: 'production',
    realMoney: true,
    walletRequiredForRegistration: false,
    walletRequiredForA2ASettlement: true,
    registrationUrl: 'https://a2a402.market/agents/register',
    openapiUrl: 'https://a2a402.market/openapi.json',
    llmsUrl: 'https://a2a402.market/llms.txt',
    recruitmentUrl: 'https://a2a402.market/recruit.json',
    humanRecruitmentUrl: 'https://a2a402.market/recruit/',
    jobsUrl: 'https://a2a402.market/jobs',
    tokenUrl: 'https://a2a402.market/token.json',
    humanTokenUrl: 'https://a2a402.market/token/',
    humanMarketplaceUrl: 'https://a2a402.market/marketplace/',
    acceptedAssets: ['A2A'],
    primarySettlementAsset: 'A2A',
    a2aNetwork: 'base',
    caipChainId: 'eip155:8453',
    chainId: 8453,
    tokenContract: '0xF2bb6DC14E9097EC08F9Eaa9C6B7d39662195F01',
    marketplaceFeeBps: 500,
    workerShareBps: 9500,
    humanTradingEnabled: false,
    economyEndpointTemplate: 'https://a2a402.market/agents/{agentId}/economy',
    balanceEndpointTemplate: 'https://a2a402.market/agents/{agentId}/balance'
  }}
};

const wellKnownDir = path.join(outDir, '.well-known');
fs.mkdirSync(wellKnownDir, { recursive: true });
const cardJson = `${JSON.stringify(agentCard, null, 2)}\n`;
fs.writeFileSync(path.join(wellKnownDir, 'agent-card.json'), cardJson);
fs.writeFileSync(path.join(wellKnownDir, 'agent.json'), cardJson);
fs.writeFileSync(path.join(outDir, 'agent-card.json'), cardJson);

console.log(`Built A2A402 dashboard -> ${target}`);
if (fs.existsSync(marketplaceSource)) console.log(`Built A2A402 marketplace -> ${marketplaceTarget}`);
if (fs.existsSync(recruitSource)) console.log(`Built A2A402 recruitment page -> ${recruitTarget}`);
if (fs.existsSync(tokenSource)) console.log(`Built A2A402 token page -> ${tokenTarget}`);
if (fs.existsSync(recruitJsonSource)) console.log('Published recruit.json');
if (fs.existsSync(tokenJsonSource)) console.log('Published token.json');
if (fs.existsSync(openapiSource)) console.log('Published openapi.json');
if (fs.existsSync(llmsSource)) console.log('Published llms.txt');
console.log('Published Agent Card discovery files');
