const base=(process.env.A2A402_SMOKE_BASE_URL||'https://a2a402.market').replace(/\/$/,'');
const expectedCommit=process.env.A2A402_EXPECT_COMMIT||null;
const secretPattern=/(postgres(?:ql)?|mysql|mongodb|redis):\/\/[^\s"']+:[^@\s"']+@/i;
const checks=[
  ['/build-info.json',200,body=>!expectedCommit||String(body.commit||'').startsWith(expectedCommit)],
  ['/.well-known/agent-card.json',200,body=>body?.extensions?.a2a402?.canonicalLifecycle?.includes('bid')&&body?.extensions?.a2a402?.jobsUrl],
  ['/health',200,body=>body?.status==='ok'&&body?.chainId===8453],
  ['/jobs',200,body=>Array.isArray(body)&&!secretPattern.test(JSON.stringify(body))&&body.every(j=>String(j.paymentAsset||'').toUpperCase()!=='USDC_TEST'&&!['base-sepolia','eip155:84532'].includes(String(j.paymentNetwork||'').toLowerCase()))],
  ['/jobs?status=OPEN',200,body=>Array.isArray(body)&&body.every(j=>String(j.status).toUpperCase()==='OPEN')],
  ['/jobs?capability=research&status=OPEN',200,body=>Array.isArray(body)&&body.every(j=>String(j.status).toUpperCase()==='OPEN'&&String(j.requiredCapability).toLowerCase()==='research')],
  ['/agents/search?capability=research',200,body=>Array.isArray(body)&&!secretPattern.test(JSON.stringify(body))],
  ['/social/feed',200,body=>Array.isArray(body?.items)&&!secretPattern.test(JSON.stringify(body))],
  ['/social/agents',200,body=>Array.isArray(body?.agents)&&!secretPattern.test(JSON.stringify(body))],
  ['/lounge/messages',200,body=>Array.isArray(body)&&!secretPattern.test(JSON.stringify(body))],
  ['/economy/stats',200,body=>body&&typeof body==='object'&&body.legacyTestDataExcluded===true&&Number.isFinite(body.transactionVolume)&&Number.isFinite(body.a2aMarketplaceFees)],
  ['/economy/activity',200,body=>(Array.isArray(body)||Array.isArray(body?.events))&&!secretPattern.test(JSON.stringify(body))],
  ['/economy/graph',200,body=>body&&typeof body==='object'&&body.metrics&&!secretPattern.test(JSON.stringify(body))],
  ['/growth/stats',200,body=>body&&typeof body==='object'&&!secretPattern.test(JSON.stringify(body))],
  ['/recruit.json',200,body=>body&&typeof body==='object'],
  ['/token.json',200,body=>body&&typeof body==='object'],
  ['/token-listing.json',200,body=>body&&typeof body==='object']
];

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function request(path){
  const response=await fetch(base+path,{headers:{accept:'application/json','user-agent':'a2a402-public-smoke/1.1'},redirect:'follow'});
  const text=await response.text();
  let body;try{body=JSON.parse(text)}catch{body=text}
  return{response,body};
}

let failures=[];
for(const [path,status,validate] of checks){
  let lastError='';let passed=false;
  for(let attempt=1;attempt<=6;attempt++){
    try{
      const {response,body}=await request(path);
      if(response.status===status&&(!validate||validate(body))){console.log(`PASS ${response.status} ${path}`);passed=true;break;}
      lastError=`status=${response.status} body=${JSON.stringify(body).slice(0,300)}`;
    }catch(error){lastError=error.message;}
    if(attempt<6)await sleep(15000);
  }
  if(!passed){console.error(`FAIL ${path}: ${lastError}`);failures.push({path,lastError});}
}
if(failures.length){console.error(`Public smoke failed: ${failures.length} endpoint(s)`);process.exit(1);}
console.log(`Public smoke passed: ${checks.length} endpoint(s)`);
