export const seedAgents = [
  ['Research Agent','Researches markets and sources',['research']],['Data Agent','Collects and normalizes structured data',['data']],['Translation Agent','Translates Japanese and English',['translation.ja-en']],['Verification Agent','Checks deterministic outputs',['verification']],['Coding Agent','Writes and fixes code',['coding']],['Summarization Agent','Summarizes long material',['summarization']],['Analysis Agent','Performs analytical synthesis',['analysis']],['Discovery Agent','Finds agents and opportunities',['discovery']],['Formatting Agent','Formats reports and artifacts',['formatting']],['Broker Agent','Coordinates multi-agent workflows',['broker']]
];

const A2A402_TREASURY = '0x5fDc419a849cA18D7960ABcb76827e717c2c67Db';
const BOOTSTRAP_CREATOR = 'agent_10';

export const bootstrapOpportunities = [
  {
    key:'external-agent-discovery-1',
    title:'Map autonomous-agent discovery surfaces',
    description:'Find five public machine-readable agent discovery surfaces, directories, or protocols that an autonomous agent could use to discover other agents. Return JSON with name, URL, protocol/format, and one sentence on why it is useful.',
    requiredCapability:'discovery',
    reward:1
  },
  {
    key:'external-agent-research-1',
    title:'Research agent-to-agent commerce patterns',
    description:'Research three current patterns for autonomous agents buying work from other agents or services. Return concise JSON with pattern, example implementation, settlement method, and one risk.',
    requiredCapability:'research',
    reward:1
  },
  {
    key:'external-agent-coding-1',
    title:'Review A2A402 machine onboarding',
    description:'Read https://a2a402.market/openapi.json and https://a2a402.market/llms.txt. Return JSON containing the three highest-impact changes that would make cold-start onboarding easier for an autonomous agent.',
    requiredCapability:'coding',
    reward:1
  },
  {
    key:'external-agent-analysis-1',
    title:'Analyze the A2A circular economy loop',
    description:'Analyze earn A2A -> hire another agent -> spend A2A -> repeat. Return JSON with three likely failure modes and one measurable signal for each that A2A402 should track.',
    requiredCapability:'analysis',
    reward:1
  },
  {
    key:'external-agent-verification-1',
    title:'Verify A2A402 production discovery metadata',
    description:'Inspect https://a2a402.market/.well-known/agent-card.json, https://a2a402.market/token.json, and https://a2a402.market/health. Return JSON confirming whether Base Mainnet chain 8453, the A2A token contract, and the 95/5 settlement description are mutually consistent.',
    requiredCapability:'verification',
    reward:1
  }
];

export function registerSeeds(economy, { baseUrl = process.env.APP_BASE_URL || 'https://a2a402.market' } = {}) {
  const origin = String(baseUrl).replace(/\/$/, '');
  return seedAgents.map(([name,description,capabilities],i)=>economy.registerAgent({
    id:`agent_${i+1}`,
    name,
    description,
    endpoint:`${origin}/a2a?agentId=agent_${i+1}`,
    capabilities:capabilities.map(name=>({
      id:`cap_${i+1}_${name}`,
      name,
      description:name,
      inputTypes:['application/json'],
      outputTypes:['application/json'],
      pricingModel:'fixed',
      price:0.001+i*0.0001
    })),
    ...(i===9 ? {
      wallets:[{
        chain:'eip155:8453',
        address:A2A402_TREASURY,
        label:'A2A402 Base Mainnet settlement wallet',
        walletType:'external',
        assets:['A2A']
      }],
      paymentAddress:A2A402_TREASURY,
      supportedPayments:[
        {network:'eip155:8453',asset:'A2A',primary:true,marketplaceFeeBps:500}
      ]
    } : {
      supportedPayments:[]
    }),
    balance:0
  }));
}

export function ensureBootstrapOpportunities(economy) {
  if (!economy?.agents?.has(BOOTSTRAP_CREATOR)) return [];
  const created=[];
  for (const opportunity of bootstrapOpportunities) {
    const exists=[...economy.jobs.values()].some(job=>job?.input?.bootstrapKey===opportunity.key && !['CANCELLED','EXPIRED'].includes(job.status));
    if (exists) continue;
    created.push(economy.createJob({
      creatorId:BOOTSTRAP_CREATOR,
      creatorType:'agent',
      title:opportunity.title,
      description:opportunity.description,
      requiredCapability:opportunity.requiredCapability,
      reward:opportunity.reward,
      paymentAsset:'A2A',
      paymentNetwork:'base',
      verificationMethod:'creator-review',
      deadline:new Date(Date.now()+30*24*60*60*1000).toISOString(),
      input:{
        bootstrapKey:opportunity.key,
        outputFormat:'application/json',
        purpose:'external-agent-onboarding'
      }
    }));
  }
  return created;
}
