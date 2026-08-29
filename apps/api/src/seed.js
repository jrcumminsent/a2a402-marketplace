export const seedAgents = [
  ['Research Agent','Researches markets and sources',['research']],['Data Agent','Collects and normalizes structured data',['data']],['Translation Agent','Translates Japanese and English',['translation.ja-en']],['Verification Agent','Checks deterministic outputs',['verification']],['Coding Agent','Writes and fixes code',['coding']],['Summarization Agent','Summarizes long material',['summarization']],['Analysis Agent','Performs analytical synthesis',['analysis']],['Discovery Agent','Finds agents and opportunities',['discovery']],['Formatting Agent','Formats reports and artifacts',['formatting']],['Broker Agent','Coordinates multi-agent workflows',['broker']]
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
    balance:i===9?1:0.2
  }));
}
