import { isInternalAgent, isLegacyTestRecord, isPromotionalJob } from './public-classification.js';

const INTERNAL_AGENT_IDS = new Set(Array.from({length:10},(_,i)=>`agent_${i+1}`));

// Verified organic operators must be added deliberately after evidence establishes
// independent operation. Never infer independent ownership from an agent ID alone.
export const verifiedOrganicOperators = Object.freeze({});

function ownerFor(agentId){ return verifiedOrganicOperators[agentId]?.ownerId || null; }
function isCanary(job){
  const text=`${job?.title||''} ${job?.description||''} ${job?.input?.purpose||''}`.toLowerCase();
  return Boolean(job?.input?.classification==='canary' || text.includes('canary'));
}
function involvesInternalAgent(economy,job){
  const creator=job?.creatorId?economy?.agents?.get?.(job.creatorId):null;
  const worker=job?.workerId?economy?.agents?.get?.(job.workerId):null;
  return INTERNAL_AGENT_IDS.has(job?.creatorId)||INTERNAL_AGENT_IDS.has(job?.workerId)||isInternalAgent(creator)||isInternalAgent(worker);
}
export function classifyJob(job,economy=null){
  if(isCanary(job)) return 'canary';
  if(isPromotionalJob(job)) return 'promotional';
  const creatorOwner=ownerFor(job?.creatorId), workerOwner=ownerFor(job?.workerId);
  if(creatorOwner && workerOwner && creatorOwner!==workerOwner) return 'organic';
  if(involvesInternalAgent(economy,job)) return 'internal';
  return 'unclassified';
}
function durationMs(job){
  if(!job?.claimedAt || !(job?.paidAt||job?.completedAt)) return null;
  const n=new Date(job.paidAt||job.completedAt)-new Date(job.claimedAt);
  return Number.isFinite(n)&&n>=0?n:null;
}
function median(values){
  const xs=values.filter(Number.isFinite).sort((a,b)=>a-b); if(!xs.length)return null;
  const m=Math.floor(xs.length/2); return xs.length%2?xs[m]:(xs[m-1]+xs[m])/2;
}
function cleanNumber(value,places=12){return Number(Number(value||0).toFixed(places));}
function settlementVolume(transactions){return cleanNumber(transactions.reduce((s,t)=>s+Number(t.amount||0)+Number(t.feeAmount||0),0));}
function marketplaceFees(transactions){return cleanNumber(transactions.reduce((s,t)=>s+Number(t.feeAmount||0),0));}
function publicWallet(economy,agentId){
  const agent=economy.agents.get(agentId); if(!agent)return null;
  const wallets=economy.publicAgent(agent)?.wallets||[];
  return wallets.find(w=>w.chain==='eip155:8453'&&(w.assets||[]).map(String).map(x=>x.toUpperCase()).includes('A2A402'))?.address || null;
}
export function growthStats(economy){
  const jobs=[...economy.jobs.values()].filter(j=>!isLegacyTestRecord(j));
  const paid=jobs.filter(j=>j.status==='PAID');
  const organicPaid=paid.filter(j=>classifyJob(j,economy)==='organic');
  const organicAgentIds=new Set(); organicPaid.forEach(j=>{organicAgentIds.add(j.creatorId);organicAgentIds.add(j.workerId)});
  Object.keys(verifiedOrganicOperators).forEach(id=>organicAgentIds.add(id));
  const creatorCounts=new Map(), participantTx=new Map();
  organicPaid.forEach(j=>{creatorCounts.set(j.creatorId,(creatorCounts.get(j.creatorId)||0)+1);participantTx.set(j.creatorId,(participantTx.get(j.creatorId)||0)+1);participantTx.set(j.workerId,(participantTx.get(j.workerId)||0)+1)});
  const classificationCounts={internal:0,canary:0,promotional:0,unclassified:0,organic:0};
  jobs.forEach(j=>classificationCounts[classifyJob(j,economy)]++);
  const txByJob=new Map(economy.transactions.map(t=>[t.jobId,t]));
  const organicTx=organicPaid.map(j=>txByJob.get(j.id)).filter(Boolean).filter(t=>t.asset==='A2A402');
  const allA2ATx=economy.transactions.filter(t=>t.asset==='A2A402'&&!isLegacyTestRecord(t));
  const payerWallets=new Set(allA2ATx.map(t=>t.payerAddress||publicWallet(economy,t.payer)).filter(Boolean).map(x=>x.toLowerCase()));
  const workerWallets=new Set(allA2ATx.map(t=>t.payeeAddress||publicWallet(economy,t.payee)).filter(Boolean).map(x=>x.toLowerCase()));
  const failed=jobs.filter(j=>j.status==='FAILED').length;
  const disputed=jobs.filter(j=>j.status==='DISPUTED').length;
  const completionDurations=paid.map(durationMs).filter(Number.isFinite);
  return {
    scope:'growth-audit',
    legacyTestDataExcluded:true,
    targets:{independentAgents:25,organicJobs:50,recurringCreators:10,organicWorkers:15,repeatAgents:15},
    verifiedOrganic:{
      scope:'verified-independent-operators-only',
      independentAgents:organicAgentIds.size,
      completedJobs:organicPaid.length,
      recurringCreators:[...creatorCounts.values()].filter(n=>n>1).length,
      workers:new Set(organicPaid.map(j=>j.workerId)).size,
      repeatAgents:[...participantTx.values()].filter(n=>n>1).length,
      a2aSettlementVolume:settlementVolume(organicTx),
      marketplaceFees:marketplaceFees(organicTx)
    },
    marketplace:{
      scope:'all-production-history-including-internal-operator-activity',
      internalOperatorActivityIncluded:true,
      promotionalActivityIncluded:true,
      registeredAgents:[...economy.agents.values()].filter(a=>a.status==='ACTIVE').length,
      completedJobs:paid.length,
      a2aTransactions:allA2ATx.length,
      a2aSettlementVolume:settlementVolume(allA2ATx),
      marketplaceFees:marketplaceFees(allA2ATx),
      uniquePayerWallets:payerWallets.size,
      uniqueWorkerWallets:workerWallets.size,
      medianCompletionMs:median(completionDurations),
      successRate:cleanNumber(jobs.length?paid.length/jobs.length:0),
      failedJobs:failed,
      disputes:disputed
    },
    classifications:classificationCounts,
    methodology:'verifiedOrganic excludes seed, canary, promotional, operator-controlled, and unverified external activity. marketplace is an all-production-history audit view and intentionally includes internal/operator activity, so its totals must not be presented as independent adoption.'
  };
}
export function growthEvidence(economy){
  const txByJob=new Map(economy.transactions.map(t=>[t.jobId,t]));
  return [...economy.jobs.values()].filter(j=>j.status==='PAID'&&!isLegacyTestRecord(j)).map(job=>{
    const tx=txByJob.get(job.id);
    return {jobId:job.id,title:job.title,classification:classifyJob(job,economy),creatorId:job.creatorId,workerId:job.workerId,reward:job.reward,asset:job.paymentAsset,network:job.paymentNetwork,paidAt:job.paidAt,workerTxHash:tx?.reference||job.settlementTxHash||null,feeTxHash:tx?.feeReference||job.feeTxHash||null,payerAddress:tx?.payerAddress||job.payerAddress||null,payeeAddress:tx?.payeeAddress||job.payeeAddress||null,feeAmount:tx?.feeAmount==null?null:cleanNumber(tx.feeAmount)};
  }).sort((a,b)=>new Date(b.paidAt||0)-new Date(a.paidAt||0));
}
export function growthRegistry(){
  return {verifiedOrganicOperators:Object.entries(verifiedOrganicOperators).map(([agentId,v])=>({agentId,...v})),internalAgentIds:[...INTERNAL_AGENT_IDS],policy:'Entries are added only after independent-operation evidence is reviewed. Empty means no external operator has yet been verified for organic statistics.'};
}


export function validationStats(economy){
  const agents=[...economy.agents.values()];
  const jobs=[...economy.jobs.values()].filter(j=>!isLegacyTestRecord(j));
  const needJobs=jobs.filter(j=>j?.input?.source==='need-router');
  const externalNeedJobs=needJobs.filter(j=>!involvesInternalAgent(economy,j)&&!isPromotionalJob(j));
  const needEvents=(economy.events||[]).filter(e=>e.type==='NEED_ROUTED');
  const externalNeedEvents=needEvents.filter(e=>!isInternalAgent(economy.agents.get(e.creatorId)));
  const creatorCounts=new Map();
  externalNeedJobs.forEach(j=>creatorCounts.set(j.creatorId,(creatorCounts.get(j.creatorId)||0)+1));
  const completed=externalNeedJobs.filter(j=>j.status==='PAID');
  const terminal=externalNeedJobs.filter(j=>['PAID','FAILED','CANCELLED','REJECTED'].includes(j.status));
  const matched=externalNeedEvents.filter(e=>Number(e.matchCount||0)>0);
  const txByJob=new Map((economy.transactions||[]).map(t=>[t.jobId,t]));
  const settledTx=completed.map(j=>txByJob.get(j.id)).filter(Boolean);
  const settlementVolumeByAsset={};
  const feesByAsset={};
  for(const tx of settledTx){
    const asset=String(tx.asset||'UNKNOWN').toUpperCase();
    settlementVolumeByAsset[asset]=cleanNumber((settlementVolumeByAsset[asset]||0)+Number(tx.amount||0)+Number(tx.feeAmount||0));
    feesByAsset[asset]=cleanNumber((feesByAsset[asset]||0)+Number(tx.feeAmount||0));
  }
  return {
    scope:'product-validation',
    generatedAt:new Date().toISOString(),
    definitions:{
      externalAgents:'active agents that are not known A2A402 seed/operator identities; this is not the same as verified independent ownership',
      verifiedIndependentAgents:'agents in the reviewed organic-operator registry',
      externalNeeds:'POST /need-created jobs whose creator is not a known internal seed/operator identity and that are not promotional',
      repeatNeedCreators:'external need creators with two or more /need jobs',
      matchedNeeds:'external NEED_ROUTED events where at least one provider match was returned',
      completedNeeds:'external /need jobs with verified PAID status'
    },
    funnel:{
      activeExternalAgents:agents.filter(a=>a.status==='ACTIVE'&&!isInternalAgent(a)).length,
      verifiedIndependentAgents:Object.keys(verifiedOrganicOperators).length,
      externalNeeds:externalNeedJobs.length,
      matchedNeeds:matched.length,
      completedNeeds:completed.length,
      repeatNeedCreators:[...creatorCounts.values()].filter(n=>n>=2).length
    },
    rates:{
      matchRate:cleanNumber(externalNeedEvents.length?matched.length/externalNeedEvents.length:0),
      completionRate:cleanNumber(terminal.length?completed.length/terminal.length:0),
      repeatCreatorRate:cleanNumber(creatorCounts.size?[...creatorCounts.values()].filter(n=>n>=2).length/creatorCounts.size:0)
    },
    economics:{
      settledJobs:completed.length,
      settlementVolumeByAsset,
      marketplaceFeesByAsset:feesByAsset
    },
    readiness:{
      coreLifecycleBuildGate:true,
      needRouter:true,
      sdk:true,
      mcp:true,
      externalA2AProbe:true,
      independentRepeatUsageProven:[...creatorCounts.values()].some(n=>n>=2)&&completed.length>0
    },
    note:'Independent repeat usage is only proven when unrelated operators complete real work and return. Seed, internal, promotional and canary activity do not satisfy that milestone.'
  };
}
