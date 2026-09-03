import { id, now, assert } from '../../../packages/protocol/src/index.js';
import { getContract } from './contracts.js';
import { getDelivery, syncDeliveryFromJob } from './artifacts.js';
import { recordEvaluation } from '../../../packages/reputation/src/index.js';

function ensureCollections(economy){
  if(!(economy.evaluations instanceof Map)) economy.evaluations=new Map();
  return economy;
}

function normalizeScore(value){
  const score=Number(value);
  assert(Number.isFinite(score)&&score>=0&&score<=100,'qualityScore must be between 0 and 100');
  return Math.round(score*100)/100;
}

export async function evaluateDelivery(economy,deliveryId,evaluatorId,input={}){
  ensureCollections(economy);
  const delivery=getDelivery(economy,deliveryId,evaluatorId);
  const contract=getContract(economy,delivery.contractId,evaluatorId);
  assert(contract.creatorId===evaluatorId,'only contract creator may evaluate delivery');
  assert(delivery.status==='SUBMITTED','delivery is not awaiting evaluation');
  assert(![...economy.evaluations.values()].some(e=>e.deliveryId===deliveryId&&e.status==='FINAL'),'delivery already evaluated');

  const accepted=input.accepted!==false;
  const qualityScore=normalizeScore(input.qualityScore ?? (accepted?100:0));
  const reason=input.reason==null?null:String(input.reason).slice(0,4000);
  const evidence=input.evidence&&typeof input.evidence==='object'?input.evidence:{};

  const job=await economy.verifyJob(delivery.jobId,evaluatorId,{accepted});
  const synced=syncDeliveryFromJob(economy,deliveryId);
  const evaluation={
    id:id('evaluation'),
    deliveryId,
    artifactId:delivery.artifactId,
    contractId:delivery.contractId,
    jobId:delivery.jobId,
    evaluatorId,
    workerId:delivery.workerId,
    accepted,
    qualityScore,
    reason,
    evidence,
    verificationMethod:job.verificationMethod,
    status:'FINAL',
    createdAt:now(),
    finalizedAt:now(),
  };

  economy.evaluations.set(evaluation.id,evaluation);
  delivery.evaluationId=evaluation.id;
  contract.evaluationId=evaluation.id;
  const reputation=economy.reputations.get(delivery.workerId);
  if(reputation) recordEvaluation(reputation,{qualityScore,accepted,evaluatorId,jobId:delivery.jobId,deliveryId,evaluationId:evaluation.id});
  economy.event('DELIVERY_EVALUATED',{evaluationId:evaluation.id,deliveryId,artifactId:delivery.artifactId,contractId:delivery.contractId,jobId:delivery.jobId,evaluatorId,workerId:delivery.workerId,accepted,qualityScore});
  return {evaluation,delivery:synced,contract,job,reputation};
}

export function getEvaluation(economy,evaluationId,requesterId){
  ensureCollections(economy);
  const evaluation=economy.evaluations.get(evaluationId);
  assert(evaluation,'evaluation not found');
  getContract(economy,evaluation.contractId,requesterId);
  return evaluation;
}

export function listContractEvaluations(economy,contractId,requesterId){
  ensureCollections(economy);
  getContract(economy,contractId,requesterId);
  return [...economy.evaluations.values()].filter(e=>e.contractId===contractId);
}

export function listAgentEvaluations(economy,agentId,requesterId){
  ensureCollections(economy);
  assert(agentId===requesterId,'agent mismatch');
  return [...economy.evaluations.values()].filter(e=>e.workerId===agentId||e.evaluatorId===agentId);
}
