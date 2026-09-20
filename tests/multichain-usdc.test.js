import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy } from '../apps/api/src/economy.js';

const networks=[
  ['base','eip155:8453'],
  ['ethereum','eip155:1'],
  ['arbitrum','eip155:42161'],
  ['optimism','eip155:10'],
  ['polygon','eip155:137']
];

for(const [network,chain] of networks){
  test(`USDC job without paymentNetwork selects declared ${network} wallet`,()=>{
    const e=new Economy();
    const payer=e.registerAgent({name:`Payer ${network}`,description:'payer',endpoint:`https://payer-${network}.example/a2a`,capabilities:['broker'],wallets:[{chain,address:'0x1111111111111111111111111111111111111111',assets:['USDC']}]});
    const worker=e.registerAgent({name:`Worker ${network}`,description:'worker',endpoint:`https://worker-${network}.example/a2a`,capabilities:['research'],wallets:[{chain,address:'0x2222222222222222222222222222222222222222',assets:['USDC']}]});
    const job=e.createJob({creatorId:payer.id,title:'Research',description:'x',requiredCapability:'research',reward:1,paymentAsset:'USDC'});
    assert.equal(job.paymentNetwork,network);
    assert.equal(job.payerAddress,'0x1111111111111111111111111111111111111111');
    e.claimJob(job.id,worker.id);
    assert.equal(job.payeeAddress,'0x2222222222222222222222222222222222222222');
    assert.equal(job.paymentRoute.asset,'USDC');
    assert.equal(job.paymentRoute.network,network);
  });
}

test('USDC wins route negotiation when both USDC and A2A402 are available',()=>{
  const e=new Economy();
  const wallets1=[
    {chain:'eip155:8453',address:'0x1111111111111111111111111111111111111111',assets:['A2A402','USDC']}
  ];
  const wallets2=[
    {chain:'eip155:8453',address:'0x2222222222222222222222222222222222222222',assets:['A2A402','USDC']}
  ];
  const payer=e.registerAgent({name:'Payer',description:'payer',endpoint:'https://payer.example/a2a',capabilities:['broker'],wallets:wallets1});
  const worker=e.registerAgent({name:'Worker',description:'worker',endpoint:'https://worker.example/a2a',capabilities:['research'],wallets:wallets2});
  const routes=e.negotiatePaymentRoutes(payer.id,worker.id);
  assert.equal(routes.selected.asset,'USDC');
  assert.equal(routes.selected.network,'base');
  assert.equal(e.paymentCapabilities(payer.id).preferredSettlementAsset,'USDC');
});

test('A2A402 remains Base-only',()=>{
  const e=new Economy();
  const payer=e.registerAgent({name:'Payer',description:'payer',endpoint:'https://payer.example/a2a',capabilities:['broker'],wallets:[{chain:'eip155:1',address:'0x1111111111111111111111111111111111111111',assets:['A2A402']}]});
  assert.throws(()=>e.createJob({creatorId:payer.id,title:'x',description:'x',requiredCapability:'research',reward:1,paymentAsset:'A2A402',paymentNetwork:'ethereum'}),/Base mainnet/);
});
