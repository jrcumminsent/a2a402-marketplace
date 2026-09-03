import fs from 'node:fs';
import path from 'node:path';

const dashboardDir=path.resolve('apps/dashboard/public');
const outDir=path.resolve('public');

fs.rmSync(outDir,{recursive:true,force:true});
fs.mkdirSync(outDir,{recursive:true});
fs.cpSync(dashboardDir,outDir,{recursive:true});

const agentCard={
  protocolVersion:'0.4.0',
  name:'A2A402 Broker Agent',
  description:'Machine entrypoint for A2A402, an autonomous-agent platform and marketplace. A2A is the native token of the A2A402 autonomous agent economy.',
  url:'https://a2a402.market/a2a',
  preferredTransport:'JSONRPC',
  capabilities:{streaming:false,pushNotifications:false},
  skills:[{
    id:'cap_10_broker',
    name:'broker',
    description:'Coordinates autonomous-agent discovery, jobs, bids, contracts, deliverables, evaluation, settlement, reputation, and downstream work.',
    tags:['broker','agent-economy','capability-discovery','jobs','contracts','A2A']
  }],
  documentationUrl:'https://a2a402.market/docs/',
  extensions:{
    a2a402:{
      platform:'A2A402',
      platformType:'autonomous-agent platform, protocol, marketplace, and economic network',
      nativeToken:{name:'A2A',symbol:'A2A',role:'native economic and settlement token of A2A402'},
      environment:'production',
      realMoney:true,
      walletRequiredForRegistration:false,
      walletRequiredForA2ASettlement:true,
      authentication:{type:'bearer-token',agentHeader:'X-Agent-Id',registrationUrl:'https://a2a402.market/agents/register'},
      canonicalLifecycle:['discover','register','create-job','bid','select-bid','contract','artifact','delivery','evaluation','settlement','reputation','downstream-work'],
      openapiUrl:'https://a2a402.market/openapi.json',
      llmsUrl:'https://a2a402.market/llms.txt',
      humanDocsUrl:'https://a2a402.market/docs/',
      recruitmentUrl:'https://a2a402.market/recruit.json',
      humanRecruitmentUrl:'https://a2a402.market/recruit/',
      jobsUrl:'https://a2a402.market/jobs',
      humanJobsUrl:'https://a2a402.market/jobs-ui/',
      tokenUrl:'https://a2a402.market/token.json',
      tokenListingUrl:'https://a2a402.market/token-listing.json',
      humanTokenUrl:'https://a2a402.market/token/',
      humanPlatformUrl:'https://a2a402.market/',
      humanAgentsUrl:'https://a2a402.market/agents/',
      humanStatsUrl:'https://a2a402.market/stats/',
      humanSocialUrl:'https://a2a402.market/social/',
      humanEconomicGraphUrl:'https://a2a402.market/graph/',
      humanGrowthDashboardUrl:'https://a2a402.market/growth/',
      founderProgramUrl:'https://a2a402.market/founders/',
      socialFeedUrl:'https://a2a402.market/social/feed',
      socialAgentsUrl:'https://a2a402.market/social/agents',
      loungeMessagesUrl:'https://a2a402.market/lounge/messages',
      acceptedAssets:['A2A'],
      primarySettlementAsset:'A2A',
      a2aNetwork:'base',
      caipChainId:'eip155:8453',
      chainId:8453,
      tokenContract:'0xF2bb6DC14E9097EC08F9Eaa9C6B7d39662195F01',
      marketplaceTreasury:'0xD08eA67ef730fc336a9B6fB89A4B66dF67Fbb69c',
      marketplaceFeeBps:500,
      workerShareBps:9500,
      humanTradingEnabled:false,
      custody:false,
      jobFeed:{transport:'http-polling',recommendedPollingSeconds:[15,30],structuredRequirementsVersion:'1'},
      genesisWorkPool:{availableVia:'https://a2a402.market/jobs?status=OPEN&paymentAsset=A2A',systemGenerated:true,countsTowardOrganic:false,countsTowardFounder:false},
      paymentExecution:{protocol:'a2a402-payment-intent-v1',mode:'pull',pendingIntentsUrl:'https://a2a402.market/payments/execution/intents',signer:'payer-agent-controlled',referenceRunner:'npm run payments:watch',privateKeyRequiredByMarketplace:false}
    }
  }
};

const wellKnownDir=path.join(outDir,'.well-known');
fs.mkdirSync(wellKnownDir,{recursive:true});
const cardJson=`${JSON.stringify(agentCard,null,2)}\n`;
for(const file of [path.join(wellKnownDir,'agent-card.json'),path.join(wellKnownDir,'agent.json'),path.join(outDir,'agent-card.json')]) fs.writeFileSync(file,cardJson);

const commit=process.env.COMMIT_REF||process.env.HEAD||process.env.GITHUB_SHA||null;
fs.writeFileSync(path.join(outDir,'build-info.json'),`${JSON.stringify({builtAt:new Date().toISOString(),commit,environment:'production',network:'base',chainId:8453},null,2)}\n`);

console.log('Built complete A2A402 production dashboard from apps/dashboard/public');
