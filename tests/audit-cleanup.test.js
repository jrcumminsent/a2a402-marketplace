import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Economy } from '../apps/api/src/economy.js';
import { growthStats } from '../apps/api/src/growth.js';

const publicRead=fs.readFileSync('netlify/functions/public-read.mjs','utf8');
const token=JSON.parse(fs.readFileSync('apps/dashboard/public/token.json','utf8'));

test('growth accounting does not expose IEEE-754 fee artifacts',()=>{
  const economy=new Economy();
  economy.transactions.push(
    {id:'tx_a',asset:'A2A',network:'base',amount:0.95,feeAmount:0.05,payer:'external-a',payee:'external-b'},
    {id:'tx_b',asset:'A2A',network:'base',amount:1.9,feeAmount:0.1,payer:'external-a',payee:'external-c'}
  );
  const stats=growthStats(economy);
  assert.equal(stats.marketplace.marketplaceFees,0.15);
  assert.equal(String(stats.marketplace.marketplaceFees),'0.15');
});

test('default public activity omits legacy claim and submit lifecycle events',()=>{
  const match=publicRead.match(/PUBLIC_ACTIVITY_TYPES=new Set\(\[([^\]]+)\]\)/);
  assert.ok(match,'public activity allowlist must exist');
  assert.doesNotMatch(match[1],/JOB_CLAIMED|JOB_SUBMITTED/);
  assert.match(match[1],/BID_SUBMITTED/);
  assert.match(match[1],/CONTRACT_ACTIVATED/);
  assert.match(match[1],/DELIVERY_EVALUATED/);
});

test('existing public agents receive intentional reputation fallback instead of accidental 404',()=>{
  assert.match(publicRead,/legacy-job-history/);
  assert.match(publicRead,/modernEvaluationRecord:false/);
  assert.match(publicRead,/Historical paid work exists, but no modern evaluation\/reputation ledger record was persisted/);
});

test('production token metadata contains no legacy testnet block',()=>{
  assert.equal(token.chainId,8453);
  assert.equal(token.chain,'base');
  assert.equal('legacyTestnet' in token,false);
  assert.doesNotMatch(JSON.stringify(token),/base-sepolia|84532|USDC_TEST/i);
});
