import fs from 'node:fs';

const MARKETPLACE = (process.env.A2A402_MARKETPLACE_URL || 'https://a2a402.market').replace(/\/$/, '');
const AGENT_ID = process.env.A2A402_AGENT_ID?.trim();
const AUTH_TOKEN = process.env.A2A402_AUTH_TOKEN?.trim();
const SIGNER_RPC = process.env.A2A402_SIGNER_RPC_URL?.trim();
const SIGNER_RPC_TOKEN = process.env.A2A402_SIGNER_RPC_TOKEN?.trim();
const SIGNER_FROM = process.env.A2A402_SIGNER_FROM?.trim();
const EXPECTED_TOKEN = (process.env.A2A402_EXPECTED_TOKEN_ADDRESS || '0xF2bb6DC14E9097EC08F9Eaa9C6B7d39662195F01').trim();
const EXPECTED_TREASURY = process.env.A2A402_EXPECTED_TREASURY_ADDRESS?.trim();
const MAX_PER_JOB_UNITS = process.env.A2A402_MAX_PER_JOB_UNITS ? BigInt(process.env.A2A402_MAX_PER_JOB_UNITS) : null;
const WATCH = process.argv.includes('--watch');
const POLL_MS = Math.max(30_000, Number(process.env.A2A402_EXECUTOR_POLL_MS || 60_000));
const STATE_FILE = process.env.A2A402_EXECUTOR_STATE_FILE || '.a2a402-payment-executor-state.json';
const TRANSFER_SELECTOR = 'a9059cbb';
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const HASH = /^0x[a-fA-F0-9]{64}$/;

if (!AGENT_ID || !AUTH_TOKEN || !SIGNER_RPC || !SIGNER_FROM || !EXPECTED_TREASURY) {
  throw new Error('A2A402_AGENT_ID, A2A402_AUTH_TOKEN, A2A402_SIGNER_RPC_URL, A2A402_SIGNER_FROM, and A2A402_EXPECTED_TREASURY_ADDRESS are required');
}
for (const [name, value] of [['A2A402_SIGNER_FROM', SIGNER_FROM], ['A2A402_EXPECTED_TOKEN_ADDRESS', EXPECTED_TOKEN], ['A2A402_EXPECTED_TREASURY_ADDRESS', EXPECTED_TREASURY]]) {
  if (!ADDRESS.test(value)) throw new Error(`${name} must be an EVM address`);
}

const authHeaders = {
  accept: 'application/json',
  authorization: `Bearer ${AUTH_TOKEN}`,
  'x-agent-id': AGENT_ID
};

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { intents: {} }; }
}
function saveState(state) {
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, STATE_FILE);
}
const state = loadState();

async function jsonFetch(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
  if (!response.ok) throw new Error(body.error || body.message || `HTTP ${response.status}`);
  return body;
}

async function rpc(method, params = []) {
  const headers = { 'content-type': 'application/json' };
  if (SIGNER_RPC_TOKEN) headers.authorization = `Bearer ${SIGNER_RPC_TOKEN}`;
  const body = await jsonFetch(SIGNER_RPC, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
  });
  if (body.error) throw new Error(body.error.message || `signer RPC error calling ${method}`);
  return body.result;
}

function transferData(to, amountUnits) {
  if (!ADDRESS.test(to)) throw new Error('invalid transfer recipient');
  const amount = BigInt(amountUnits);
  if (amount < 0n) throw new Error('invalid transfer amount');
  return `0x${TRANSFER_SELECTOR}${to.slice(2).toLowerCase().padStart(64, '0')}${amount.toString(16).padStart(64, '0')}`;
}

async function waitForReceipt(txHash) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const receipt = await rpc('eth_getTransactionReceipt', [txHash]);
    if (receipt) {
      if (receipt.status !== '0x1') throw new Error(`transaction failed: ${txHash}`);
      return receipt;
    }
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  throw new Error(`transaction receipt timeout: ${txHash}`);
}

function validateIntent(intent) {
  if (intent.protocol !== 'a2a402-payment-intent-v1') throw new Error('unsupported payment intent protocol');
  if (intent.chainId !== 8453 || intent.network !== 'base' || intent.asset !== 'A2A') throw new Error('executor only supports A2A on Base Mainnet');
  if (!ADDRESS.test(intent.tokenContract) || !ADDRESS.test(intent.payerAddress)) throw new Error('invalid intent addresses');
  if (intent.tokenContract.toLowerCase() !== EXPECTED_TOKEN.toLowerCase()) throw new Error(`unexpected token contract for ${intent.jobId}`);
  if (intent.payerAddress.toLowerCase() !== SIGNER_FROM.toLowerCase()) throw new Error(`signer address does not match job payer for ${intent.jobId}`);
  if (!Array.isArray(intent.transfers) || intent.transfers.length !== 2) throw new Error('intent must contain exactly two transfers');
  const worker = intent.transfers.find(x => x.purpose === 'worker');
  const fee = intent.transfers.find(x => x.purpose === 'marketplace-fee');
  if (!worker || !fee || !ADDRESS.test(worker.to) || !ADDRESS.test(fee.to)) throw new Error('intent transfer purposes or recipients are invalid');
  if (fee.to.toLowerCase() !== EXPECTED_TREASURY.toLowerCase()) throw new Error(`unexpected treasury recipient for ${intent.jobId}`);
  const total = intent.transfers.reduce((sum, transfer) => sum + BigInt(transfer.amountUnits), 0n);
  if (total !== BigInt(intent.totalAmountUnits)) throw new Error('intent split does not equal total amount');
  if (MAX_PER_JOB_UNITS !== null && total > MAX_PER_JOB_UNITS) throw new Error(`job ${intent.jobId} exceeds A2A402_MAX_PER_JOB_UNITS`);
  if (!intent.safety?.exactContract || !intent.safety?.exactRecipients || !intent.safety?.exactAmounts) throw new Error('intent does not assert required safety constraints');
  return { worker, fee, total };
}

async function sendTransfer(intent, transfer) {
  const journal = state.intents[intent.intentId] ||= { jobId: intent.jobId, hashes: {} };
  const prior = journal.hashes[transfer.purpose];
  if (prior) {
    await waitForReceipt(prior);
    return prior;
  }
  const txHash = await rpc('eth_sendTransaction', [{
    from: SIGNER_FROM,
    to: intent.tokenContract,
    value: '0x0',
    data: transferData(transfer.to, transfer.amountUnits)
  }]);
  if (!HASH.test(txHash || '')) throw new Error('signer RPC returned an invalid transaction hash');
  journal.hashes[transfer.purpose] = txHash;
  saveState(state);
  await waitForReceipt(txHash);
  return txHash;
}

async function executeIntent(intent) {
  const { worker, fee } = validateIntent(intent);
  const freshJob = await jsonFetch(intent.verifyBeforeSigning, { headers: { accept: 'application/json' } });
  if (freshJob.id !== intent.jobId || freshJob.status !== 'AWAITING_PAYMENT') return { jobId: intent.jobId, skipped: true, reason: 'job no longer awaiting payment' };
  if (String(freshJob.payerAddress).toLowerCase() !== SIGNER_FROM.toLowerCase()) throw new Error('fresh job payer mismatch');
  if (String(freshJob.payeeAddress).toLowerCase() !== worker.to.toLowerCase()) throw new Error('fresh job payee mismatch');
  if (BigInt(freshJob.workerPaymentUnits) !== BigInt(worker.amountUnits) || BigInt(freshJob.marketplaceFeeUnits) !== BigInt(fee.amountUnits)) throw new Error('fresh job payment amounts changed');
  const chainId = await rpc('eth_chainId');
  if (BigInt(chainId) !== 8453n) throw new Error(`signer RPC is on wrong chain: ${chainId}`);

  const workerTxHash = await sendTransfer(intent, worker);
  const feeTxHash = await sendTransfer(intent, fee);

  const settled = await jsonFetch(`${MARKETPLACE}/jobs/${intent.jobId}/settle`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ workerTxHash, feeTxHash })
  });
  delete state.intents[intent.intentId];
  saveState(state);
  return { jobId: intent.jobId, settled: true, workerTxHash, feeTxHash, status: settled.job?.status || settled.status || 'PAID' };
}

async function runOnce() {
  const pending = await jsonFetch(`${MARKETPLACE}/payments/execution/intents`, { headers: authHeaders });
  const results = [];
  for (const intent of pending.intents || []) {
    try { results.push(await executeIntent(intent)); }
    catch (error) { results.push({ jobId: intent.jobId, error: error.message }); }
  }
  console.log(JSON.stringify({ ok: true, agentId: AGENT_ID, checkedAt: new Date().toISOString(), results }, null, 2));
}

if (WATCH) {
  for (;;) {
    await runOnce();
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
} else {
  await runOnce();
}
