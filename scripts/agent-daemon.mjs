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
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(path, init={}, {retry=true}={}) {
  const attempts=retry?3:1;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{
      const response=await fetch(`${BASE}${path}`,{...init,headers:{accept:'application/json',...(init.body?{'content-type':'application/json'}:{}),...(init.headers||{})}});
      const text=await response.text();let body={};try{body=text?JSON.parse(text):{};}catch{body={raw:text};}
      if(response.ok)return body;
      const error=new Error(body.error||body.message||`${response.status} ${response.statusText}`);error.status=response.status;
      if(attempt===attempts||![429,500,502,503,504].includes(response.status))throw error;
    }catch(error){if(attempt===attempts)throw error;}
    await sleep(300*2**(attempt-1));
  }
}
async function post(path,body){return api(path,{method:'POST',headers:auth,body:JSON.stringify(body)})}
async function postSocial(message,type='activity') {try{return await api('/social/posts',{method:'POST',headers:auth,body:JSON.stringify({message,type})},{retry:false})}catch{return null}}
function canDo(job){return job?.status==='OPEN'&&job.creatorId!==AGENT_ID&&CAPABILITIES.includes(String(job.requiredCapability||'').toLowerCase())&&Number(job.reward||0)>0&&Number(job.reward||0)<=MAX_REWARD}
function perform(job){const input=job.input&&typeof job.input==='object'?job.input:{};const task=String(input.task||input.operation||'').toLowerCase();let output;if(task==='normalize')output={normalized:String(input.value??'').trim().replace(/\s+/g,' ')};else if(task==='uppercase')output={value:String(input.value??'').toUpperCase()};else if(task==='lowercase')output={value:String(input.value??'').toLowerCase()};else if(task==='count')output={characters:String(input.value??'').length,items:Array.isArray(input.value)?input.value.length:undefined};else output={summary:`Autonomous agent completed ${job.requiredCapability} task: ${job.title}`,acceptedInput:input};return{ok:true,autonomous:true,agentDaemon:'a2a402-agent-daemon-v2',jobId:job.id,capability:job.requiredCapability,completedAt:new Date().toISOString(),output}}

async function selectOwnBid(){
  const jobs=await api('/jobs');
  for(const job of (Array.isArray(jobs)?jobs:[]).filter(j=>j.creatorId===AGENT_ID&&j.status==='OPEN')){
    const bids=await api(`/jobs/${job.id}/bids`,{headers:auth});
    const candidate=(Array.isArray(bids)?bids:[]).filter(b=>b.status==='OPEN').sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')))[0];
    if(!candidate)continue;
    const selected=await post(`/bids/${candidate.id}/select`,{idempotencyKey:`daemon-select-${candidate.id}`});
    await postSocial(`Selected a bid for ${job.title}; contract ${selected.contract?.id||'created'}.`,'economy');
    return{jobId:job.id,bidId:candidate.id,contractId:selected.contract?.id};
  }
  return null;
}

async function bidForWork(){
  const jobs=await api('/jobs');
  const candidate=(Array.isArray(jobs)?jobs:[]).filter(canDo).sort((a,b)=>Number(b.reward||0)-Number(a.reward||0))[0];
  if(!candidate)return null;
  try{
    const bid=await post(`/jobs/${candidate.id}/bids`,{amount:Number(candidate.reward),message:`Autonomous daemon bid for ${candidate.requiredCapability}.`,estimatedSeconds:300,idempotencyKey:`daemon-bid-${AGENT_ID}-${candidate.id}`});
    await postSocial(`Bid on ${candidate.title} for ${Number(candidate.reward||0)} ${candidate.paymentAsset||'A2A'}.`,'work');
    return{jobId:candidate.id,bidId:bid.id,status:bid.status};
  }catch(error){if(/already has an open bid|job not open/.test(error.message))return null;throw error}
}

async function deliverAssigned(){
  const contracts=await api(`/agents/${AGENT_ID}/contracts`,{headers:auth});
  const active=(Array.isArray(contracts)?contracts:[]).filter(c=>c.workerId===AGENT_ID&&c.status==='ACTIVE');
  if(!active.length)return null;
  const contract=active[0],job=await api(`/jobs/${contract.jobId}`),result=perform(job);
  const delivered=await post(`/contracts/${contract.id}/deliveries`,{name:`${job.id}.json`,mimeType:'application/json',summary:`Autonomous completion of ${job.title}`,content:result,idempotencyKey:`daemon-delivery-${contract.id}`});
  await postSocial(`Delivered artifact for ${job.title}; waiting for evaluation.`,'work');
  try{await api(`/social/agents/${job.creatorId}/follow`,{method:'POST',headers:auth},{retry:false})}catch{}
  return{jobId:job.id,contractId:contract.id,deliveryId:delivered.delivery?.id,status:delivered.delivery?.status};
}

async function evaluateOwnDeliveries(){
  const contracts=await api(`/agents/${AGENT_ID}/contracts`,{headers:auth});const out=[];
  for(const contract of (Array.isArray(contracts)?contracts:[]).filter(c=>c.creatorId===AGENT_ID)){
    let deliveries=[];try{deliveries=await api(`/contracts/${contract.id}/deliveries`,{headers:auth})}catch{continue}
    for(const delivery of (Array.isArray(deliveries)?deliveries:[]).filter(d=>d.status==='SUBMITTED')){
      const job=await api(`/jobs/${contract.jobId}`);const accepted=Boolean(job.result?.artifactId&&job.result?.sha256);
      const evaluated=await post(`/deliveries/${delivery.id}/evaluate`,{accepted,qualityScore:accepted?100:0,reason:accepted?'Daemon verified artifact metadata and delivery linkage.':'Delivery missing required artifact metadata.',evidence:{artifactId:delivery.artifactId,artifactSha256:delivery.artifactSha256},idempotencyKey:`daemon-evaluate-${delivery.id}`});
      out.push({jobId:job.id,deliveryId:delivery.id,evaluationId:evaluated.evaluation?.id,status:evaluated.job?.status,accepted});
      await postSocial(`${accepted?'Accepted':'Rejected'} delivery for ${job.title}; ${accepted?'payment is eligible after settlement':'work requires correction'}.`,'economy');
    }
  }
  return out;
}

async function maybeHire(){
  if(!AUTO_HIRE||MAX_ACTIVE_CREATED<1)return null;
  const [balance,jobs,directory]=await Promise.all([api(`/agents/${AGENT_ID}/balance`),api('/jobs'),api('/social/agents')]);const a2a=Number(balance?.a2aBalance?.balance||0);if(a2a<HIRE_THRESHOLD)return null;
  const active=(Array.isArray(jobs)?jobs:[]).filter(j=>j.creatorId===AGENT_ID&&['OPEN','IN_PROGRESS','SUBMITTED','VERIFYING','AWAITING_PAYMENT'].includes(j.status));if(active.length>=MAX_ACTIVE_CREATED)return null;
  const candidates=(directory.agents||[]).filter(a=>a.id!==AGENT_ID&&(a.wallets||[]).some(w=>w.chain==='eip155:8453'&&(w.assets||[]).includes('A2A')));if(!candidates.length)return null;
  candidates.sort((a,b)=>(b.reputation?.successRate||0)-(a.reputation?.successRate||0)||(b.economy?.jobsPaid||0)-(a.economy?.jobsPaid||0));const target=candidates[0];const capability=(target.capabilities||[]).map(c=>typeof c==='string'?{name:c,availability:true}:c).find(c=>c.availability!==false)?.name;if(!capability)return null;
  const job=await post('/jobs',{title:`Autonomous rehire: ${target.name} for ${capability}`,description:'Agent-created job funded from earned A2A. This job proves autonomous capital circulation.',requiredCapability:capability,reward:HIRE_REWARD,paymentAsset:'A2A',paymentNetwork:'base',verificationMethod:'deterministic',input:{task:'normalize',value:`A2A402 autonomous rehire ${new Date().toISOString()}`,purpose:'a2a402-economy'}});
  await postSocial(`Created a ${HIRE_REWARD} A2A job for ${capability} after accumulating earned A2A.`,'economy');return{jobId:job.id,targetAgentId:target.id};
}

async function runOnce(){
  const results={checkedAt:new Date().toISOString(),agentId:AGENT_ID,selected:null,evaluated:[],delivered:null,bid:null,hired:null};
  try{results.evaluated=await evaluateOwnDeliveries()}catch(e){results.evaluateError=e.message}
  try{results.selected=await selectOwnBid()}catch(e){results.selectError=e.message}
  try{results.delivered=await deliverAssigned()}catch(e){results.deliveryError=e.message}
  try{results.bid=await bidForWork()}catch(e){results.bidError=e.message}
  try{results.hired=await maybeHire()}catch(e){results.hireError=e.message}
  console.log(JSON.stringify(results,null,2));
}
if(WATCH){for(;;){await runOnce();await sleep(POLL_MS)}}else await runOnce();
