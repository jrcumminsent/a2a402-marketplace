import crypto from 'node:crypto';
import { id, now, assert } from '../../../packages/protocol/src/index.js';
import { getContract, syncContractFromJob } from './contracts.js';

const SHA256=/^[a-fA-F0-9]{64}$/;
const MAX_INLINE_BYTES=256_000;

function ensureCollections(economy){
  if(!(economy.artifacts instanceof Map)) economy.artifacts=new Map();
  if(!(economy.deliveries instanceof Map)) economy.deliveries=new Map();
  return economy;
}

function byteLength(value){return Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value),'utf8')}
function hashInline(value){return crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex')}

export function createArtifact(economy, contractId, workerId, input={}){
  ensureCollections(economy);
  const contract=getContract(economy,contractId,workerId);
  assert(contract.workerId===workerId,'only contract worker may create artifact');
  assert(contract.status==='ACTIVE','contract not active');
  assert(input.content!==undefined||input.uri,'artifact content or uri required');
  assert(!(input.content!==undefined&&input.uri),'artifact must use inline content or uri, not both');

  let sha256,sizeBytes=null,content=null,uri=null;
  if(input.content!==undefined){
    sizeBytes=byteLength(input.content);
    assert(sizeBytes<=MAX_INLINE_BYTES,`inline artifact exceeds ${MAX_INLINE_BYTES} bytes`);
    content=input.content;
    sha256=hashInline(content);
  }else{
    uri=String(input.uri).trim();
    assert(/^https?:\/\//i.test(uri),'artifact uri must be http(s)');
    assert(SHA256.test(String(input.sha256||'')),'external artifact requires sha256');
    sha256=String(input.sha256).toLowerCase();
  }

  const artifact={
    id:id('artifact'),
    contractId,
    jobId:contract.jobId,
    ownerAgentId:workerId,
    creatorAgentId:workerId,
    mimeType:String(input.mimeType||'application/json').slice(0,200),
    name:input.name?String(input.name).slice(0,300):null,
    description:input.description?String(input.description).slice(0,2000):null,
    content,
    uri,
    sha256,
    sizeBytes,
    status:'STORED',
    createdAt:now(),
    deliveredAt:null,
  };
  economy.artifacts.set(artifact.id,artifact);
  economy.event('ARTIFACT_STORED',{artifactId:artifact.id,contractId,jobId:contract.jobId,agentId:workerId,mimeType:artifact.mimeType,sha256});
  return artifact;
}

export function deliverArtifact(economy, contractId, workerId, input={}){
  ensureCollections(economy);
  const contract=getContract(economy,contractId,workerId);
  assert(contract.workerId===workerId,'only contract worker may deliver');
  assert(contract.status==='ACTIVE','contract not active');
  assert(![...economy.deliveries.values()].some(d=>d.contractId===contractId&&['SUBMITTED','ACCEPTED'].includes(d.status)),'contract already has an active delivery');

  let artifact;
  if(input.artifactId){
    artifact=economy.artifacts.get(String(input.artifactId));
    assert(artifact,'artifact not found');
    assert(artifact.contractId===contractId,'artifact belongs to another contract');
    assert(artifact.ownerAgentId===workerId,'artifact belongs to another agent');
    assert(artifact.status==='STORED','artifact not available for delivery');
  }else{
    artifact=createArtifact(economy,contractId,workerId,input.artifact||input);
  }

  const submittedResult={
    artifactId:artifact.id,
    sha256:artifact.sha256,
    mimeType:artifact.mimeType,
    uri:artifact.uri,
    name:artifact.name,
    summary:input.summary?String(input.summary).slice(0,4000):null,
  };
  const job=economy.submitJob(contract.jobId,workerId,submittedResult);
  const delivery={
    id:id('delivery'),
    contractId,
    jobId:contract.jobId,
    artifactId:artifact.id,
    creatorId:contract.creatorId,
    workerId,
    status:'SUBMITTED',
    summary:submittedResult.summary,
    artifactSha256:artifact.sha256,
    createdAt:now(),
    submittedAt:now(),
    evaluatedAt:null,
    acceptedAt:null,
    rejectedAt:null,
  };
  artifact.status='DELIVERED';
  artifact.deliveredAt=delivery.submittedAt;
  economy.deliveries.set(delivery.id,delivery);
  contract.deliveryId=delivery.id;
  contract.artifactId=artifact.id;
  economy.event('ARTIFACT_DELIVERED',{deliveryId:delivery.id,artifactId:artifact.id,contractId,jobId:contract.jobId,workerId});
  return {delivery,artifact,contract,job};
}

export function syncDeliveryFromJob(economy,deliveryId){
  ensureCollections(economy);
  const delivery=economy.deliveries.get(deliveryId);
  if(!delivery)return null;
  const job=economy.jobs.get(delivery.jobId);
  if(!job)return delivery;
  const accepted=['AWAITING_PAYMENT','COMPLETED','PAID'].includes(job.status);
  const rejected=['REJECTED','FAILED','CANCELLED'].includes(job.status);
  if(accepted&&delivery.status==='SUBMITTED'){
    delivery.status='ACCEPTED';delivery.evaluatedAt=now();delivery.acceptedAt=delivery.evaluatedAt;
    economy.event('DELIVERY_ACCEPTED',{deliveryId:delivery.id,artifactId:delivery.artifactId,contractId:delivery.contractId,jobId:delivery.jobId});
  }else if(rejected&&delivery.status==='SUBMITTED'){
    delivery.status='REJECTED';delivery.evaluatedAt=now();delivery.rejectedAt=delivery.evaluatedAt;
    economy.event('DELIVERY_REJECTED',{deliveryId:delivery.id,artifactId:delivery.artifactId,contractId:delivery.contractId,jobId:delivery.jobId});
  }
  syncContractFromJob(economy,delivery.jobId);
  return delivery;
}

export function getArtifact(economy,artifactId,requesterId){
  ensureCollections(economy);
  const artifact=economy.artifacts.get(artifactId);
  assert(artifact,'artifact not found');
  const contract=getContract(economy,artifact.contractId,requesterId);
  assert(requesterId===contract.creatorId||requesterId===contract.workerId,'not authorized for artifact');
  return artifact;
}

export function getDelivery(economy,deliveryId,requesterId){
  ensureCollections(economy);
  const delivery=economy.deliveries.get(deliveryId);
  assert(delivery,'delivery not found');
  getContract(economy,delivery.contractId,requesterId);
  return syncDeliveryFromJob(economy,deliveryId);
}

export function listContractDeliveries(economy,contractId,requesterId){
  ensureCollections(economy);
  getContract(economy,contractId,requesterId);
  return [...economy.deliveries.values()].filter(d=>d.contractId===contractId).map(d=>syncDeliveryFromJob(economy,d.id)||d);
}
