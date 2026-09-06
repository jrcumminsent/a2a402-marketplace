const base=(process.env.A2A402_SMOKE_BASE_URL||'https://a2a402.market').replace(/\/$/,'');
const expectedCommit=process.env.A2A402_EXPECT_COMMIT||null;
const legacyNetworkPattern=/base[- ]sepolia|eip155:84532|USDC_TEST|legacyTestnet/i;
const internalAgentPattern=/A2A Canary|Reference Autonomous Agent|Autonomous Payer|Autonomous Worker|Background Worker|A2A402-operated|broker agent|Feral Teachers Commerce Agent/i;
const forbiddenActivityTypes=new Set(['JOB_CLAIMED','JOB_SUBMITTED','JOB_VERIFYING']);
const modernLifecyclePattern=/bid\s*->\s*contract\s*->\s*(?:artifact\/?delivery|artifact\s*->\s*delivery)\s*->\s*evaluation\s*->\s*settlement/i;
const claimLanguage=/\bclaim(?:ing|ed)?\s+(?:an?\s+)?A2A(?:-denominated)?\s+jobs?\b/i;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function request(path){const response=await fetch(base+path,{headers:{accept:path==='/'||path==='/llms.txt'?'text/html':'application/json','user-agent':'a2a402-public-smoke/1.7'},redirect:'follow'});const text=await response.text();let body;try{body=JSON.parse(text)}catch{body=text}return{response,body}}
let failures=[];
function pass(name){console.log(`PASS ${name}`)}
function fail(name,detail){console.error(`FAIL ${name}: ${detail}`);failures.push({path:name,lastError:detail})}
async function check(path,validate){let last='';for(let i=0;i<6;i++){try{const {response,body}=await request(path);if(response.status===200&&validate(body)){pass(`200 ${path}`);return}last=`status=${response.status} body=${JSON.stringify(body).slice(0,500)}`}catch(e){last=e.message}if(i<5)await sleep(15000)}fail(path,last)}
await check('/build-info.json',b=>!expectedCommit||String(b.commit||'').startsWith(expectedCommit));
await check('/',b=>typeof b==='string'&&b.includes('Modern settled contracts'));
await check('/.well-known/agent-card.json',b=>b?.extensions?.a2a402?.canonicalLifecycle?.includes('bid')&&!legacyNetworkPattern.test(JSON.stringify(b)));
await check('/.well-known/agent.json',b=>b?.extensions?.a2a402?.canonicalLifecycle?.includes('bid')&&!legacyNetworkPattern.test(JSON.stringify(b)));
await check('/agent-card.json',b=>b?.extensions?.a2a402?.canonicalLifecycle?.includes('bid')&&!legacyNetworkPattern.test(JSON.stringify(b)));
await check('/llms.txt',b=>typeof b==='string'&&modernLifecyclePattern.test(b)&&!claimLanguage.test(b)&&!legacyNetworkPattern.test(b));
await check('/openapi.json',b=>Boolean(b?.paths?.['/jobs/{jobId}/bids']&&b?.paths?.['/bids/{bidId}/select']&&b?.paths?.['/contracts/{contractId}/deliveries']&&b?.paths?.['/deliveries/{deliveryId}/evaluate']&&b?.paths?.['/jobs/{jobId}/settle'])&&!b?.paths?.['/jobs/{jobId}/claim']&&!legacyNetworkPattern.test(JSON.stringify(b)));
await check('/health',b=>b?.environment==='production'&&b?.chainId===8453);
await check('/token.json',b=>b?.chainId===8453&&!legacyNetworkPattern.test(JSON.stringify(b)));
await check('/token-listing.json',b=>!legacyNetworkPattern.test(JSON.stringify(b)));
await check('/jobs',b=>Array.isArray(b)&&b.every(j=>!legacyNetworkPattern.test(JSON.stringify(j)))&&b.filter(j=>j.input?.program==='genesis-work-pool'||/genesis/i.test(String(j.input?.program||j.program||''))).every(j=>j.input?.classification==='promotional'&&j.input?.systemGenerated===true&&j.input?.countsTowardOrganic===false));
await check('/agents/search?capability=research',b=>Array.isArray(b)&&!internalAgentPattern.test(JSON.stringify(b))&&!claimLanguage.test(JSON.stringify(b))&&b.every(a=>a.reputation&&a.reputation.agentId===a.agentId));
await check('/economy/activity',b=>{const events=Array.isArray(b)?b:b?.events;return Array.isArray(events)&&events.every(e=>!forbiddenActivityTypes.has(e.type))&&!internalAgentPattern.test(JSON.stringify(events))});
await check('/economy/stats',b=>b?.scope==='public-production-default'&&b?.legacyTestDataExcluded===true&&b?.internalAgentsExcluded===true&&b?.internalHistoryExcluded===true);
await check('/economy/graph',b=>b?.version==='2.2'&&b?.legacyTestDataExcluded===true&&b?.internalAgentsExcluded===true);
try{
 const [cards,alias1,alias2,jobs,stats,graph,agents]=await Promise.all([request('/.well-known/agent-card.json'),request('/.well-known/agent.json'),request('/agent-card.json'),request('/jobs'),request('/economy/stats'),request('/economy/graph'),request('/agents/search?capability=research')]);
 const same=JSON.stringify(cards.body)===JSON.stringify(alias1.body)&&JSON.stringify(cards.body)===JSON.stringify(alias2.body);same?pass('truth agent-card aliases agree'):fail('truth agent-card aliases','aliases differ');
 const counts=jobs.body.length===Number(stats.body.jobsCreated)&&jobs.body.length===Number(graph.body.metrics?.jobs)&&Number(stats.body.jobsCompleted)===Number(graph.body.metrics?.paidJobs)&&Number(stats.body.agentToAgentTransactions)===Number(graph.body.metrics?.transactions);counts?pass('truth economy counts agree'):fail('truth economy counts',`jobs=${jobs.body.length}/${stats.body.jobsCreated}/${graph.body.metrics?.jobs} paid=${stats.body.jobsCompleted}/${graph.body.metrics?.paidJobs} tx=${stats.body.agentToAgentTransactions}/${graph.body.metrics?.transactions}`);
 for(const a of agents.body){const {response,body}=await request(`/reputation/${encodeURIComponent(a.agentId)}`);if(response.status!==200||body?.agentId!==a.agentId||body?.error)fail(`reputation ${a.agentId}`,`status=${response.status} body=${JSON.stringify(body).slice(0,300)}`)}
 if(Array.isArray(agents.body)&&!failures.some(f=>String(f.path).startsWith('reputation ')))pass('truth every discoverable research agent has public reputation');
}catch(e){fail('truth snapshot',e.message)}
for(const [path,method] of [['/agents/smoke-probe/auth/rotate','POST'],['/payments/execution/intents','POST']]){try{const r=await fetch(base+path,{method,headers:{accept:'application/json','user-agent':'a2a402-public-smoke/1.7'}});if([401,405].includes(r.status))pass(`${r.status} ${path} protected`);else fail(path,`expected protected response, got ${r.status}`)}catch(e){fail(path,e.message)}}
if(failures.length){console.error(`Public smoke failed: ${failures.length} check(s)`);process.exit(1)}
console.log('Public smoke passed: targeted public-truth, reputation, Genesis-label and modern-lifecycle guards');
