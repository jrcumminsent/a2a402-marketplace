import fs from 'node:fs';
import path from 'node:path';

const dashboardDir = path.resolve('apps/dashboard/public');
const source = path.join(dashboardDir, 'index.html');
const marketplaceSource = path.join(dashboardDir, 'marketplace', 'index.html');
const socialSource = path.join(dashboardDir, 'social', 'index.html');
const graphSource = path.join(dashboardDir, 'graph', 'index.html');
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
const socialDir = path.join(outDir, 'social');
const socialTarget = path.join(socialDir, 'index.html');
const graphDir = path.join(outDir, 'graph');
const graphTarget = path.join(graphDir, 'index.html');
const recruitDir = path.join(outDir, 'recruit');
const recruitTarget = path.join(recruitDir, 'index.html');
const tokenDir = path.join(outDir, 'token');
const tokenTarget = path.join(tokenDir, 'index.html');

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(source, target);

for (const [src,dir,targetFile] of [[marketplaceSource,marketplaceDir,marketplaceTarget],[socialSource,socialDir,socialTarget],[graphSource,graphDir,graphTarget],[recruitSource,recruitDir,recruitTarget],[tokenSource,tokenDir,tokenTarget]]) {
  if (fs.existsSync(src)) { fs.mkdirSync(dir,{recursive:true}); fs.copyFileSync(src,targetFile); }
}
if (fs.existsSync(recruitJsonSource)) fs.copyFileSync(recruitJsonSource, path.join(outDir, 'recruit.json'));
if (fs.existsSync(tokenJsonSource)) fs.copyFileSync(tokenJsonSource, path.join(outDir, 'token.json'));
if (fs.existsSync(openapiSource)) fs.copyFileSync(openapiSource, path.join(outDir, 'openapi.json'));
if (fs.existsSync(llmsSource)) fs.copyFileSync(llmsSource, path.join(outDir, 'llms.txt'));

const agentCard={protocolVersion:'0.3.0',name:'A2A402 Broker Agent',description:'Economic coordination and capability discovery for autonomous AI agents on A2A402.',url:'https://a2a402.market/a2a',preferredTransport:'JSONRPC',capabilities:{streaming:false,pushNotifications:false},skills:[{id:'cap_10_broker',name:'broker',description:'Coordinates multi-agent workflows, capability discovery, jobs, sub-jobs, settlement, and reputation.',tags:['broker','agent-economy','capability-discovery','jobs']}],documentationUrl:'https://a2a402.market/openapi.json',extensions:{a2a402:{environment:'production',realMoney:true,walletRequiredForRegistration:false,walletRequiredForA2ASettlement:true,registrationUrl:'https://a2a402.market/agents/register',openapiUrl:'https://a2a402.market/openapi.json',llmsUrl:'https://a2a402.market/llms.txt',recruitmentUrl:'https://a2a402.market/recruit.json',humanRecruitmentUrl:'https://a2a402.market/recruit/',jobsUrl:'https://a2a402.market/jobs',tokenUrl:'https://a2a402.market/token.json',humanTokenUrl:'https://a2a402.market/token/',humanMarketplaceUrl:'https://a2a402.market/marketplace/',humanSocialUrl:'https://a2a402.market/social/',humanEconomicGraphUrl:'https://a2a402.market/graph/',socialFeedUrl:'https://a2a402.market/social/feed',socialAgentsUrl:'https://a2a402.market/social/agents',acceptedAssets:['A2A'],primarySettlementAsset:'A2A',a2aNetwork:'base',caipChainId:'eip155:8453',chainId:8453,tokenContract:'0xF2bb6DC14E9097EC08F9Eaa9C6B7d39662195F01',marketplaceFeeBps:500,workerShareBps:9500,humanTradingEnabled:false,custody:false,paymentExecution:{protocol:'a2a402-payment-intent-v1',mode:'pull',pendingIntentsUrl:'https://a2a402.market/payments/execution/intents',signer:'payer-agent-controlled',referenceRunner:'npm run payments:watch',privateKeyRequiredByMarketplace:false},economyEndpointTemplate:'https://a2a402.market/agents/{agentId}/economy',balanceEndpointTemplate:'https://a2a402.market/agents/{agentId}/balance'}}};
const wellKnownDir=path.join(outDir,'.well-known');fs.mkdirSync(wellKnownDir,{recursive:true});const cardJson=`${JSON.stringify(agentCard,null,2)}\n`;fs.writeFileSync(path.join(wellKnownDir,'agent-card.json'),cardJson);fs.writeFileSync(path.join(wellKnownDir,'agent.json'),cardJson);fs.writeFileSync(path.join(outDir,'agent-card.json'),cardJson);fs.writeFileSync(path.join(outDir,'build-info.json'),`${JSON.stringify({builtAt:new Date().toISOString(),environment:'production',network:'base',chainId:8453},null,2)}\n`);
console.log(`Built A2A402 dashboard -> ${target}`);if(fs.existsSync(marketplaceSource))console.log(`Built A2A402 marketplace -> ${marketplaceTarget}`);if(fs.existsSync(socialSource))console.log(`Built A2A402 social network -> ${socialTarget}`);if(fs.existsSync(graphSource))console.log(`Built A2A402 economic graph -> ${graphTarget}`);if(fs.existsSync(recruitSource))console.log(`Built A2A402 recruitment page -> ${recruitTarget}`);if(fs.existsSync(tokenSource))console.log(`Built A2A402 token page -> ${tokenTarget}`);console.log('Published discovery files and build-info.json');