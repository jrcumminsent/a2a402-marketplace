import fs from 'node:fs';

const baseUrl = process.env.A2A402_CANARY_BASE_URL || 'https://a2a402.market';
const creatorWallet = process.env.A2A402_CANARY_CREATOR_WALLET;
const workerWallet = process.env.A2A402_CANARY_WORKER_WALLET;
const workerTxHash = process.env.A2A402_CANARY_WORKER_TX_HASH;
const feeTxHash = process.env.A2A402_CANARY_FEE_TX_HASH;
const statePath = process.env.A2A402_CANARY_STATE_FILE || '.a2a402-canary-state.json';

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${path}: ${body.error || response.statusText}`);
  return body;
}

function auth(agent) {
  return {
    'content-type': 'application/json',
    'X-Agent-Id': agent.id,
    Authorization: `Bearer ${agent.authToken}`
  };
}

async function register(name, capability, address) {
  const response = await request('/agents/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name,
      description: 'Internal A2A402 live settlement canary agent',
      endpoint: `${baseUrl}/a2a`,
      capabilities: [capability],
      wallets: [{ chain: 'eip155:84532', address, assets: ['A2A'], walletType: 'external' }]
    })
  });
  return { ...response.agent, authToken: response.authToken };
}

let state = null;
if (fs.existsSync(statePath)) state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

if (!state) {
  if (!creatorWallet || !workerWallet) {
    console.error('Set A2A402_CANARY_CREATOR_WALLET and A2A402_CANARY_WORKER_WALLET to public Base Sepolia addresses.');
    process.exit(1);
  }

  const stamp = Date.now();
  const creator = await register(`A2A Canary Creator ${stamp}`, 'broker', creatorWallet);
  const worker = await register(`A2A Canary Worker ${stamp}`, 'research', workerWallet);

  let job = await request('/jobs', {
    method: 'POST',
    headers: auth(creator),
    body: JSON.stringify({
      title: 'Internal first A2A settlement canary',
      description: 'Real Base Sepolia A2A 95/5 settlement verification.',
      requiredCapability: 'research',
      reward: '1',
      paymentAsset: 'A2A',
      paymentNetwork: 'base-sepolia'
    })
  });

  job = await request(`/jobs/${job.id}/claim`, { method: 'POST', headers: auth(worker) });
  job = await request(`/jobs/${job.id}/submit`, {
    method: 'POST',
    headers: auth(worker),
    body: JSON.stringify({ result: { ok: true, note: 'Internal A2A canary completed' } })
  });
  job = await request(`/jobs/${job.id}/verify`, {
    method: 'POST',
    headers: auth(creator),
    body: JSON.stringify({ accepted: true })
  });

  state = { baseUrl, creator, worker, jobId: job.id, creatorWallet, workerWallet };
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });

  console.log(JSON.stringify({
    phase: 'awaiting_onchain_payment',
    jobId: job.id,
    status: job.status,
    creatorAgentId: creator.id,
    workerAgentId: worker.id,
    creatorWallet,
    workerWallet,
    grossRewardA2A: job.reward,
    workerPaymentUnits: job.workerPaymentUnits,
    marketplaceFeeUnits: job.marketplaceFeeUnits,
    marketplaceFeeBps: job.marketplaceFeeBps,
    stateFile: statePath,
    next: 'Send the exact worker and treasury A2A transfers on Base Sepolia, then rerun with A2A402_CANARY_WORKER_TX_HASH and A2A402_CANARY_FEE_TX_HASH.'
  }, null, 2));
  process.exit(0);
}

if (!workerTxHash || !feeTxHash) {
  console.log(JSON.stringify({
    phase: 'awaiting_onchain_payment',
    jobId: state.jobId,
    creatorWallet: state.creatorWallet,
    workerWallet: state.workerWallet,
    stateFile: statePath,
    next: 'Provide A2A402_CANARY_WORKER_TX_HASH and A2A402_CANARY_FEE_TX_HASH to settle this same job.'
  }, null, 2));
  process.exit(0);
}

const settled = await request(`/jobs/${state.jobId}/settle`, {
  method: 'POST',
  headers: auth(state.creator),
  body: JSON.stringify({ workerTxHash, feeTxHash })
});

console.log(JSON.stringify({ phase: 'settled', jobId: state.jobId, result: settled }, null, 2));
fs.rmSync(statePath, { force: true });
