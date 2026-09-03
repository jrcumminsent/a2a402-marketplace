import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy } from '../apps/api/src/economy.js';
import { submitBid, selectBid } from '../apps/api/src/contracts.js';
import { deliverArtifact } from '../apps/api/src/artifacts.js';
import { evaluateDelivery } from '../apps/api/src/evaluations.js';
import { buildEconomicGraph } from '../apps/api/src/economic-graph.js';

const wallet=address=>[{chain:'eip155:8453',address,assets:['A2A']}];

function fixture(){
  const economy=new Economy();
  const creator=economy.registerAgent({name:'Creator',description:'creates work',endpoint:'https://creator.example/a2a',capabilities:['coordination'],wallets:wallet('0x1111111111111111111111111111111111111111')});
  const worker=economy.registerAgent({name:'Worker',description:'does research',endpoint:'https://worker.example/a2a',capabilities:['research'],wallets:wallet('0x2222222222222222222222222222222222222222')});
  const job=economy.createJob({creatorId:creator.id,title:'Research task',description:'Research evidence',requiredCapability:'research',reward:10,paymentAsset:'A2A',paymentNetwork:'base'});
  const bid=submitBid(economy,job.id,worker.id,{amount:10});
  const {contract}=selectBid(economy,bid.id,creator.id);
  return {economy,creator,worker,job,bid,contract};
}

test('graph exposes job bid contract artifact delivery evaluation chain',async()=>{
  const {economy,creator,worker,job,bid,contract}=fixture();
  const {delivery,artifact}=deliverArtifact(economy,contract.id,worker.id,{content:'verified work',mimeType:'text/plain'});
  const {evaluation}=await evaluateDelivery(economy,delivery.id,creator.id,{accepted:true,qualityScore:94,reason:'Meets requirements'});
  const graph=buildEconomicGraph(economy);
  const ids=new Set(graph.nodes.map(n=>n.id));
  for(const object of [creator,worker,job,bid,contract,artifact,delivery,evaluation])assert.ok(ids.has(object.id));
  const types=new Set(graph.nodes.map(n=>n.type));
  for(const type of ['agent','job','bid','contract','artifact','delivery','evaluation'])assert.ok(types.has(type));
  const relationships=new Set(graph.edges.map(e=>e.type));
  for(const type of ['CREATED_JOB','SUBMITTED_BID','BID_ON_JOB','BECAME_CONTRACT','PRODUCED_ARTIFACT','DELIVERED_AS','RECEIVED_EVALUATION','AFFECTS_REPUTATION'])assert.ok(relationships.has(type));
  assert.equal(graph.metrics.contracts,1);
  assert.equal(graph.metrics.deliveries,1);
  assert.equal(graph.metrics.evaluations,1);
  assert.equal(graph.metrics.agentToAgentRelationships,1);
  assert.equal(graph.metrics.averageQualityScore,94);
  assert.equal(graph.metrics.acceptedEvaluationRate,1);
});

test('graph counts downstream jobs and unique economic relationships',()=>{
  const {economy,creator,worker,job}=fixture();
  economy.createJob({creatorId:worker.id,title:'Verification follow-up',description:'Verify upstream result',requiredCapability:'coordination',reward:1,paymentAsset:'A2A',paymentNetwork:'base',parentJobId:job.id,spawnedByJobId:job.id});
  const graph=buildEconomicGraph(economy);
  assert.equal(graph.metrics.downstreamJobs,1);
  assert.ok(graph.edges.some(e=>e.type==='SPAWNED_JOB'));
  assert.equal(graph.metrics.agentToAgentRelationships,1);
});
