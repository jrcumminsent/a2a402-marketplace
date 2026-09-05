const SEED_INTERNAL_AGENT_ID=/^agent_(?:[1-9]|10)$/;

const INTERNAL_AGENT_NAME_PATTERNS=[
  /\bcanary\b/i,
  /\ba2a402 reference autonomous agent\b/i,
  /\ba2a402 autonomous payer\b/i,
  /\ba2a402 autonomous worker\b/i,
  /\ba2a402 background worker\b/i,
  /\ba2a402-operated\b/i,
  /\bferal teachers commerce agent\b/i
];

const INTERNAL_JOB_TEXT_PATTERNS=[
  /\bcanary\b/i,
  /\bautonomous settlement proof\b/i,
  /\bfully autonomous a2a mainnet settlement\b/i
];

export function isLegacyTestRecord(record){
  const asset=String(record?.paymentAsset||record?.asset||'').toUpperCase();
  const network=String(record?.paymentNetwork||record?.network||record?.chain||'').toLowerCase();
  return asset==='USDC_TEST'||network==='base-sepolia'||network==='eip155:84532';
}

export function containsLegacyTestNetwork(value){
  return /base[- ]sepolia|eip155:84532|USDC_TEST/i.test(JSON.stringify(value??null));
}

export function isInternalAgent(agent){
  if(!agent)return false;
  const id=String(agent.id||'');
  const name=String(agent.name||'');
  if(SEED_INTERNAL_AGENT_ID.test(id))return true;
  return INTERNAL_AGENT_NAME_PATTERNS.some(pattern=>pattern.test(name));
}

export function isPromotionalJob(job){
  return Boolean(
    job?.input?.bootstrapKey ||
    job?.input?.program==='genesis-work-pool' ||
    job?.input?.purpose==='external-agent-onboarding' ||
    job?.input?.classification==='promotional' ||
    job?.classification==='promotional'
  );
}

export function isInternalHistoryJob(economy,job){
  if(!job)return false;
  if(isPromotionalJob(job))return false;
  if(job?.input?.classification==='internal'||job?.input?.classification==='canary'||job?.classification==='internal'||job?.classification==='canary')return true;
  const text=`${job?.title||''} ${job?.description||''}`;
  if(INTERNAL_JOB_TEXT_PATTERNS.some(pattern=>pattern.test(text)))return true;
  const creator=job.creatorId?economy?.agents?.get?.(job.creatorId):null;
  const worker=job.workerId?economy?.agents?.get?.(job.workerId):null;
  return isInternalAgent(creator)||isInternalAgent(worker);
}

export function isPublicProductionJob(economy,job,{includeLegacy=false,includeInternal=false}={}){
  if(!includeLegacy&&isLegacyTestRecord(job))return false;
  if(!includeInternal&&isInternalHistoryJob(economy,job))return false;
  return true;
}

export function eventReferencesInternalAgent(economy,event){
  const fields=['agentId','creatorId','workerId','bidderId','evaluatorId','targetAgentId','payerId','payeeId','fromAgentId','toAgentId','payer','payee'];
  for(const field of fields){
    const id=event?.[field];
    if(id&&isInternalAgent(economy?.agents?.get?.(id)))return true;
  }
  if(event?.jobId){
    const job=economy?.jobs?.get?.(event.jobId);
    if(job&&isInternalHistoryJob(economy,job))return true;
  }
  return false;
}

export function transactionReferencesInternalAgent(economy,tx){
  if(!tx)return false;
  if(tx.jobId){
    const job=economy?.jobs?.get?.(tx.jobId);
    if(job&&isInternalHistoryJob(economy,job))return true;
  }
  for(const field of ['payer','payee','payerId','payeeId','fromAgentId','toAgentId','creatorId','workerId']){
    const id=tx[field];
    if(id&&isInternalAgent(economy?.agents?.get?.(id)))return true;
  }
  return false;
}
