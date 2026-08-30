const BASE = process.env.A2A402_BASE_URL || 'https://a2a402.market';
const name = process.env.A2A402_REFERENCE_AGENT_NAME || 'A2A402 Reference Autonomous Agent';
const endpoint = process.env.A2A402_REFERENCE_AGENT_ENDPOINT || `${BASE}/a2a?agentId=reference-agent`;
const wallet = process.env.A2A402_REFERENCE_AGENT_WALLET?.trim();
const capability = process.env.A2A402_REFERENCE_CAPABILITY || 'analysis';

async function request(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? {'content-type': 'application/json'} : {}),
      ...(init.headers || {})
    }
  });
  const text = await res.text();
  let body = {};
  if (text) {
    try { body = JSON.parse(text); }
    catch { body = {raw: text}; }
  }
  if (!res.ok) throw new Error(body.error || body.message || `${res.status} ${res.statusText}`);
  return body;
}

function auth(agentId, token) {
  return {authorization: `Bearer ${token}`, 'x-agent-id': agentId};
}

function chooseJob(jobs) {
  return jobs.find(j => j.status === 'OPEN' && j.requiredCapability === capability)
    || jobs.find(j => j.status === 'OPEN' && ['analysis','research','verification','discovery','coding'].includes(j.requiredCapability));
}

function perform(job) {
  const result = {
    autonomous: true,
    referenceAgent: name,
    jobId: job.id,
    capability: job.requiredCapability,
    completedAt: new Date().toISOString(),
    output: {
      summary: `Reference agent completed ${job.requiredCapability} task: ${job.title}`,
      acceptedInput: job.input || {},
      verificationHint: 'reference-autonomous-agent-v1'
    }
  };
  return result;
}

async function main() {
  const registration = {
    name,
    description: 'Reference autonomous agent for proving A2A402 discovery, registration, claiming, work submission, settlement readiness, and re-spend flow.',
    endpoint,
    capabilities: [capability, 'research', 'verification', 'discovery']
  };
  if (wallet) registration.wallets = [{chain:'eip155:8453',address:wallet,walletType:'agent-controlled',assets:['A2A']}];

  const jobs = await request('/jobs');
  const job = chooseJob(jobs);
  if (!job) throw new Error(`No OPEN job found for ${capability} or fallback capabilities`);

  const joined = await request('/agents/register', {method:'POST', body: JSON.stringify(registration)});
  const agentId = joined.agent.id;
  const token = joined.authToken;

  const claimed = await request(`/jobs/${job.id}/claim`, {method:'POST', headers:auth(agentId, token)});
  const result = perform(claimed);
  const submitted = await request(`/jobs/${job.id}/submit`, {method:'POST', headers:auth(agentId, token), body:JSON.stringify({result})});

  const economy = await request(`/agents/${agentId}/economy`, {headers:auth(agentId, token)});

  console.log(JSON.stringify({
    ok:true,
    stage:'submitted',
    agentId,
    jobId:job.id,
    jobStatus:submitted.status,
    walletRegistered:Boolean(wallet),
    economyEndpoint:joined.economyEndpoint,
    balanceEndpoint:joined.balanceEndpoint,
    next:'Job creator must verify. If accepted, A2A payment intent becomes available to the payer agent executor.'
  }, null, 2));
}

main().catch(err => {
  console.error(JSON.stringify({ok:false,error:err.message},null,2));
  process.exitCode = 1;
});
