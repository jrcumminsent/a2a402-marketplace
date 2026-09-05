function values(mapLike){return mapLike?.values?[...mapLike.values()]:[]}
function addNode(nodes,seen,node){if(!node?.id||seen.has(node.id))return;seen.add(node.id);nodes.push(node)}
function addEdge(edges,seen,from,to,type,meta={}){if(!from||!to)return;const key=`${from}|${to}|${type}|${meta.id||''}`;if(seen.has(key))return;seen.add(key);edges.push({from,to,type,...meta})}
function isLegacyTestRecord(record){const asset=String(record?.paymentAsset||record?.asset||'').toUpperCase();const network=String(record?.paymentNetwork||record?.network||record?.chain||'').toLowerCase();return asset==='USDC_TEST'||network==='base-sepolia'||network==='eip155:84532'}
function isInternalAgent(agent){
  const id=String(agent?.id||'');
  const name=String(agent?.name||'').toLowerCase();
  if(/^agent_(?:[1-9]|10)$/.test(id))return true;
  return name.includes('canary')||name.includes('reference autonomous agent')||name.includes('autonomous payer')||name.includes('a2a402-operated')||name.includes('broker agent');
}

export function buildEconomicGraph(economy,{includeLegacy=false,includeInternal=false}={}){
  const nodes=[],edges=[],nodeSeen=new Set(),edgeSeen=new Set();
  const allAgents=values(economy.agents);
  const agents=includeInternal?allAgents:allAgents.filter(a=>!isInternalAgent(a));
  const visibleAgentIds=new Set(agents.map(a=>a.id));
  const allJobs=values(economy.jobs),jobs=includeLegacy?allJobs:allJobs.filter(j=>!isLegacyTestRecord(j));
  const visibleJobIds=new Set(jobs.map(j=>j.id));
  const allBids=values(economy.bids),bids=allBids.filter(b=>visibleJobIds.has(b.jobId));
  const allContracts=values(economy.contracts),contracts=allContracts.filter(c=>visibleJobIds.has(c.jobId));
  const visibleContractIds=new Set(contracts.map(c=>c.id));
  const artifacts=values(economy.artifacts).filter(a=>visibleContractIds.has(a.contractId));
  const deliveries=values(economy.deliveries).filter(d=>visibleContractIds.has(d.contractId));
  const visibleDeliveryIds=new Set(deliveries.map(d=>d.id));
  const evaluations=values(economy.evaluations).filter(e=>visibleDeliveryIds.has(e.deliveryId));
  const allTransactions=Array.isArray(economy.transactions)?economy.transactions:[];
  const transactions=(includeLegacy?allTransactions:allTransactions.filter(tx=>!isLegacyTestRecord(tx))).filter(tx=>!tx.jobId||visibleJobIds.has(tx.jobId));

  for(const agent of agents){
    const rep=economy.reputations?.get?.(agent.id)||null;
    addNode(nodes,nodeSeen,{id:agent.id,type:'agent',label:agent.name||agent.id,status:agent.status||null,capabilities:(agent.capabilities||[]).map(c=>c.name),reputation:rep?{successRate:Number(rep.successRate||0),averageQualityScore:Number(rep.averageQualityScore||0),jobsCompleted:Number(rep.jobsCompleted||0)}:null});
  }
  for(const job of jobs){
    addNode(nodes,nodeSeen,{id:job.id,type:'job',label:job.title||job.id,status:job.status,requiredCapability:job.requiredCapability,reward:Number(job.reward||0),paymentAsset:job.paymentAsset||null,parentJobId:job.parentJobId||null,rootJobId:job.rootJobId||null,classification:job.input?.classification||null,systemGenerated:Boolean(job.input?.systemGenerated)});
    if(includeInternal||visibleAgentIds.has(job.creatorId))addEdge(edges,edgeSeen,job.creatorId,job.id,'CREATED_JOB');
    if(job.workerId&&(includeInternal||visibleAgentIds.has(job.workerId)))addEdge(edges,edgeSeen,job.id,job.workerId,'ASSIGNED_TO');
    if(job.parentJobId&&visibleJobIds.has(job.parentJobId))addEdge(edges,edgeSeen,job.parentJobId,job.id,'SPAWNED_JOB');
  }
  for(const bid of bids){
    addNode(nodes,nodeSeen,{id:bid.id,type:'bid',label:`Bid ${Number(bid.amount||0)} ${bid.paymentAsset||''}`.trim(),status:bid.status,amount:Number(bid.amount||0),paymentAsset:bid.paymentAsset||null});
    if(includeInternal||visibleAgentIds.has(bid.bidderId))addEdge(edges,edgeSeen,bid.bidderId,bid.id,'SUBMITTED_BID');
    addEdge(edges,edgeSeen,bid.id,bid.jobId,'BID_ON_JOB');
  }
  for(const contract of contracts){
    addNode(nodes,nodeSeen,{id:contract.id,type:'contract',label:`Contract ${contract.id.slice(-8)}`,status:contract.status,amount:Number(contract.amount||0),paymentAsset:contract.paymentAsset||null});
    addEdge(edges,edgeSeen,contract.jobId,contract.id,'BECAME_CONTRACT');
    if(includeInternal||visibleAgentIds.has(contract.creatorId))addEdge(edges,edgeSeen,contract.creatorId,contract.id,'HIRED_UNDER');
    if(includeInternal||visibleAgentIds.has(contract.workerId))addEdge(edges,edgeSeen,contract.id,contract.workerId,'WORKER');
    if(contract.bidId)addEdge(edges,edgeSeen,contract.bidId,contract.id,'SELECTED_AS');
  }
  for(const artifact of artifacts){
    addNode(nodes,nodeSeen,{id:artifact.id,type:'artifact',label:artifact.name||artifact.mimeType||`Artifact ${artifact.id.slice(-8)}`,status:artifact.status,mimeType:artifact.mimeType||null,sha256:artifact.sha256||null});
    if(includeInternal||visibleAgentIds.has(artifact.ownerAgentId))addEdge(edges,edgeSeen,artifact.ownerAgentId,artifact.id,'CREATED_ARTIFACT');
    addEdge(edges,edgeSeen,artifact.contractId,artifact.id,'PRODUCED_ARTIFACT');
  }
  for(const delivery of deliveries){
    addNode(nodes,nodeSeen,{id:delivery.id,type:'delivery',label:`Delivery ${delivery.id.slice(-8)}`,status:delivery.status,artifactSha256:delivery.artifactSha256||null});
    addEdge(edges,edgeSeen,delivery.artifactId,delivery.id,'DELIVERED_AS');
    addEdge(edges,edgeSeen,delivery.id,delivery.contractId,'FULFILLS_CONTRACT');
    if(includeInternal||visibleAgentIds.has(delivery.workerId))addEdge(edges,edgeSeen,delivery.workerId,delivery.id,'SUBMITTED_DELIVERY');
  }
  for(const evaluation of evaluations){
    addNode(nodes,nodeSeen,{id:evaluation.id,type:'evaluation',label:`Evaluation ${Number(evaluation.qualityScore||0)}/100`,status:evaluation.status,accepted:Boolean(evaluation.accepted),qualityScore:Number(evaluation.qualityScore||0)});
    addEdge(edges,edgeSeen,evaluation.deliveryId,evaluation.id,'RECEIVED_EVALUATION');
    if(includeInternal||visibleAgentIds.has(evaluation.evaluatorId))addEdge(edges,edgeSeen,evaluation.evaluatorId,evaluation.id,'EVALUATED');
    if(includeInternal||visibleAgentIds.has(evaluation.workerId))addEdge(edges,edgeSeen,evaluation.id,evaluation.workerId,'AFFECTS_REPUTATION');
  }
  for(const tx of transactions){
    const txId=tx.id||tx.txHash||tx.hash;
    if(!txId)continue;
    addNode(nodes,nodeSeen,{id:txId,type:'transaction',label:`${Number(tx.amount||tx.reward||0)} ${tx.asset||tx.paymentAsset||'A2A'}`,status:tx.status||'SETTLED',amount:Number(tx.amount||tx.reward||0),asset:tx.asset||tx.paymentAsset||'A2A',txHash:tx.txHash||tx.hash||null});
    const payer=tx.fromAgentId||tx.payerId||tx.creatorId||tx.from;
    const payee=tx.toAgentId||tx.payeeId||tx.workerId||tx.to;
    const jobId=tx.jobId||null;
    if(payer&&(includeInternal||visibleAgentIds.has(payer)))addEdge(edges,edgeSeen,payer,txId,'PAID');
    if(payee&&(includeInternal||visibleAgentIds.has(payee)))addEdge(edges,edgeSeen,txId,payee,'PAID_TO');
    if(jobId)addEdge(edges,edgeSeen,jobId,txId,'SETTLED_BY');
  }

  const publicContracts=includeInternal?contracts:contracts.filter(c=>visibleAgentIds.has(c.creatorId)&&visibleAgentIds.has(c.workerId));
  const settledContracts=publicContracts.filter(c=>c.status==='SETTLED').length;
  const evaluatedDeliveries=evaluations.length;
  const agentToAgentRelationships=new Set(publicContracts.map(c=>`${c.creatorId}->${c.workerId}`)).size;
  const downstreamJobs=jobs.filter(j=>j.parentJobId||j.spawnedByJobId).length;
  const acceptedEvaluations=evaluations.filter(e=>e.accepted).length;
  const totalQuality=evaluations.reduce((sum,e)=>sum+Number(e.qualityScore||0),0);

  return {
    version:'2.0',
    generatedAt:new Date().toISOString(),
    legacyTestDataExcluded:!includeLegacy,
    internalAgentsExcluded:!includeInternal,
    nodes,
    edges,
    metrics:{
      agents:agents.length,
      jobs:jobs.length,
      bids:bids.length,
      contracts:publicContracts.length,
      artifacts:artifacts.length,
      deliveries:deliveries.length,
      evaluations:evaluations.length,
      transactions:transactions.length,
      settledContracts,
      evaluatedDeliveries,
      agentToAgentRelationships,
      downstreamJobs,
      acceptedEvaluationRate:evaluatedDeliveries?acceptedEvaluations/evaluatedDeliveries:0,
      averageQualityScore:evaluatedDeliveries?totalQuality/evaluatedDeliveries:0,
    },
    relationshipTypes:[...new Set(edges.map(e=>e.type))].sort(),
  };
}
