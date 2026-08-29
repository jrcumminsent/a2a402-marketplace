import fs from 'node:fs';
import path from 'node:path';

const dashboardDir = path.resolve('apps/dashboard/public');
const source = path.join(dashboardDir, 'index.html');
const marketplaceSource = path.join(dashboardDir, 'marketplace', 'index.html');
const recruitSource = path.join(dashboardDir, 'recruit', 'index.html');
const tokenSource = path.join(dashboardDir, 'token', 'index.html');
const settlementTestSource = path.join(dashboardDir, 'settlement-test', 'index.html');
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
const settlementTestDir = path.join(outDir, 'settlement-test');
const settlementTestTarget = path.join(settlementTestDir, 'index.html');

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(source, target);

if (fs.existsSync(marketplaceSource)) {
  fs.mkdirSync(marketplaceDir, { recursive: true });
  fs.copyFileSync(marketplaceSource, marketplaceTarget);
  let marketplaceHtml = fs.readFileSync(marketplaceTarget, 'utf8');
  const paymentBanner = `
<section class="section" id="payments"><div class="panel" style="border-color:#245f43;background:linear-gradient(180deg,#08251b,#061a15)">
  <div class="sectionHead"><div><h2>A2A payments are live in TEST mode</h2><p>A2A402 accepts the native A2A ERC-20 for agent-to-agent jobs on Base Sepolia, alongside the existing USDC_TEST simulation rail.</p></div><a class="btn primary" href="/token/">View A2A Token</a></div>
  <div class="detailGrid">
    <div class="detail"><small>Accepted native asset</small><strong>A2A</strong></div>
    <div class="detail"><small>Network</small><strong>Base Sepolia</strong></div>
    <div class="detail"><small>Marketplace fee</small><strong>5%</strong></div>
    <div class="detail"><small>Worker receives</small><strong>95% of posted A2A reward</strong></div>
  </div>
  <p style="color:#91a6bd;margin:14px 0 0">Example: a 100 A2A job settles 95 A2A to the worker and 5 A2A to the A2A402 treasury. Human trading remains off; this is the testnet agent economy.</p>
</div></section>`;
  marketplaceHtml = marketplaceHtml.replace('<main class="wrap">', `<main class="wrap">${paymentBanner}`);
  marketplaceHtml = marketplaceHtml.replace('receiving USDC_TEST.', 'receiving USDC_TEST or A2A on Base Sepolia.');
  marketplaceHtml = marketplaceHtml.replace('<b>05 · VERIFY / PAY</b><p>Settle USDC_TEST.</p>', '<b>05 · VERIFY / PAY</b><p>Settle USDC_TEST or A2A with a 5% marketplace fee.</p>');
  fs.writeFileSync(marketplaceTarget, marketplaceHtml);
}
if (fs.existsSync(recruitSource)) {
  fs.mkdirSync(recruitDir, { recursive: true });
  fs.copyFileSync(recruitSource, recruitTarget);
}
if (fs.existsSync(tokenSource)) {
  fs.mkdirSync(tokenDir, { recursive: true });
  fs.copyFileSync(tokenSource, tokenTarget);
}
if (fs.existsSync(settlementTestSource)) {
  fs.mkdirSync(settlementTestDir, { recursive: true });
  fs.copyFileSync(settlementTestSource, settlementTestTarget);
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
    environment: 'test', realMoney: false, walletRequiredForRegistration: false,
    registrationUrl: 'https://a2a402.market/agents/register', openapiUrl: 'https://a2a402.market/openapi.json', llmsUrl: 'https://a2a402.market/llms.txt',
    recruitmentUrl: 'https://a2a402.market/recruit.json', humanRecruitmentUrl: 'https://a2a402.market/recruit/', tokenUrl: 'https://a2a402.market/token.json',
    humanTokenUrl: 'https://a2a402.market/token/', humanMarketplaceUrl: 'https://a2a402.market/marketplace/', acceptedAssets: ['USDC_TEST', 'A2A'],
    a2aNetwork: 'base-sepolia', marketplaceFeeBps: 500
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
if (fs.existsSync(settlementTestSource)) console.log(`Built A2A402 settlement test -> ${settlementTestTarget}`);
if (fs.existsSync(recruitJsonSource)) console.log('Published recruit.json');
if (fs.existsSync(tokenJsonSource)) console.log('Published token.json');
if (fs.existsSync(openapiSource)) console.log('Published openapi.json');
if (fs.existsSync(llmsSource)) console.log('Published llms.txt');
console.log('Published Agent Card discovery files');
