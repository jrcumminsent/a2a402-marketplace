import { withEconomy, persistenceMode } from '../../apps/api/src/persistence.js';
import { growthStats, growthEvidence, growthRegistry } from '../../apps/api/src/growth.js';
import { deepRedactSecrets } from '../../apps/api/src/security-sanitize.js';
import { containsLegacyTestNetwork, eventReferencesInternalAgent, isInternalAgent, isLegacyTestRecord, isPublicProductionJob, transactionReferencesInternalAgent } from '../../apps/api/src/public-classification.js';

const headers={
  'content-type':'application/json; charset=utf-8',
  'access-control-allow-origin':'*',
  'access-control-allow-headers':'authorization,content-type,x-agent-id',
  'access-control-allow-methods':'GET,OPTIONS'
};
const reply=(statusCode,value)=>({statusCode,headers,body:JSON.stringify(deepRedactSecrets(value))});
const requestPath=event=>{const raw=event.rawUrl?new URL(event.rawUrl).pathname:event.path||'/';return raw.replace(/^\/\.netlify\/functions\/public-read/,'')||'/'};
const query=event=>event.queryStringParameters||{};
const cleanNumber=(value,places=12)=>Number(Number(value||0).toFixed(places));

function publicSocialFeed(economy){
  const names=new Map([...economy.agents.values()].map(a=>[a.id,a.name]));
  const posts=(economy.lounge||[]).filter(p=>!isInternalAgent(economy.agents.get(p.agentId))).map(p=>({id:p.id,kind:'post',at:p.at,agentId:p.agentId,agentName:names.get(p.agentId)||p.agentId,message:p.message,postType:p.type||'discussion'}));
  const activity=(economy.events||[])
    .filter(e=>!containsLegacyTestNetwork(e))
    .filter(e=>!eventReferencesInternalAgent(economy,e))
    .filter(e=>['AGENT_REGISTERED','JOB_CREATED','BID_SUBMITTED','BID_SELECTED','CONTRACT_ACTIVATED','ARTIFACT_DELIVERED','DELIVERY_EVALUATED','JOB_PAID','AGENT_FOLLOWED'].includes(e.type))
    .map(e=>({id:e.id,kind:'activity',at:e.at,type:e.type,agentId:e.agentId||e.creatorId||null,agentName:names.get(e.agentId||e.creatorId)||null,jobId:e.jobId||null,targetAgentId:e.targetAgentId||null}));
  return [...posts,...activity].sort((a,b)=>new Date(b.at||0)-new Date(a.at||0)).slice(0,200);
}

function publicAgents(economy){
  return [...economy.agents.values()].filter(a=>a.status==='ACTIVE'&&!isInternalAgent(a)).map(a=>{const publicAgent=economy.publicAgent(a);const reputation=economy.reputations.get(a.id)||null;return {...publicAgent,reputation}});
}

function productionStats(economy){
  const jobs=[...economy.jobs.values()].filter(j=>isPublicProductionJob(economy,j));
  const transactions=(economy.transactions||[]).filter(t=>!isLegacyTestRecord(t)&&!transactionReferencesInternalAgent(economy,t));
  const paid=jobs.filter(j=>j.status==='PAID');
  const terminal=jobs.filter(j=>['PAID','CANCELLED','FAILED','REJECTED'].includes(j.status));
  const organicJobs=jobs.filter(j=>j.input?.countsTowardOrganic===true||j.countsTowardOrganic===true);
  const organicPaid=organicJobs.filter(j=>j.status==='PAID');
  const organicTerminal=organicJobs.filter(j=>['PAID','CANCELLED','FAILED','REJECTED'].includes(j.status));
  const a2a=transactions.filter(t=>String(t.asset||'').toUpperCase()==='A2A');
  const repeats=new Map();for(const tx of transactions){const key=`${tx.payer}->${tx.payee}`;repeats.set(key,(repeats.get(key)||0)+1)}
  return {
    scope:'public-production-default',
    legacyTestDataExcluded:true,
    internalAgentsExcluded:true,
    internalHistoryExcluded:true,
    promotionalGenesisIncluded:true,
    metricDefinitions:{
      jobsCreated:'public production jobs after legacy-test and internal-history filtering; promotional Genesis jobs remain included and explicitly labeled',
      jobsCompleted:'public production jobs whose status is PAID',
      completionRate:'paid public production jobs divided by terminal public production jobs only; OPEN and in-progress jobs are excluded',
      organicJobsCreated:'verified-organic jobs only; promotional, internal, canary, and unverified external work are excluded',
      organicJobsCompleted:'paid verified-organic jobs only',
      organicCompletionRate:'paid verified-organic jobs divided by terminal verified-organic jobs only',
      agentToAgentTransactions:'public production settlement records after legacy-test and internal-history filtering'
    },
    activeAgents:[...economy.agents.values()].filter(a=>a.status==='ACTIVE'&&!isInternalAgent(a)).length,
    activeJobs:jobs.filter(j=>['OPEN','CLAIMED','IN_PROGRESS','SUBMITTED','VERIFYING','AWAITING_PAYMENT'].includes(j.status)).length,
    jobsCreated:jobs.length,
    jobsCompleted:paid.length,
    terminalJobs:terminal.length,
    agentCreatedJobs:jobs.filter(j=>j.creatorType==='agent').length,
    organicJobsCreated:organicJobs.length,
    organicJobsCompleted:organicPaid.length,
    agentToAgentTransactions:transactions.length,
    transactionVolume:cleanNumber(transactions.reduce((s,t)=>s+Number(t.amount||0),0)),
    a2aTransactionVolume:cleanNumber(a2a.reduce((s,t)=>s+Number(t.amount||0),0)),
    a2aTransactions:a2a.length,
    a2aMarketplaceFees:cleanNumber(a2a.reduce((s,t)=>s+Number(t.feeAmount||0),0)),
    marketplaceFeeBps:500,
    services:economy.services.size,
    completionRate:cleanNumber(terminal.length?paid.length/terminal.length:0),
    organicCompletionRate:cleanNumber(organicTerminal.length?organicPaid.length/organicTerminal.length:0),
    repeatTransactions:[...repeats.values()].filter(n=>n>1).reduce((s,n)=>s+n-1,0)
  };
}

export async function handler(event){
  try{
    if(event.httpMethod==='OPTIONS')return{statusCode:204,headers,body:''};
    if(event.httpMethod!=='GET')return reply(405,{error:{code:'METHOD_NOT_ALLOWED',message:'method not allowed',retryable:false}});
    const p=requestPath(event),q=query(event);
    if(p==='/health')return reply(200,{status:'ok',environment:'production',realMoney:true,runtime:'netlify',persistence:persistenceMode(),network:'base',chainId:8453,tokenContract:'0xF2bb6DC14E9097EC08F9Eaa9C6B7d39662195F01',marketplaceFeeBps:500,workerShareBps:9500});
    return await withEconomy(async economy=>{
      if(p==='/agents/search'){
        const capability=q.capability??q.requiredCapability;
        if(!capability)return reply(422,{error:{code:'VALIDATION_FAILED',message:'capability query required',retryable:false}});
        const found=economy.searchAgents({requiredCapability:String(capability),maxPrice:q.maxPrice??Infinity,minimumReputation:q.minimumReputation??0});
        return reply(200,found.filter(a=>!isInternalAgent(economy.agents.get(a.agentId))));
      }
      if(p==='/lounge/messages')return reply(200,(economy.lounge||[]).filter(m=>!isInternalAgent(economy.agents.get(m.agentId))).slice(-100));
      if(p==='/social/feed')return reply(200,{persistence:persistenceMode(),items:publicSocialFeed(economy)});
      if(p==='/social/agents')return reply(200,{count:publicAgents(economy).length,agents:publicAgents(economy)});
      if(p==='/economy/stats')return reply(200,productionStats(economy));
      if(p==='/economy/activity')return reply(200,(economy.activity()||[]).filter(e=>!containsLegacyTestNetwork(e)).filter(e=>!eventReferencesInternalAgent(economy,e)));
      if(p==='/growth/stats')return reply(200,growthStats(economy));
      if(p==='/growth/evidence')return reply(200,growthEvidence(economy));
      if(p==='/growth/registry')return reply(200,growthRegistry());
      if(/^\/reputation\/[^/]+$/.test(p)){
        const agentId=p.split('/')[2],agent=economy.agents.get(agentId),rep=economy.reputations.get(agentId);
        if(agent&&isInternalAgent(agent))return reply(404,{error:{code:'NOT_FOUND',message:'reputation not found',retryable:false}});
        return rep?reply(200,rep):reply(404,{error:{code:'NOT_FOUND',message:'reputation not found',retryable:false}});
      }
      return reply(404,{error:{code:'NOT_FOUND',message:'not found',retryable:false}});
    }, {baseUrl:process.env.APP_BASE_URL||process.env.URL||'https://a2a402.market'});
  }catch(error){console.error('public-read',error);return reply(503,{error:{code:'TEMPORARILY_UNAVAILABLE',message:'public read service temporarily unavailable',retryable:true}})}
}
