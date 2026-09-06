import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {arrayOf,classify,normalizeAgents,relationships,metrics,validHash} from '../apps/dashboard/public/earth/data.js';

test('production arrays and object capabilities normalize without invented agents',()=>{
  const directory={agents:[{id:'one',name:'Worker',capabilities:[{name:'research'}]}]};
  assert.deepEqual(normalizeAgents(directory,null,null)[0].capabilities,['research']);
  assert.deepEqual(normalizeAgents({agents:[]},{nodes:[{id:'old',type:'agent'}]},null),[]);
  assert.equal(normalizeAgents(null,{nodes:[{id:'fallback',type:'agent',label:'Fallback'}]},null)[0].name,'Fallback');
  assert.equal(arrayOf([{id:1}],'events').length,1);
});
test('unavailable metrics stay unavailable and active jobs are not open jobs',()=>{
  assert.deepEqual(metrics(null,null,null),{independent:null,open:null,completed:null,settled:null});
  assert.deepEqual(metrics({jobsCompleted:0,a2aTransactions:0,activeJobs:27},{verifiedOrganic:{independentAgents:0},marketplace:{registeredAgents:999}},[{status:'OPEN'},{status:'ACTIVE'},{status:'SUBMITTED'}]),{independent:0,open:1,completed:0,settled:0});
});
test('classifications preserve Genesis, test, internal, external and unknown provenance',()=>{
  assert.equal(classify({input:{program:'genesis-work-pool'}},null,'job').key,'genesis');
  assert.equal(classify({name:'Operations Test Agent'},null).key,'test');
  assert.equal(classify({classification:'canary'},null).key,'canary');
  assert.equal(classify({classification:'internal'},null).key,'internal');
  assert.equal(classify({description:'Independent external operator'},null).key,'unclassified');
  assert.equal(classify({classification:'external'},null).key,'external');
  assert.equal(classify({id:'a'},{verifiedOrganicOperators:[{agentId:'a'}]}).key,'organic');
});
test('arcs require evidenced relationships with visible endpoints',()=>{
  const agents=[{id:'a'},{id:'b'},{id:'c'}];
  assert.deepEqual(relationships(agents,[],{edges:[]}),[]);
  const links=relationships(agents,[{id:'j',creatorId:'a',workerId:'b'},{id:'hidden',creatorId:'internal',workerId:'b'}],{edges:[{from:'b',to:'contract',type:'HIRED_UNDER'},{from:'contract',to:'c',type:'WORKER'}]});
  assert.deepEqual(links.map(x=>[x.from,x.to]),[['a','b'],['b','c']]);
  assert.deepEqual(relationships(agents,[],{edges:[{from:'a',to:'b',type:'SIMILAR_CAPABILITY'}]}),[]);
});
test('explorer links require complete transaction hashes',()=>{assert.equal(validHash('javascript:alert(1)'),false);assert.equal(validHash('0x123'),false);assert.equal(validHash('0x'+'a'.repeat(64)),true);});
test('built homepage aliases preserve all human and machine routes',()=>{
  execFileSync(process.execPath,['scripts/build.js']);
  const home=fs.readFileSync('public/index.html','utf8');assert.equal(home,fs.readFileSync('public/agentglobe/index.html','utf8'));
  assert.ok(home.includes('AGENTS<br>WITHOUT BORDERS'));assert.ok(home.includes('application/ld+json'));
  assert.ok(home.includes('id="independentCount">—</strong>')); // Never replace unknown with zero at build time.
  for(const route of ['agents','agents/detail','jobs-ui','contracts/detail','social','graph','growth','stats','token','recruit','docs','founders','whitepaper'])assert.ok(fs.existsSync(`public/${route}/index.html`),route);
  for(const route of ['openapi.json','llms.txt','.well-known/agent-card.json','token.json'])assert.ok(fs.existsSync(`public/${route}`),route);
  const token=JSON.parse(fs.readFileSync('public/token.json'));assert.equal(token.contractAddress,'0xf9e891696c022f9fe4a143a92255371253c5567a');
});
