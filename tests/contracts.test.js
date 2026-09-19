import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy } from '../apps/api/src/economy.js';
import { submitBid, withdrawBid, selectBid, listJobBids, getContract, listAgentContracts } from '../apps/api/src/contracts.js';

const wallet=(address)=>[{chain:'eip155:8453',address,assets:['A2A']}];

function fixture(){
  const economy=new Economy();
  const creator=economy.registerAgent({
    name:'Creator',description:'creates work',endpoint:'https://creator.example/a2a',
    capabilities:['coordination'],wallets:wallet('0x1111111111111111111111111111111111111111')
  });
  const worker=economy.registerAgent({
    name:'Worker',description:'does research',endpoint:'https://worker.example/a2a',
    capabilities:['research'],wallets:wallet('0x2222222222222222222222222222222222222222')
  });
  const worker2=economy.registerAgent({
    name:'Worker Two',description:'also does research',endpoint:'https://worker2.example/a2a',
    capabilities:['research'],wallets:wallet('0x3333333333333333333333333333333333333333')
  });
  const job=economy.createJob({
    creatorId:creator.id,title:'Research task',description:'Find and summarize evidence',requiredCapability:'research',
    reward:10,paymentAsset:'A2A',paymentNetwork:'base'
  });
  return {economy,creator,worker,worker2,job};
}

test('worker can submit and withdraw a bid',()=>{
  const {economy,worker,job}=fixture();
  const bid=submitBid(economy,job.id,worker.id,{amount:10,message:'I can do this'});
  assert.equal(bid.status,'OPEN');
  assert.equal(listJobBids(economy,job.id,worker.id).length,1);
  const withdrawn=withdrawBid(economy,bid.id,worker.id);
  assert.equal(withdrawn.status,'WITHDRAWN');
});

test('creator selecting bid creates contract and rejects competing bids',()=>{
  const {economy,creator,worker,worker2,job}=fixture();
  const first=submitBid(economy,job.id,worker.id,{amount:10});
  const second=submitBid(economy,job.id,worker2.id,{amount:10});
  const selected=selectBid(economy,first.id,creator.id);

  assert.equal(selected.bid.status,'SELECTED');
  assert.equal(selected.contract.status,'ACTIVE');
  assert.equal(selected.contract.creatorId,creator.id);
  assert.equal(selected.contract.workerId,worker.id);
  assert.equal(economy.jobs.get(job.id).workerId,worker.id);
  assert.equal(economy.jobs.get(job.id).contractId,selected.contract.id);
  assert.equal(economy.bids.get(second.id).status,'REJECTED');
  assert.equal(getContract(economy,selected.contract.id,worker.id).id,selected.contract.id);
  assert.equal(listAgentContracts(economy,creator.id).length,1);
  assert.equal(listAgentContracts(economy,worker.id).length,1);
});

test('creator cannot bid on own job and wrong creator cannot select',()=>{
  const {economy,creator,worker,worker2,job}=fixture();
  assert.throws(()=>submitBid(economy,job.id,creator.id,{amount:10}),/creator cannot bid/);
  const bid=submitBid(economy,job.id,worker.id,{amount:10});
  assert.throws(()=>selectBid(economy,bid.id,worker2.id),/only job creator/);
});

test('bid amount must match posted reward until variable-price settlement is supported',()=>{
  const {economy,worker,job}=fixture();
  assert.throws(()=>submitBid(economy,job.id,worker.id,{amount:9}),/must match posted reward/);
});
