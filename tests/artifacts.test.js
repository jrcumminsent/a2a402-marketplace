import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy } from '../apps/api/src/economy.js';
import { submitBid, selectBid } from '../apps/api/src/contracts.js';
import { createArtifact, deliverArtifact, getArtifact, getDelivery, listContractDeliveries, syncDeliveryFromJob } from '../apps/api/src/artifacts.js';

const wallet=address=>[{chain:'eip155:8453',address,assets:['A2A']}];
function fixture(){
  const economy=new Economy();
  const creator=economy.registerAgent({name:'Creator',description:'creates',endpoint:'https://creator.example/a2a',capabilities:['coordination'],wallets:wallet('0x1111111111111111111111111111111111111111')});
  const worker=economy.registerAgent({name:'Worker',description:'researches',endpoint:'https://worker.example/a2a',capabilities:['research'],wallets:wallet('0x2222222222222222222222222222222222222222')});
  const job=economy.createJob({creatorId:creator.id,title:'Research',description:'Do research',requiredCapability:'research',reward:10,paymentAsset:'A2A',paymentNetwork:'base'});
  const bid=submitBid(economy,job.id,worker.id,{amount:10});
  const {contract}=selectBid(economy,bid.id,creator.id);
  return {economy,creator,worker,job,contract};
}

test('contract worker can store inline artifact with deterministic sha256',()=>{
  const {economy,worker,contract}=fixture();
  const artifact=createArtifact(economy,contract.id,worker.id,{name:'report.json',mimeType:'application/json',content:{answer:42}});
  assert.equal(artifact.contractId,contract.id);
  assert.equal(artifact.status,'STORED');
  assert.equal(artifact.sha256.length,64);
  assert.deepEqual(getArtifact(economy,artifact.id,worker.id).content,{answer:42});
});

test('external artifact requires sha256',()=>{
  const {economy,worker,contract}=fixture();
  assert.throws(()=>createArtifact(economy,contract.id,worker.id,{uri:'https://example.com/result.json'}),/requires sha256/);
});

test('delivery links artifact, contract, and job submission',()=>{
  const {economy,creator,worker,job,contract}=fixture();
  const artifact=createArtifact(economy,contract.id,worker.id,{content:'completed work',mimeType:'text/plain'});
  const result=deliverArtifact(economy,contract.id,worker.id,{artifactId:artifact.id,summary:'done'});
  assert.equal(result.delivery.status,'SUBMITTED');
  assert.equal(result.delivery.artifactId,artifact.id);
  assert.equal(economy.jobs.get(job.id).result.artifactId,artifact.id);
  assert.equal(economy.artifacts.get(artifact.id).status,'DELIVERED');
  assert.equal(listContractDeliveries(economy,contract.id,creator.id).length,1);
  assert.equal(getDelivery(economy,result.delivery.id,worker.id).id,result.delivery.id);
});

test('creator acceptance of job synchronizes delivery acceptance',async()=>{
  const {economy,creator,worker,job,contract}=fixture();
  const {delivery}=deliverArtifact(economy,contract.id,worker.id,{content:'accepted result',mimeType:'text/plain'});
  await economy.verifyJob(job.id,creator.id,{accepted:true});
  const synced=syncDeliveryFromJob(economy,delivery.id);
  assert.equal(synced.status,'ACCEPTED');
  assert.ok(synced.acceptedAt);
});

test('unrelated agent cannot read artifact',()=>{
  const {economy,worker,contract}=fixture();
  const outsider=economy.registerAgent({name:'Outsider',description:'other',endpoint:'https://outside.example/a2a',capabilities:['research'],wallets:wallet('0x3333333333333333333333333333333333333333')});
  const artifact=createArtifact(economy,contract.id,worker.id,{content:'private deliverable'});
  assert.throws(()=>getArtifact(economy,artifact.id,outsider.id),/not authorized/);
});
