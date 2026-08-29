import { Economy } from '../../apps/api/src/economy.js';
import { registerSeeds } from '../../apps/api/src/seed.js';

const baseUrl = process.env.APP_BASE_URL || process.env.URL || 'https://a2a402.market';
const economy = new Economy({ loungeEnabled: process.env.A2A402_ENABLE_LOUNGE !== 'false' });
registerSeeds(economy, { baseUrl });

const headers = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type,x-agent-id',
  'access-control-allow-methods': 'GET,POST,OPTIONS'
};
const reply = (statusCode, value) => ({ statusCode, headers, body: JSON.stringify(value) });
const parseBody = event => {
  if (!event.body) return {};
  if (event.body.length > 1_000_000) throw new Error('payload too large');
  return JSON.parse(event.body);
};
const authenticate = event => {
  const agentId = event.headers?.['x-agent-id'] ?? event.headers?.['X-Agent-Id'];
  const auth = event.headers?.authorization ?? event.headers?.Authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!economy.authenticate(agentId, token)) throw new Error('unauthorized');
  return agentId;
};
const requestPath = event => {
  const raw = event.rawUrl ? new URL(event.rawUrl).pathname : event.path || '/';
  return raw.replace(/^\/\.netlify\/functions\/api/, '') || '/';
};
const query = event => event.queryStringParameters || {};

async function runCanary() {
  const creator = economy.agents.get('agent_10');
  const worker = economy.agents.get('agent_1');
  const job = economy.createJob({
    creatorId: creator.id,
    creatorType: 'agent',
    title: 'Live research canary',
    description: 'Bounded production-path test of the A2A402 test economy.',
    requiredCapability: 'research',
    reward: 0.001,
    verificationMethod: 'deterministic'
  });
  economy.claimJob(job.id, worker.id);
  economy.submitJob(job.id, worker.id, { ok: true, canary: true, workerEndpoint: worker.endpoint });
  await economy.verifyJob(job.id, creator.id, { accepted: true });
  const tx = economy.transactions.find(item => item.jobId === job.id);
  return {
    ok: true,
    environment: 'test',
    realMoney: false,
    job,
    transaction: tx,
    worker: economy.publicAgent(worker),
    stats: economy.stats()
  };
}

export async function handler(event) {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
    const method = event.httpMethod;
    const p = requestPath(event);
    const q = query(event);

    if (method === 'GET' && p === '/health') return reply(200, { status: 'ok', environment: 'test', realMoney: false, runtime: 'netlify' });
    if (method === 'GET' && p === '/economy/stats') return reply(200, economy.stats());
    if (method === 'GET' && p === '/economy/activity') return reply(200, economy.activity());
    if (method === 'GET' && p === '/economy/graph') return reply(200, economy.graph());
    if (method === 'POST' && p === '/economy/canary') return reply(200, await runCanary());
    if (method === 'GET' && p === '/agents/search') return reply(200, economy.searchAgents({ requiredCapability: q.capability || '', maxPrice: q.maxPrice || Infinity, minimumReputation: Number(q.minimumReputation || 0) }));
    if (method === 'POST' && p === '/agents/register') {
      const agent = economy.registerAgent(parseBody(event));
      return reply(201, { agent: economy.publicAgent(agent), authToken: agent._registrationToken });
    }
    if (method === 'GET' && /^\/agents\/[^/]+$/.test(p)) {
      const agent = economy.agents.get(p.split('/')[2]);
      return agent ? reply(200, economy.publicAgent(agent)) : reply(404, { error: 'not found' });
    }
    if (method === 'POST' && p === '/jobs') {
      const agentId = authenticate(event);
      return reply(201, economy.createJob({ ...parseBody(event), creatorId: agentId, creatorType: 'agent' }));
    }
    if (method === 'GET' && p === '/jobs') return reply(200, [...economy.jobs.values()]);
    if (method === 'GET' && /^\/jobs\/[^/]+$/.test(p)) {
      const job = economy.jobs.get(p.split('/')[2]);
      return job ? reply(200, job) : reply(404, { error: 'not found' });
    }
    if (method === 'POST' && /\/jobs\/[^/]+\/claim$/.test(p)) return reply(200, economy.claimJob(p.split('/')[2], authenticate(event)));
    if (method === 'POST' && /\/jobs\/[^/]+\/submit$/.test(p)) {
      const agentId = authenticate(event); const data = parseBody(event);
      return reply(200, economy.submitJob(p.split('/')[2], agentId, data.result));
    }
    if (method === 'POST' && /\/jobs\/[^/]+\/verify$/.test(p)) {
      const agentId = authenticate(event); const data = parseBody(event);
      return reply(200, await economy.verifyJob(p.split('/')[2], agentId, { accepted: data.accepted !== false }));
    }
    if (method === 'POST' && /\/jobs\/[^/]+\/cancel$/.test(p)) return reply(200, economy.cancelJob(p.split('/')[2], authenticate(event)));
    if (method === 'GET' && p === '/services') return reply(200, [...economy.services.values()]);
    if (method === 'POST' && p === '/services') {
      const agentId = authenticate(event);
      return reply(201, economy.createService({ ...parseBody(event), ownerAgentId: agentId }));
    }
    if (method === 'GET' && /^\/reputation\/[^/]+$/.test(p)) {
      const reputation = economy.reputations.get(p.split('/')[2]);
      return reputation ? reply(200, reputation) : reply(404, { error: 'not found' });
    }
    if (method === 'GET' && p === '/lounge/messages') return reply(200, economy.lounge);
    if (method === 'POST' && p === '/lounge/messages') return reply(201, economy.postLoungeMessage({ ...parseBody(event), agentId: authenticate(event) }));
    if (method === 'GET' && p === '/.well-known/agent-card.json') return reply(200, economy.getAgentCard('agent_10', baseUrl));
    if (method === 'POST' && p === '/a2a') {
      const data = parseBody(event);
      const targetId = q.agentId || 'agent_10';
      const target = economy.agents.get(targetId);
      if (!target) return reply(404, { jsonrpc: '2.0', id: data.id, error: { code: -32004, message: 'Agent not found' } });
      if (data.method === 'tasks/list') return reply(200, { jsonrpc: '2.0', id: data.id, result: [...economy.jobs.values()].filter(job => job.workerId === targetId || job.creatorId === targetId) });
      if (data.method === 'message/send') return reply(200, { jsonrpc: '2.0', id: data.id, result: { accepted: true, agentId: target.id, name: target.name, endpoint: target.endpoint, capabilities: target.capabilities.map(cap => cap.name) } });
      return reply(400, { jsonrpc: '2.0', id: data.id, error: { code: -32601, message: 'Method not found' } });
    }
    return reply(404, { error: 'not found' });
  } catch (error) {
    return reply(error.message === 'unauthorized' ? 401 : 400, { error: error.message });
  }
}
