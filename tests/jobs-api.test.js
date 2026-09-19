import test from 'node:test';
import assert from 'node:assert/strict';
import { handler as apiHandler } from '../netlify/functions/api.mjs';
import { handler as jobsHandler } from '../netlify/functions/jobs.mjs';

const event=(method,path,{body,headers={},query={}}={})=>({
  httpMethod:method,
  path,
  rawUrl:`https://a2a402.market${path}`,
  headers,
  queryStringParameters:query,
  body:body===undefined?null:JSON.stringify(body)
});
const json=response=>JSON.parse(response.body||'null');

test('structured job creation persists requirements and supports machine filters',async()=>{
  const suffix=Date.now().toString(36);
  const registration=await apiHandler(event('POST','/agents/register',{body:{
    name:`Structured Creator ${suffix}`,
    description:'Creates machine-readable research jobs',
    endpoint:`https://creator-${suffix}.example/a2a`,
    capabilities:['coordination'],
    wallets:[{chain:'eip155:8453',address:'0x8888888888888888888888888888888888888888',assets:['A2A']}]
  }}));
  assert.equal(registration.statusCode,201);
  const agent=json(registration);
  assert.ok(agent.id);assert.ok(agent.authToken);

  const created=await jobsHandler(event('POST','/jobs',{headers:{authorization:`Bearer ${agent.authToken}`,'x-agent-id':agent.id},body:{
    title:`Structured research ${suffix}`,
    description:'Return machine-readable sourced findings',
    requiredCapability:'research',
    reward:2,
    paymentAsset:'A2A',
    paymentNetwork:'base',
    category:'research',
    tags:['Base','Analysis','base'],
    requirements:{
      objective:'Compare reports using structured evidence',
      inputs:[{name:'report_urls',type:'array',required:true}],
      deliverable:{mimeType:'application/json',schema:{type:'object',required:['summary','findings','sources']}},
      acceptanceCriteria:['At least three sources','Every finding cites a source'],
      maxDurationSeconds:1800
    },
    input:{purpose:'a2a402-economy'}
  }}));
  assert.equal(created.statusCode,201);
  const job=json(created);
  assert.equal(job.input.category,'research');
  assert.deepEqual(job.input.tags,['base','analysis']);
  assert.equal(job.input.requirements.version,'1.0');
  assert.equal(job.input.requirements.deliverable.mimeType,'application/json');

  const filtered=await jobsHandler(event('GET','/jobs',{query:{status:'OPEN',capability:'research',category:'research',tag:'base',paymentAsset:'A2A'}}));
  assert.equal(filtered.statusCode,200);
  assert.ok(json(filtered).some(x=>x.id===job.id));
});

test('structured job API returns machine-readable auth and validation errors',async()=>{
  const unauthorized=await jobsHandler(event('POST','/jobs',{body:{title:'x',description:'x',requiredCapability:'research',reward:1}}));
  assert.equal(unauthorized.statusCode,401);
  assert.equal(json(unauthorized).error.code,'UNAUTHORIZED');

  const registration=await apiHandler(event('POST','/agents/register',{body:{
    name:`Validation Creator ${Date.now()}`,
    description:'validation test',endpoint:`https://validation-${Date.now()}.example/a2a`,capabilities:['coordination'],
    wallets:[{chain:'eip155:8453',address:'0x9999999999999999999999999999999999999999',assets:['A2A']}]
  }}));
  const agent=json(registration);
  const invalid=await jobsHandler(event('POST','/jobs',{headers:{authorization:`Bearer ${agent.authToken}`,'x-agent-id':agent.id},body:{
    title:'Invalid structured job',description:'bad requirement type',requiredCapability:'research',reward:1,paymentAsset:'A2A',paymentNetwork:'base',
    requirements:{inputs:[{name:'x',type:'mystery'}]}
  }}));
  assert.equal(invalid.statusCode,422);
  assert.equal(json(invalid).error.code,'VALIDATION_FAILED');
});
