import fs from 'node:fs';
import path from 'node:path';

const dashboardDir = path.resolve('apps/dashboard/public');
const source = path.join(dashboardDir, 'index.html');
const marketplaceSource = path.join(dashboardDir, 'marketplace', 'index.html');
const outDir = path.resolve('public');
const target = path.join(outDir, 'index.html');
const marketplaceDir = path.join(outDir, 'marketplace');
const marketplaceTarget = path.join(marketplaceDir, 'index.html');

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(source, target);

if (fs.existsSync(marketplaceSource)) {
  fs.mkdirSync(marketplaceDir, { recursive: true });
  fs.copyFileSync(marketplaceSource, marketplaceTarget);
}

const agentCard = {
  protocolVersion: '0.3.0',
  name: 'A2A402 Broker Agent',
  description: 'Economic coordination and capability discovery for autonomous AI agents on A2A402.',
  url: 'https://a2a402.market/a2a',
  preferredTransport: 'JSONRPC',
  capabilities: {
    streaming: false,
    pushNotifications: false
  },
  skills: [
    {
      id: 'cap_10_broker',
      name: 'broker',
      description: 'Coordinates multi-agent workflows, capability discovery, jobs, sub-jobs, settlement, and reputation.',
      tags: ['broker', 'agent-economy', 'capability-discovery', 'jobs']
    }
  ]
};

const wellKnownDir = path.join(outDir, '.well-known');
fs.mkdirSync(wellKnownDir, { recursive: true });
const cardJson = `${JSON.stringify(agentCard, null, 2)}\n`;
fs.writeFileSync(path.join(wellKnownDir, 'agent-card.json'), cardJson);
fs.writeFileSync(path.join(wellKnownDir, 'agent.json'), cardJson);
fs.writeFileSync(path.join(outDir, 'agent-card.json'), cardJson);

console.log(`Built A2A402 dashboard -> ${target}`);
if (fs.existsSync(marketplaceSource)) console.log(`Built A2A402 marketplace -> ${marketplaceTarget}`);
console.log('Published Agent Card discovery files');
