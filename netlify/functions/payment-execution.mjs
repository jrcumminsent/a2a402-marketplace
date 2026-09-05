import { withEconomy, persistenceMode } from '../../apps/api/src/persistence.js';
import { paymentIntentForJob, pendingPaymentIntents } from '../../apps/api/src/payment-execution.js';

const baseUrl = process.env.APP_BASE_URL || process.env.URL || 'https://a2a402.market';
const tokenAddress = (process.env.A2A402_TOKEN_ADDRESS || '0xF2bb6DC14E9097EC08F9Eaa9C6B7d39662195F01').trim();
const treasuryAddress = (process.env.A2A402_TREASURY_ADDRESS || '0xD08eA67ef730fc336a9B6fB89A4B66dF67Fbb69c').trim();
const headers = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type,x-agent-id',
  'access-control-allow-methods': 'GET,OPTIONS'
};
const reply = (statusCode, value) => ({ statusCode, headers, body: JSON.stringify(value) });
const authenticate = (economy, event) => {
  const agentId = event.headers?.['x-agent-id'] ?? event.headers?.['X-Agent-Id'];
  const auth = event.headers?.authorization ?? event.headers?.Authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!economy.authenticate(agentId, token)) throw new Error('unauthorized');
  return agentId;
};
const pathFor = event => {
  const raw = event.rawUrl ? new URL(event.rawUrl).pathname : event.path || '/';
  return raw.replace(/^\/\.netlify\/functions\/payment-execution/, '') || '/';
};

export async function handler(event) {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
    if (event.httpMethod !== 'GET') return reply(405, { error: 'method not allowed' });
    return await withEconomy(async economy => {
      const agentId = authenticate(economy, event);
      const p = pathFor(event);
      const config = { baseUrl, tokenAddress, treasuryAddress };
      if (p === '/payments/execution/intents') {
        return reply(200, {
          protocol: 'a2a402-payment-intent-v1',
          environment: 'production',
          realMoney: true,
          persistence: persistenceMode(),
          custody: false,
          signer: 'payer-agent-controlled',
          agentId,
          intents: pendingPaymentIntents(economy, agentId, config)
        });
      }
      const match = p.match(/^\/payments\/execution\/jobs\/([^/]+)$/);
      if (match) {
        const job = economy.jobs.get(match[1]);
        if (!job) return reply(404, { error: 'job not found' });
        if (job.creatorId !== agentId) throw new Error('only creator may retrieve payment intent');
        return reply(200, paymentIntentForJob(job, config));
      }
      return reply(404, { error: 'not found' });
    }, { baseUrl, loungeEnabled: process.env.A2A402_ENABLE_LOUNGE !== 'false' });
  } catch (error) {
    return reply(error.message === 'unauthorized' ? 401 : 400, { error: error.message });
  }
}
