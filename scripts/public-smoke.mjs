const base=(process.env.A2A402_SMOKE_BASE_URL||'https://a2a402.market').replace(/\/$/,'');
const expectedCommit=process.env.A2A402_EXPECT_COMMIT||null;
const secretPattern=/(postgres(?:ql)?|mysql|mongodb|redis):\/\/[^\s"']+:[^@\s"']+@/i;
const legacyNetworkPattern=/base[- ]sepolia|eip155:84532|USDC_TEST/i;
const internalAgentPattern=/A2A Canary|Reference Autonomous Agent|Autonomous Payer|Autonomous Worker|Background Worker|A2A402-operated|broker agent|Feral Teachers Commerce Agent/i;
const internalHistoryPattern=/internal first A2A mainnet settlement canary|autonomous settlement proof|fully autonomous A2A mainnet settlement/i;
const claimPathPattern=/\/jobs\/\{jobId\}\/claim/;
const checks=[
  ['/build-info.json',200,body=>!expectedCommit||String(body.commit||'').startsWith(expectedCommit)],
  ['/',200,body=>typeof body==='string'&&body.includes('Modern settled contracts')&&body.includes('No modern evaluations yet')&&body.includes('Operator canaries and internal settlement proofs are excluded')&&!body.includes('>—</strong>')],
  ['/.well-known/agent-card.json',200,body=>body?.extensions?.a2a402?.canonicalLifecycle?.includes('bid')&&body?.extensions?.a2a402?.jobsUrl&&body?.extensions?.a2a402?.authentication?.rotationInvalidatesPreviousToken===true&&!legacyNetworkPattern.test(JSON.stringify(body))],
  ['/llms.txt',200,body=>!legacyNetworkPattern.test(typeof body==='string'?body:JSON.stringify(body))],
  ['/openapi.json',200,body=>body&&typeof body==='object'&&body?.info?.version==='1.2.0'&&body?.paths?.['/agents/{agentId}/auth/rotate']&&!claimPathPattern.test(JSON.stringify(body))&&!legacyNetworkPattern.test(JSON.stringify(body))],
  ['/health',200,body=>body?.status==='ok'&&body?.chainId===8453],
  ['/jobs',200,body=>Array.isArray(body)&&!secretPattern.test(JSON.stringify(body))&&!legacyNetworkPattern.test(JSON.stringify(body))&&!internalHistoryPattern.test(JSON.stringify(body))],
  ['/jobs?status=OPEN',200,body=>Array.isArray(body)&&body.every(j=>String(j.status).toUpperCase()==='OPEN')&&!legacyNetworkPattern.test(JSON.stringify(body))&&!internalHistoryPattern.test(JSON.stringify(body))],
  ['/jobs?capability=research&status=OPEN',200,body=>Array.isArray(body)&&body.every(j=>String(j.status).toUpperCase()==='OPEN'&&String(j.requiredCapability).toLowerCase()==='research')&&!legacyNetworkPattern.test(JSON.stringify(body))&&!internalHistoryPattern.test(JSON.stringify(body))],
  ['/agents/search?capability=research',200,body=>Array.isArray(body)&&!secretPattern.test(JSON.stringify(body))&&!legacyNetworkPattern.test(JSON.stringify(body))&&!internalAgentPattern.test(JSON.stringify(body))],
  ['/social/feed',200,body=>Array.isArray(body?.items)&&!secretPattern.test(JSON.stringify(body))&&!legacyNetworkPattern.test(JSON.stringify(body))&&!internalAgentPattern.test(JSON.stringify(body))&&!internalHistoryPattern.test(JSON.stringify(body))],
  ['/social/agents',200,body=>Array.isArray(body?.agents)&&!secretPattern.test(JSON.stringify(body))&&!legacyNetworkPattern.test(JSON.stringify(body))&&!internalAgentPattern.test(JSON.stringify(body))],
  ['/lounge/messages',200,body=>Array.isArray(body)&&!secretPattern.test(JSON.stringify(body))&&!legacyNetworkPattern.test(JSON.stringify(body))&&!internalAgentPattern.test(JSON.stringify(body))],
  ['/economy/stats',200,body=>body&&typeof body==='object'&&body.scope==='public-production-default'&&body.legacyTestDataExcluded===true&&body.internalAgentsExcluded===true&&body.internalHistoryExcluded===true&&body.promotionalGenesisIncluded===true&&Number.isFinite(body.transactionVolume)&&Number.isFinite(body.a2aMarketplaceFees)&&Number.isFinite(body.completionRate)&&!('successRate'in body)&&body.metricDefinitions?.jobsCreated&&!legacyNetworkPattern.test(JSON.stringify(body))],
  ['/economy/activity',200,body=>(Array.isArray(body)||Array.isArray(body?.events))&&!secretPattern.test(JSON.stringify(body))&&!legacyNetworkPattern.test(JSON.stringify(body))&&!internalAgentPattern.test(JSON.stringify(body))&&!internalHistoryPattern.test(JSON.stringify(body))],
  ['/economy/graph',200,body=>body&&typeof body==='object'&&body.version==='2.2'&&body.metrics&&body.legacyTestDataExcluded===true&&body.internalAgentsExcluded===true&&body.metricDefinitions?.transactions&&Number.isFinite(body.metrics.paidJobs)&&Number.isFinite(body.metrics.paidJobsWithoutModernContract)&&!secretPattern.test(JSON.stringify(body))&&!legacyNetworkPattern.test(JSON.stringify(body))&&!internalAgentPattern.test(JSON.stringify(body))&&!internalHistoryPattern.test(JSON.stringify(body))],
  ['/growth/stats',200,body=>body&&typeof body==='object'&&body.classifications&&body.methodology?.includes('operator-controlled')&&!secretPattern.test(JSON.stringify(body))&&!legacyNetworkPattern.test(JSON.stringify(body))],
  ['/recruit.json',200,body=>body&&typeof body==='object'&&!legacyNetworkPattern.test(JSON.stringify(body))],
  ['/token.json',200,body=>body&&typeof body==='object'&&!legacyNetworkPattern.test(JSON.stringify(body))],
  ['/token-listing.json',200,body=>body&&typeof body==='object'&&!legacyNetworkPattern.test(JSON.stringify(body))]
];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function request(path){const response=await fetch(base+path,{headers:{accept:path==='/'?'text/html':'application/json','user-agent':'a2a402-public-smoke/1.4'},redirect:'follow'});const text=await response.text();let body;try{body=JSON.parse(text)}catch{body=text}return{response,body}}
let failures=[];
for(const [path,status,validate] of checks){let lastError='';let passed=false;for(let attempt=1;attempt<=6;attempt++){try{const {response,body}=await request(path);if(response.status===status&&(!validate||validate(body))){console.log(`PASS ${response.status} ${path}`);passed=true;break}lastError=`status=${response.status} body=${JSON.stringify(body).slice(0,300)}`}catch(error){lastError=error.message}if(attempt<6)await sleep(15000)}if(!passed){console.error(`FAIL ${path}: ${lastError}`);failures.push({path,lastError})}}
if(failures.length){console.error(`Public smoke failed: ${failures.length} endpoint(s)`);process.exit(1)}
console.log(`Public smoke passed: ${checks.length} endpoint(s)`);
