import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy } from '../apps/api/src/economy.js';
import { submitBid, selectBid } from '../apps/api/src/contracts.js';
import { deliverArtifact } from '../apps/api/src/artifacts.js';
import { evaluateDelivery, getEvaluation, listContractEvaluations, listAgentEvaluations } from '../apps/api/src/evaluations.js';

const wallet=address=>[{chain:'eip155:8453',address,assets:['A2A']}];
function fixture(){
  const economy=new Economy();
  const creator=economy.registerAgent({name:'Creator',description:'creates',endpoint:'https://creator.example/a2a',capabilities:['coordination'],wallets:wallet('0x1111111111111111111111111111111111111111')});
  const worker=economy.registerAgent({name:'Worker',description:'researches',endpoint:'https://worker.example/a2a',capabilities:['research'],wallets:wallet('0x2222222222222222222222222222222222222222')});
  const outsider=economy.registerAgent({name:'Outsider',description:'other',endpoint:'https://outside.example/a2a',capabilities:['research'],wallets:wallet('0x3333333333333333333333333333333333333333')});
  const job=economy.createJob({creatorId:creator.id,title:'Research',description:'Do research',requiredCapability:'research',reward:10,paymentAsset:'A2A',paymentNetwork:'base'});
  const bid=submitBid(economy,job.id,worker.id,{amount:10});
  const {contract}=selectBid(economy,bid.id,creator.id);
  const {delivery}=deliverArtifact(economy,contract.id,worker.id,{content:'evidence-backed report',mimeType:'text/plain'});
  return {economy,creator,worker,outsider,job,contract,delivery};
}

test('creator can evaluate submitted delivery and reputation records quality',async()=>{
  const {economy,creator,worker,job,contract,delivery}=fixture();
  const result=await evaluateDelivery(economy,delivery.id,creator.id,{accepted:true,qualityScore:92.5,reason:'Meets the requested evidence standard',evidence:{checks:['format','sources']}});
  assert.equal(result.evaluation.status,'FINAL');
  assert.equal(result.evaluation.qualityScore,92.5);
  assert.equal(result.delivery.status,'ACCEPTED');
  assert.equal(result.contract.evaluationId,result.evaluation.id);
  assert.equal(economy.jobs.get(job.id).status,'AWAITING_PAYMENT');
  const rep=economy.reputations.get(worker.id);
  assert.equal(rep.evaluationsReceived,1);
  assert.equal(rep.acceptedEvaluations,1);
  assert.equal(rep.averageQualityScore,92.5);
  assert.equal(getEvaluation(economy,result.evaluation.id,worker.id).id,result.evaluation.id);
  assert.equal(listContractEvaluations(economy,contract.id,creator.id).length,1);
  assert.equal(listAgentEvaluations(economy,worker.id,worker.id).length,1);
});

test('rejected evaluation is final and records rejection quality',async()=>{
  const {economy,creator,worker,delivery}=fixture();
  const result=await evaluateDelivery(economy,delivery.id,creator.id,{accepted:false,qualityScore:25,reason:'Missing required sections'});
  assert.equal(result.evaluation.accepted,false);
  assert.equal(result.delivery.status,'REJECTED');
  const rep=economy.reputations.get(worker.id);
  assert.equal(rep.evaluationsReceived,1);
  assert.equal(rep.rejectedEvaluations,1);
  assert.equal(rep.averageQualityScore,25);
});

test('only creator may evaluate and a delivery cannot be evaluated twice',async()=>{
  const {economy,creator,outsider,delivery}=fixture();
  await assert.rejects(()=>evaluateDelivery(economy,delivery.id,outsider.id,{accepted:true,qualityScore:80}),/not authorized|only contract creator/);
  await evaluateDelivery(economy,delivery.id,creator.id,{accepted:true,qualityScore:80});
  await assert.rejects(()=>evaluateDelivery(economy,delivery.id,creator.id,{accepted:true,qualityScore:90}),/not awaiting evaluation|already evaluated/);
});

test('quality score must be in range',async()=>{
  const {economy,creator,delivery}=fixture();
  await assert.rejects(()=>evaluateDelivery(economy,delivery.id,creator.id,{accepted:true,qualityScore:101}),/between 0 and 100/);
});
