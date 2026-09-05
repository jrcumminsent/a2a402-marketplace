import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy } from '../apps/api/src/economy.js';
import { buildEconomicGraph } from '../apps/api/src/economic-graph.js';
import { isInternalAgent, isInternalHistoryJob, isPromotionalJob } from '../apps/api/src/public-classification.js';

const wallet=address=>[{chain:'eip155:8453',address,assets:['A2A']}];

test('operator-controlled worker names are internal',()=>{
  for(const name of ['A2A Canary Worker 1','A2A402 Reference Autonomous Agent','A2A402 Autonomous Payer v2','A2A402 Autonomous Worker','A2A402 Background Worker']){
    assert.equal(isInternalAgent({id:'agent_external_shape',name}),true,name);
  }
  assert.equal(isInternalAgent({id:'agent_external_shape',name:'Independent Research Agent'}),false);
});

test('public graph excludes internal settlement history but preserves labeled Genesis work',()=>{
  const economy=new Economy();
  const internalCreator=economy.registerAgent({id:'agent_internal_creator',name:'A2A402 Autonomous Payer v2',description:'operator payer',endpoint:'https://internal.example/a2a',capabilities:['broker'],wallets:wallet('0x1111111111111111111111111111111111111111')});
  const internalWorker=economy.registerAgent({id:'agent_internal_worker',name:'A2A402 Background Worker',description:'operator worker',endpoint:'https://internal-worker.example/a2a',capabilities:['research'],wallets:wallet('0x2222222222222222222222222222222222222222')});
  const genesisCreator=economy.registerAgent({id:'agent_10',name:'Broker Agent',description:'bootstrap creator',endpoint:'https://bootstrap.example/a2a',capabilities:['broker'],wallets:wallet('0x3333333333333333333333333333333333333333')});
  const internalJob=economy.createJob({creatorId:internalCreator.id,title:'Final background autonomous settlement proof',description:'historical operator proof',requiredCapability:'research',reward:1,paymentAsset:'A2A',paymentNetwork:'base'});
  internalJob.workerId=internalWorker.id;internalJob.status='PAID';
  economy.transactions.push({id:'tx_internal',jobId:internalJob.id,payer:internalCreator.id,payee:internalWorker.id,asset:'A2A',network:'base',amount:0.95,feeAmount:0.05});
  const genesisJob=economy.createJob({creatorId:genesisCreator.id,title:'Genesis research task',description:'useful onboarding task',requiredCapability:'research',reward:1,paymentAsset:'A2A',paymentNetwork:'base',input:{program:'genesis-work-pool',systemGenerated:true,countsTowardOrganic:false,classification:'promotional'}});
  assert.equal(isInternalHistoryJob(economy,internalJob),true);
  assert.equal(isPromotionalJob(genesisJob),true);
  assert.equal(isInternalHistoryJob(economy,genesisJob),false);
  const graph=buildEconomicGraph(economy);
  const nodeIds=new Set(graph.nodes.map(node=>node.id));
  assert.equal(nodeIds.has(internalCreator.id),false);
  assert.equal(nodeIds.has(internalWorker.id),false);
  assert.equal(nodeIds.has(internalJob.id),false);
  assert.equal(nodeIds.has('tx_internal'),false);
  assert.equal(nodeIds.has(genesisJob.id),true);
  assert.equal(graph.metrics.paidJobs,0);
  assert.equal(graph.metrics.transactions,0);
  assert.equal(graph.internalAgentsExcluded,true);
  assert.equal(graph.version,'2.2');
});
