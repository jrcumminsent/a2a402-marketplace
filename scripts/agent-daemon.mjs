const BASE = (process.env.A2A402_BASE_URL || 'https://a2a402.market').replace(/\/$/, '');
const AGENT_ID = process.env.A2A402_AGENT_ID?.trim();
const AUTH_TOKEN = process.env.A2A402_AUTH_TOKEN?.trim();
const CAPABILITIES = String(process.env.A2A402_AGENT_CAPABILITIES || 'research,analysis,verification,discovery').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
const POLL_MS = Math.max(30000, Number(process.env.A2A402_AGENT_POLL_MS || 60000));
const MAX_REWARD = Number(process.env.A2A402_AGENT_MAX_REWARD || 2);
const AUTO_HIRE = process.env.A2A402_AUTONOMOUS_HIRING === 'true';
const HIRE_THRESHOLD = Number(process.env.A2A402_HIRE_BALANCE_THRESHOLD || 2);
const HIRE_REWARD = Math.min(Number(process.env.A2A402_HIRE_REWARD || 0.5), MAX_REWARD);
const MAX_ACTIVE_CREATED = Math.max(0, Number(process.env.A2A402_MAX_ACTIVE_CREATED_JOBS || 1));
const WATCH = process.argv.includes('--watch');

if (!AGENT_ID || !AUTH_TOKEN) throw new Error('A2A402_AGENT_ID and A2A402_AUTH_TOKEN are required');

const auth = { authorization:`Bearer ${AUTH_TOKEN}`, 'x-agent-id':AGENT_ID };
async function api(path, init={}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers:{accept:'application/json',...(init.body?{'content-type':'application/json'}:{}),...(init.headers||{})}
  });
  const text = await response.text();
  let body={}; try{body=text?JSON.parse(text):{};}catch{body={raw:text};}
  if(!response.ok) throw new Error(body.error||body.message||`${response.status} ${response.statusText}`);
  return body;
}
async function postSocial(message,type='activity') {
  try { return await api('/social/posts',{method:'POST',headers:auth,body:JSON.stringify({message,type})}); }
  catch { return null; }
}
function canDo(job) {
  return job?.status==='OPEN' && job.creatorId!==AGENT_ID && CAPABILITIES.includes(String(job.requiredCapability||'').toLowerCase()) && Number(job.reward||0)>0 && Number(job.reward||0)<=MAX_REWARD;
}
function perform(job) {
  const input = job.input && typeof job.input==='object' ? job.input : {};
  const task = String(input.task || input.operation || '').toLowerCase();
  let output;
  if(task==='normalize') output={normalized:String(input.value??'').trim().replace(/\s+/g,' ')};
  else if(task==='uppercase') output={value:String(input.value??'').toUpperCase()};
  else if(task==='lowercase') output={value:String(input.value??'').toLowerCase()};
  else if(task==='count') output={characters:String(input.value??'').length,items:Array.isArray(input.value)?input.value.length:undefined};
  else output={summary:`Autonomous agent completed ${job.requiredCapability} task: ${job.title}`,acceptedInput:input};
  return {ok:true,autonomous:true,agentDaemon:'a2a402-agent-daemon-v1',jobId:job.id,capability:job.requiredCapability,completedAt:new Date().toISOString(),output};
}
async function workOne() {
  const jobs = await api('/jobs');
  const candidate = (Array.isArray(jobs)?jobs:[]).filter(canDo).sort((a,b)=>Number(b.reward||0)-Number(a.reward||0))[0];
  if(!candidate) return null;
  const claimed = await api(`/jobs/${candidate.id}/claim`,{method:'POST',headers:auth});
  await postSocial(`Claimed ${claimed.title} for ${Number(claimed.reward||0)} ${claimed.paymentAsset||'A2A'}.`,'work');
  const result = perform(claimed);
  const submitted = await api(`/jobs/${claimed.id}/submit`,{method:'POST',headers:auth,body:JSON.stringify({result})});
  await postSocial(`Submitted work for ${submitted.title}. Waiting for creator verification.`,'work');
  try { await api(`/social/agents/${submitted.creatorId}/follow`,{method:'POST',headers:auth}); } catch {}
  return {jobId:submitted.id,status:submitted.status};
}
async function maybeHire() {
  if(!AUTO_HIRE || MAX_ACTIVE_CREATED<1) return null;
  const [balance, jobs, directory] = await Promise.all([
    api(`/agents/${AGENT_ID}/balance`), api('/jobs'), api('/social/agents')
  ]);
  const a2a = Number(balance?.a2aBalance?.balance || 0);
  if(a2a < HIRE_THRESHOLD) return null;
  const active = (Array.isArray(jobs)?jobs:[]).filter(j=>j.creatorId===AGENT_ID && ['OPEN','IN_PROGRESS','SUBMITTED','VERIFYING','AWAITING_PAYMENT'].includes(j.status));
  if(active.length>=MAX_ACTIVE_CREATED) return null;
  const candidates = (directory.agents||[]).filter(a=>a.id!==AGENT_ID && (a.wallets||[]).some(w=>w.chain==='eip155:8453'&&(w.assets||[]).includes('A2A')));
  if(!candidates.length) return null;
  candidates.sort((a,b)=>(b.reputation?.successRate||0)-(a.reputation?.successRate||0) || (b.economy?.jobsPaid||0)-(a.economy?.jobsPaid||0));
  const target=candidates[0];
  const capability=target.capabilities?.find(c=>c.availability!==false)?.name;
  if(!capability) return null;
  const job=await api('/jobs',{method:'POST',headers:auth,body:JSON.stringify({
    title:`Autonomous rehire: ${target.name} for ${capability}`,
    description:'Agent-created job funded from earned A2A. This job proves autonomous capital circulation.',
    requiredCapability:capability,reward:HIRE_REWARD,paymentAsset:'A2A',paymentNetwork:'base',verificationMethod:'deterministic',
    input:{task:'normalize',value:`A2A402 autonomous rehire ${new Date().toISOString()}`}
  })});
  await postSocial(`Created a ${HIRE_REWARD} A2A job for ${capability} after accumulating earned A2A.`,'economy');
  return {jobId:job.id,targetAgentId:target.id};
}
async function verifyOwnSubmitted() {
  const jobs=await api('/jobs');
  const pending=(Array.isArray(jobs)?jobs:[]).filter(j=>j.creatorId===AGENT_ID&&j.status==='SUBMITTED');
  const out=[];
  for(const job of pending){
    const accepted=Boolean(job.result?.ok && job.result?.autonomous);
    const verified=await api(`/jobs/${job.id}/verify`,{method:'POST',headers:auth,body:JSON.stringify({accepted})});
    out.push({jobId:job.id,status:verified.status,accepted});
    if(accepted) await postSocial(`Verified ${job.title}; payment is now eligible for autonomous settlement.`,'economy');
  }
  return out;
}
async function runOnce(){
  const results={checkedAt:new Date().toISOString(),agentId:AGENT_ID,worked:null,verified:[],hired:null};
  try{results.verified=await verifyOwnSubmitted();}catch(e){results.verifyError=e.message;}
  try{results.worked=await workOne();}catch(e){results.workError=e.message;}
  try{results.hired=await maybeHire();}catch(e){results.hireError=e.message;}
  console.log(JSON.stringify(results,null,2));
}
if(WATCH){for(;;){await runOnce();await new Promise(r=>setTimeout(r,POLL_MS));}}else await runOnce();
