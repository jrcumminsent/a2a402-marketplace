const INTERNAL_AGENT_IDS = new Set(Array.from({length:10},(_,i)=>`agent_${i+1}`));

// Verified organic operators must be added deliberately after evidence establishes
// independent operation. Never infer independent ownership from an agent ID alone.
export const verifiedOrganicOperators = Object.freeze({});

function ownerFor(agentId){ return verifiedOrganicOperators[agentId]?.ownerId || null; }
function isCanary(job){
  const text=`${job?.title||''} ${job?.description||''} ${job?.input?.purpose||''}`.toLowerCase();
  return Boolean(job?.input?.classification==='canary' || text.includes('canary'));
}
function isPromotional(job){
  return Boolean(job?.input?.bootstrapKey || job?.input?.purpose==='external-agent-onboarding' || job?.input?.classification==='promotional');
}
export function classifyJob(job){
  if(isCanary(job)) return 'canary';
  if(isPromotional(job)) return 'promotional';
  const creatorOwner=ownerFor(job?.creatorId), workerOwner=ownerFor(job?.workerId);
  if(creatorOwner && workerOwner && creatorOwner!==workerOwner) return 'organic';
  if(INTERNAL_AGENT_IDS.has(job?.creatorId) || INTERNAL_AGENT_IDS.has(job?.workerId)) return 'internal';
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
function publicWallet(economy,agentId){
  const agent=economy.agents.get(agentId); if(!agent)return null;
  const wallets=economy.publicAgent(agent)?.wallets||[];
  return wallets.find(w=>w.chain==='eip155:8453'&&(w.assets||[]).map(String).map(x=>x.toUpperCase()).includes('A2A'))?.address || null;
}
export function growthStats(economy){
  const jobs=[...economy.jobs.values()];
  const paid=jobs.filter(j=>j.status==='PAID');
  const organicPaid=paid.filter(j=>classifyJob(j)==='organic');
  const organicAgentIds=new Set(); organicPaid.forEach(j=>{organicAgentIds.add(j.creatorId);organicAgentIds.add(j.workerId)});
  Object.keys(verifiedOrganicOperators).forEach(id=>organicAgentIds.add(id));
  const creatorCounts=new Map(), participantTx=new Map();
  organicPaid.forEach(j=>{creatorCounts.set(j.creatorId,(creatorCounts.get(j.creatorId)||0)+1);participantTx.set(j.creatorId,(participantTx.get(j.creatorId)||0)+1);participantTx.set(j.workerId,(participantTx.get(j.workerId)||0)+1)});
  const classificationCounts={internal:0,canary:0,promotional:0,unclassified:0,organic:0};
  jobs.forEach(j=>classificationCounts[classifyJob(j)]++);
  const txByJob=new Map(economy.transactions.map(t=>[t.jobId,t]));
  const organicTx=organicPaid.map(j=>txByJob.get(j.id)).filter(Boolean).filter(t=>t.asset==='A2A');
  const allA2ATx=economy.transactions.filter(t=>t.asset==='A2A');
  const payerWallets=new Set(allA2ATx.map(t=>t.payerAddress||publicWallet(economy,t.payer)).filter(Boolean).map(x=>x.toLowerCase()));
  const workerWallets=new Set(allA2ATx.map(t=>t.payeeAddress||publicWallet(economy,t.payee)).filter(Boolean).map(x=>x.toLowerCase()));
  const failed=jobs.filter(j=>j.status==='FAILED').length;
  const disputed=jobs.filter(j=>j.status==='DISPUTED').length;
  const completionDurations=paid.map(durationMs).filter(Number.isFinite);
  return {
    targets:{independentAgents:25,organicJobs:50,recurringCreators:10,organicWorkers:15,repeatAgents:15},
    verifiedOrganic:{
      independentAgents:organicAgentIds.size,
      completedJobs:organicPaid.length,
      recurringCreators:[...creatorCounts.values()].filter(n=>n>1).length,
      workers:new Set(organicPaid.map(j=>j.workerId)).size,
      repeatAgents:[...participantTx.values()].filter(n=>n>1).length,
      a2aSettlementVolume:organicTx.reduce((s,t)=>s+Number(t.amount||0)+Number(t.feeAmount||0),0),
      marketplaceFees:organicTx.reduce((s,t)=>s+Number(t.feeAmount||0),0)
    },
    marketplace:{
      registeredAgents:[...economy.agents.values()].filter(a=>a.status==='ACTIVE').length,
      completedJobs:paid.length,
      a2aTransactions:allA2ATx.length,
      a2aSettlementVolume:allA2ATx.reduce((s,t)=>s+Number(t.amount||0)+Number(t.feeAmount||0),0),
      marketplaceFees:allA2ATx.reduce((s,t)=>s+Number(t.feeAmount||0),0),
      uniquePayerWallets:payerWallets.size,
      uniqueWorkerWallets:workerWallets.size,
      medianCompletionMs:median(completionDurations),
      successRate:jobs.length?paid.length/jobs.length:0,
      failedJobs:failed,
      disputes:disputed
    },
    classifications:classificationCounts,
    methodology:'Organic requires both creator and worker to be deliberately verified as independently operated and mapped to different owners. Seed, canary, promotional, and unverified external activity is excluded.'
  };
}
export function growthEvidence(economy){
  const txByJob=new Map(economy.transactions.map(t=>[t.jobId,t]));
  return [...economy.jobs.values()].filter(j=>j.status==='PAID').map(job=>{
    const tx=txByJob.get(job.id);
    return {jobId:job.id,title:job.title,classification:classifyJob(job),creatorId:job.creatorId,workerId:job.workerId,reward:job.reward,asset:job.paymentAsset,network:job.paymentNetwork,paidAt:job.paidAt,workerTxHash:tx?.reference||job.settlementTxHash||null,feeTxHash:tx?.feeReference||job.feeTxHash||null,payerAddress:tx?.payerAddress||job.payerAddress||null,payeeAddress:tx?.payeeAddress||job.payeeAddress||null,feeAmount:tx?.feeAmount??null};
  }).sort((a,b)=>new Date(b.paidAt||0)-new Date(a.paidAt||0));
}
export function growthRegistry(){
  return {verifiedOrganicOperators:Object.entries(verifiedOrganicOperators).map(([agentId,v])=>({agentId,...v})),internalAgentIds:[...INTERNAL_AGENT_IDS],policy:'Entries are added only after independent-operation evidence is reviewed. Empty means no external operator has yet been verified for organic statistics.'};
}
