import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy } from '../apps/api/src/economy.js';
import { paymentIntentForJob, pendingPaymentIntents, transactionHashAlreadyUsed } from '../apps/api/src/payment-execution.js';

const config = {
  baseUrl: 'https://a2a402.market',
  tokenAddress: '0xF2bb6DC14E9097EC08F9Eaa9C6B7d39662195F01',
  treasuryAddress: '0x3333333333333333333333333333333333333333'
};

async function fixture() {
  const economy = new Economy();
  const creator = economy.registerAgent({ name:'Payer', description:'payer', endpoint:'https://payer.example/a2a', capabilities:['broker'], wallets:[{chain:'eip155:8453',address:'0x1111111111111111111111111111111111111111',assets:['A2A']}] });
  const worker = economy.registerAgent({ name:'Worker', description:'worker', endpoint:'https://worker.example/a2a', capabilities:['research'], wallets:[{chain:'eip155:8453',address:'0x2222222222222222222222222222222222222222',assets:['A2A']}] });
  const job = economy.createJob({creatorId:creator.id,title:'Research',description:'x',requiredCapability:'research',reward:1,paymentAsset:'A2A',paymentNetwork:'base'});
  economy.claimJob(job.id, worker.id);
  economy.submitJob(job.id, worker.id, {ok:true});
  await economy.verifyJob(job.id, creator.id);
  return {economy,creator,worker,job};
}

test('payment intent freezes exact Base Mainnet A2A split without custody', async()=>{
  const {job}=await fixture();
  const intent=paymentIntentForJob(job,config);
  assert.equal(intent.protocol,'a2a402-payment-intent-v1');
  assert.equal(intent.chainId,8453);
  assert.equal(intent.transfers[0].amountUnits,'950000000000000000');
  assert.equal(intent.transfers[1].amountUnits,'50000000000000000');
  assert.equal(intent.safety.privateKeyNeverSharedWithMarketplace,true);
});

test('payer agent sees its own pending execution intents', async()=>{
  const {economy,creator,worker}=await fixture();
  assert.equal(pendingPaymentIntents(economy,creator.id,config).length,1);
  assert.equal(pendingPaymentIntents(economy,worker.id,config).length,0);
});

test('replay helper recognizes both worker and fee hashes',()=>{
  const economy=new Economy();
  economy.transactions.push({reference:'worker-hash',feeReference:'fee-hash'});
  assert.equal(transactionHashAlreadyUsed(economy,'worker-hash'),true);
  assert.equal(transactionHashAlreadyUsed(economy,'fee-hash'),true);
  assert.equal(transactionHashAlreadyUsed(economy,'new-hash'),false);
});
