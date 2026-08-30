const MARKETPLACE = (process.env.A2A402_MARKETPLACE_URL || 'https://a2a402.market').replace(/\/$/, '');
const AGENT_ID = process.env.A2A402_AGENT_ID?.trim();
const AUTH_TOKEN = process.env.A2A402_AUTH_TOKEN?.trim();
const SIGNER_RPC = process.env.A2A402_SIGNER_RPC_URL?.trim();
const SIGNER_FROM = process.env.A2A402_SIGNER_FROM?.trim();
const MAX_PER_JOB_UNITS = process.env.A2A402_MAX_PER_JOB_UNITS ? BigInt(process.env.A2A402_MAX_PER_JOB_UNITS) : null;
const WATCH = process.argv.includes('--watch');
const POLL_MS = Math.max(30_000, Number(process.env.A2A402_EXECUTOR_POLL_MS || 60_000));
const TRANSFER_SELECTOR = 'a9059cbb';
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const HASH = /^0x[a-fA-F0-9]{64}$/;

if (!AGENT_ID || !AUTH_TOKEN || !SIGNER_RPC || !SIGNER_FROM) {
  throw new Error('A2A402_AGENT_ID, A2A402_AUTH_TOKEN, A2A402_SIGNER_RPC_URL, and A2A402_SIGNER_FROM are required');
}
if (!ADDRESS.test(SIGNER_FROM)) throw new Error('A2A402_SIGNER_FROM must be an EVM address');

const authHeaders = {
  accept: 'application/json',
  authorization: `Bearer ${AUTH_TOKEN}`,
  'x-agent-id': AGENT_ID
};

async function jsonFetch(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
  if (!response.ok) throw new Error(body.error || body.message || `HTTP ${response.status}`);
  return body;
}

async function rpc(method, params = []) {
  const body = await jsonFetch(SIGNER_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
  if (intent.payerAddress.toLowerCase() !== SIGNER_FROM.toLowerCase()) throw new Error(`signer address does not match job payer for ${intent.jobId}`);
  if (!Array.isArray(intent.transfers) || intent.transfers.length !== 2) throw new Error('intent must contain exactly two transfers');
  const purposes = new Set(intent.transfers.map(x => x.purpose));
  if (!purposes.has('worker') || !purposes.has('marketplace-fee')) throw new Error('intent transfer purposes are invalid');
  const total = intent.transfers.reduce((sum, transfer) => sum + BigInt(transfer.amountUnits), 0n);
  if (total !== BigInt(intent.totalAmountUnits)) throw new Error('intent split does not equal total amount');
  if (MAX_PER_JOB_UNITS !== null && total > MAX_PER_JOB_UNITS) throw new Error(`job ${intent.jobId} exceeds A2A402_MAX_PER_JOB_UNITS`);
}

async function executeIntent(intent) {
  validateIntent(intent);
  const freshJob = await jsonFetch(intent.verifyBeforeSigning, { headers: { accept: 'application/json' } });
  if (freshJob.id !== intent.jobId || freshJob.status !== 'AWAITING_PAYMENT') return { jobId: intent.jobId, skipped: true, reason: 'job no longer awaiting payment' };
  if (String(freshJob.payerAddress).toLowerCase() !== SIGNER_FROM.toLowerCase()) throw new Error('fresh job payer mismatch');
  const chainId = await rpc('eth_chainId');
  if (BigInt(chainId) !== 8453n) throw new Error(`signer RPC is on wrong chain: ${chainId}`);

  const hashes = {};
  for (const transfer of intent.transfers) {
    const txHash = await rpc('eth_sendTransaction', [{
      from: SIGNER_FROM,
      to: intent.tokenContract,
      value: '0x0',
      data: transferData(transfer.to, transfer.amountUnits)
    }]);
    if (!HASH.test(txHash || '')) throw new Error('signer RPC returned an invalid transaction hash');
    await waitForReceipt(txHash);
    hashes[transfer.purpose] = txHash;
  }

  const settled = await jsonFetch(`${MARKETPLACE}/jobs/${intent.jobId}/settle`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ workerTxHash: hashes.worker, feeTxHash: hashes['marketplace-fee'] })
  });
  return { jobId: intent.jobId, settled: true, workerTxHash: hashes.worker, feeTxHash: hashes['marketplace-fee'], status: settled.job?.status || settled.status || 'PAID' };
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
