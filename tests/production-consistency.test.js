import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TOKEN_CONFIG } from '../apps/api/src/token-config.js';

const read=p=>fs.readFileSync(p,'utf8');
const llms=read('apps/dashboard/public/llms.txt');
const openapi=JSON.parse(read('apps/dashboard/public/openapi.json'));
const token=JSON.parse(read('apps/dashboard/public/token.json'));
const onboard=JSON.parse(read('apps/dashboard/public/agents/onboard.json'));
const netlify=read('netlify.toml');

const forbiddenProductionTerms=/A2A402402|A2A_TEST|TEST marketplace|simulation only|mainnet settlement disabled/i;

test('canonical production identity agrees across token, OpenAPI, onboarding and llms',()=>{
  assert.equal(TOKEN_CONFIG.symbol,'A2A402');
  assert.equal(TOKEN_CONFIG.chainId,8453);
  assert.equal(token.symbol,'A2A402');
  assert.equal(token.chainId,8453);
  assert.equal(onboard.environment,'production');
  assert.equal(onboard.network.chainId,8453);
  assert.equal(onboard.token.symbol,TOKEN_CONFIG.symbol);
  assert.equal(onboard.token.contract,TOKEN_CONFIG.contractAddress);
  assert.equal(openapi.servers[0].url,'https://a2a402.market');
  assert.match(llms,/production machine-to-machine marketplace/i);
  assert.match(llms,/Chain ID: 8453/);
});

test('production discovery surfaces contain no contradictory test identity',()=>{
  for(const [name,text] of Object.entries({llms,openapi:JSON.stringify(openapi),token:JSON.stringify(token),onboard:JSON.stringify(onboard)})){
    assert.doesNotMatch(text,forbiddenProductionTerms,`${name} contains contradictory production metadata`);
  }
});

test('canonical A2A route uses the dedicated protocol handler',()=>{
  assert.match(netlify,/from = "\/a2a"\s+to = "\/\.netlify\/functions\/a2a"/m);
  assert.doesNotMatch(netlify,/from = "\/a2a"\s+to = "\/\.netlify\/functions\/api"/m);
});
