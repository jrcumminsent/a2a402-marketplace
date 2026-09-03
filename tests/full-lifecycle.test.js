import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy } from '../apps/api/src/economy.js';
import { submitBid, selectBid, getContract } from '../apps/api/src/contracts.js';
import { deliverArtifact, getDelivery } from '../apps/api/src/artifacts.js';
import { evaluateDelivery } from '../apps/api/src/evaluations.js';
import { buildEconomicGraph } from '../apps/api/src/economic-graph.js';

const wallet=address=>[{chain:'eip155:8453',address,assets:['A2A'],walletType:'agent-controlled'}];

test('discover -> register -> create -> bid -> contract -> artifact -> delivery -> evaluate -> settle -> reputation -> downstream job',async()=>{
  const e=new Economy();
  const creator=e.registerAgent({name:'Lifecycle Creator',description:'creates useful research work',endpoint:'https://creator.example/a2a',capabilities:['coordination'],wallets:wallet('0x1111111111111111111111111111111111111111')});
  const worker=e.registerAgent({name:'Lifecycle Worker',description:'does research and can hire follow-on work',endpoint:'https://worker.example/a2a',capabilities:['research'],wallets:wallet('0x2222222222222222222222222222222222222222')});
  const downstreamWorker=e.registerAgent({name:'Lifecycle Downstream Worker',description:'verifies follow-on results',endpoint:'https://downstream.example/a2a',capabilities:['verification'],wallets:wallet('0x3333333333333333333333333333333333333333')});
  assert.ok(e.searchAgents({requiredCapability:'research'}).some(x=>x.agentId===worker.id));

  const job=e.createJob({creatorId:creator.id,title:'Research evidence',description:'Return a concise evidence package',requiredCapability:'research',reward:10,paymentAsset:'A2A',paymentNetwork:'base',verificationMethod:'deterministic',input:{purpose:'a2a402-economy',task:'research'}});
  const bid=submitBid(e,job.id,worker.id,{amount:10,message:'I can deliver a structured evidence package.',idempotencyKey:'bid-lifecycle-1'});
  assert.equal(submitBid(e,job.id,worker.id,{amount:10,idempotencyKey:'bid-lifecycle-1'}).id,bid.id);
  const selected=selectBid(e,bid.id,creator.id,{idempotencyKey:'select-lifecycle-1'});
  assert.equal(selectBid(e,bid.id,creator.id,{idempotencyKey:'select-lifecycle-1'}).contract.id,selected.contract.id);
  assert.equal(selected.contract.status,'ACTIVE');

  const deliveryResult=deliverArtifact(e,selected.contract.id,worker.id,{name:'evidence.json',mimeType:'application/json',summary:'Completed research package',content:{ok:true,findings:[{claim:'A2A402 lifecycle proof',confidence:1}],sourceCount:1},idempotencyKey:'delivery-lifecycle-1'});
  assert.equal(deliverArtifact(e,selected.contract.id,worker.id,{content:{ignored:true},idempotencyKey:'delivery-lifecycle-1'}).delivery.id,deliveryResult.delivery.id);

  const evaluated=await evaluateDelivery(e,deliveryResult.delivery.id,creator.id,{accepted:true,qualityScore:96,reason:'Meets the requested deterministic acceptance criteria.',evidence:{artifactSha256:deliveryResult.artifact.sha256},idempotencyKey:'evaluation-lifecycle-1'});
  assert.equal((await evaluateDelivery(e,deliveryResult.delivery.id,creator.id,{accepted:true,qualityScore:96,idempotencyKey:'evaluation-lifecycle-1'})).evaluation.id,evaluated.evaluation.id);
  assert.equal(e.jobs.get(job.id).status,'AWAITING_PAYMENT');

  const treasury='0x4444444444444444444444444444444444444444';
  const settled=e.settleA2AJob(job.id,creator.id,{worker:{txHash:'0x'+'a'.repeat(64),from:job.payerAddress,to:job.payeeAddress,amountUnits:job.workerPaymentUnits,blockNumber:100},fee:{txHash:'0x'+'b'.repeat(64),from:job.payerAddress,to:treasury,amountUnits:job.marketplaceFeeUnits,blockNumber:101}});
  assert.equal(settled.job.status,'PAID');
  assert.equal(getContract(e,selected.contract.id,creator.id).status,'SETTLED');
  assert.equal(getDelivery(e,deliveryResult.delivery.id,worker.id).status,'ACCEPTED');
  const rep=e.reputations.get(worker.id);assert.equal(rep.jobsCompleted,1);assert.equal(rep.successfulJobs,1);assert.equal(rep.evaluationsReceived,1);assert.equal(rep.averageQualityScore,96);

  const downstream=e.createJob({creatorId:worker.id,title:'Verify earned-work evidence',description:'Verify the evidence package created in the parent job',requiredCapability:'verification',reward:1,paymentAsset:'A2A',paymentNetwork:'base',parentJobId:job.id,spawnedByJobId:job.id,input:{purpose:'a2a402-economy',parentArtifactId:deliveryResult.artifact.id}});
  assert.ok(e.searchAgents({requiredCapability:'verification'}).some(x=>x.agentId===downstreamWorker.id));
  const graph=buildEconomicGraph(e);assert.ok(graph.nodes.some(n=>n.id===bid.id&&n.type==='bid'));assert.ok(graph.nodes.some(n=>n.id===selected.contract.id&&n.type==='contract'));assert.ok(graph.nodes.some(n=>n.id===deliveryResult.artifact.id&&n.type==='artifact'));assert.ok(graph.nodes.some(n=>n.id===deliveryResult.delivery.id&&n.type==='delivery'));assert.ok(graph.nodes.some(n=>n.id===evaluated.evaluation.id&&n.type==='evaluation'));assert.ok(graph.edges.some(edge=>edge.type==='SPAWNED_JOB'&&edge.from===job.id&&edge.to===downstream.id));assert.equal(graph.metrics.downstreamJobs,1);
});

test('conflicting or unauthenticated replays remain blocked',async()=>{
  const e=new Economy();
  const creator=e.registerAgent({name:'Creator',description:'creator',endpoint:'https://creator.example/a2a',capabilities:['coordination'],wallets:wallet('0x5555555555555555555555555555555555555555')});
  const worker=e.registerAgent({name:'Worker',description:'worker',endpoint:'https://worker.example/a2a',capabilities:['research'],wallets:wallet('0x6666666666666666666666666666666666666666')});
  const outsider=e.registerAgent({name:'Outsider',description:'outsider',endpoint:'https://outsider.example/a2a',capabilities:['research'],wallets:wallet('0x7777777777777777777777777777777777777777')});
  const job=e.createJob({creatorId:creator.id,title:'Replay proof',description:'test replay protection',requiredCapability:'research',reward:2,paymentAsset:'A2A',paymentNetwork:'base'});
  const bid=submitBid(e,job.id,worker.id,{amount:2});assert.throws(()=>selectBid(e,bid.id,outsider.id),/only job creator/);const {contract}=selectBid(e,bid.id,creator.id);assert.throws(()=>selectBid(e,bid.id,creator.id),/bid not open/);
  const {delivery}=deliverArtifact(e,contract.id,worker.id,{content:{ok:true}});assert.throws(()=>deliverArtifact(e,contract.id,worker.id,{content:{ok:true}}),/active delivery/);
  await assert.rejects(()=>evaluateDelivery(e,delivery.id,outsider.id,{accepted:true,qualityScore:100}),/not authorized|only contract creator/);await evaluateDelivery(e,delivery.id,creator.id,{accepted:true,qualityScore:90});await assert.rejects(()=>evaluateDelivery(e,delivery.id,creator.id,{accepted:true,qualityScore:90}),/not awaiting evaluation|already evaluated/);
});
