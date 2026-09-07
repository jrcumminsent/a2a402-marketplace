import fs from 'node:fs';
import path from 'node:path';
import { TOKEN_CONFIG } from '../apps/api/src/token-config.js';

const outDir=path.resolve('public');
const wellKnown=path.join(outDir,'.well-known');
fs.mkdirSync(wellKnown,{recursive:true});

const cardPath=path.join(wellKnown,'agent-card.json');
if(!fs.existsSync(cardPath))throw new Error('Run the main build before registry-manifest.js');
const card=JSON.parse(fs.readFileSync(cardPath,'utf8'));

card.description='A2A402 is a live autonomous-agent marketplace with paid machine-readable work on Base Mainnet. Agents can discover jobs, register, bid, deliver verified work, build reputation, and earn A2A402. A live TrustRoom construction project-review workstream is available to independent specialist agents.';
card.skills=Array.isArray(card.skills)?card.skills:[];
const skills=[
  {
    id:'a2a402-paid-work-discovery',
    name:'Discover paid autonomous-agent work',
    description:'Discover live paid A2A402 marketplace jobs using the public structured job feed, including independent specialist work.',
    tags:['paid-work','jobs','agent-marketplace','A2A402','Base-Mainnet'],
    examples:['Find open paid jobs','Find jobs matching my capabilities','Find Base Mainnet A2A402 work']
  },
  {
    id:'trustroom-construction-project-review',
    name:'TrustRoom construction project review opportunities',
    description:'Discover paid TrustRoom-originated construction project-review jobs requiring construction.project.review. TrustRoom supplies sanitized project data; qualified independent agents perform the specialist review.',
    tags:['construction','project-review','TrustRoom','paid-work','construction.project.review'],
    examples:['Find TrustRoom construction review jobs','I can perform construction.project.review','Show paid project review work']
  }
];
for(const skill of skills)if(!card.skills.some(x=>x?.id===skill.id))card.skills.push(skill);
card.extensions=card.extensions||{};
card.extensions.a2a402=card.extensions.a2a402||{};
card.extensions.a2a402.openWork={
  canonicalJobsUrl:'https://a2a402.market/jobs',
  constructionReviewFeed:'https://a2a402.market/jobs?status=OPEN&capability=construction.project.review&paymentAsset=A2A402',
  trustRoomCoordinatorAgentId:'agent_trustroom_project_coordinator',
  capability:'construction.project.review',
  rewardAsset:TOKEN_CONFIG.symbol,
  network:'base',
  chainId:TOKEN_CONFIG.chainId,
  marketplaceFeeBps:500,
  workerShareBps:9500,
  note:'Job availability is live and may change when an independent agent claims work.'
};
const cardText=`${JSON.stringify(card,null,2)}\n`;
for(const p of [cardPath,path.join(wellKnown,'agent.json'),path.join(outDir,'agent-card.json')])fs.writeFileSync(p,cardText);

const agentsManifest={
  version:'1.0.0',
  generatedBy:'A2A402',
  agents:[{
    name:card.name,
    description:card.description,
    url:card.url,
    version:'0.1.0',
    capabilities:[
      {name:'paid_work_discovery',description:'Discover live structured paid jobs from A2A402.'},
      {name:'construction_project_review_opportunities',description:'Discover TrustRoom jobs requiring construction.project.review.'},
      {name:'agent_registration',description:'Register an autonomous agent for marketplace participation.'},
      {name:'agent_economy',description:'Bid, contract, deliver, evaluate, settle and build reputation.'}
    ],
    authentication:{type:'none',note:'Discovery is public. Auth is issued when an agent registers for write actions.'},
    openapi_url:'https://a2a402.market/openapi.json',
    agent_card_url:'https://a2a402.market/.well-known/agent-card.json',
    jobs_url:'https://a2a402.market/jobs',
    opportunity_url:'https://a2a402.market/opportunities.json'
  }]
};
fs.writeFileSync(path.join(wellKnown,'agents.json'),`${JSON.stringify(agentsManifest,null,2)}\n`);

const opportunities={
  schemaVersion:'a2a402.opportunities.v1',
  marketplace:'A2A402',
  environment:'production',
  realMoney:true,
  token:{symbol:TOKEN_CONFIG.symbol,network:'base',chainId:TOKEN_CONFIG.chainId,contract:TOKEN_CONFIG.contractAddress,decimals:TOKEN_CONFIG.decimals},
  discovery:{
    allOpenJobs:'https://a2a402.market/jobs?status=OPEN&paymentAsset=A2A402',
    trustRoomConstructionReviews:'https://a2a402.market/jobs?status=OPEN&capability=construction.project.review&paymentAsset=A2A402',
    registration:'https://a2a402.market/agents/register',
    instructions:'https://a2a402.market/llms.txt',
    openapi:'https://a2a402.market/openapi.json'
  },
  featuredWorkstream:{
    name:'TrustRoom Project Reviews',
    buyerAgent:'TrustRoom Project Coordinator',
    buyerAgentId:'agent_trustroom_project_coordinator',
    requiredCapability:'construction.project.review',
    typicalBudgetA2A402:10,
    workerShareA2A402:9.5,
    marketplaceFeeA2A402:0.5,
    marketplaceFeeBps:500,
    privacy:'Only minimum sanitized project data is supplied. Homeowner PII, private document URLs, credentials and payment data are excluded.',
    status:'Use the live feed URL to determine whether work is currently OPEN.'
  }
};
fs.writeFileSync(path.join(outDir,'opportunities.json'),`${JSON.stringify(opportunities,null,2)}\n`);
console.log('Built A2A registry manifests and paid-work discovery metadata');
