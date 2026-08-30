import crypto from 'node:crypto';

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export function normalizePaymentExecutor(input = {}) {
  if (!input || typeof input !== 'object') throw new Error('paymentExecutor must be an object');
  const mode = String(input.mode || 'pull').toLowerCase();
  if (mode !== 'pull') throw new Error('paymentExecutor.mode must be pull');
  return {
    mode: 'pull',
    protocol: 'a2a402-payment-intent-v1',
    autoExecute: input.autoExecute !== false,
    chain: 'eip155:8453',
    asset: 'A2A',
    signerType: input.signerType ? String(input.signerType) : 'agent-controlled',
    maxPerJobUnits: input.maxPerJobUnits ? String(input.maxPerJobUnits) : null
  };
}

export function paymentIntentForJob(job, { baseUrl, tokenAddress, treasuryAddress }) {
  if (!job) throw new Error('job not found');
  if (job.status !== 'AWAITING_PAYMENT') throw new Error('job not awaiting payment');
  if (job.paymentAsset !== 'A2A' || job.paymentNetwork !== 'base') throw new Error('job is not a Base Mainnet A2A payment');
  if (!EVM_ADDRESS.test(job.payerAddress || '') || !EVM_ADDRESS.test(job.payeeAddress || '')) throw new Error('job payment wallets are invalid');
  if (!EVM_ADDRESS.test(tokenAddress || '') || !EVM_ADDRESS.test(treasuryAddress || '')) throw new Error('A2A payment configuration is invalid');
  const payload = [job.id, job.payerAddress.toLowerCase(), job.payeeAddress.toLowerCase(), String(job.workerPaymentUnits), treasuryAddress.toLowerCase(), String(job.marketplaceFeeUnits), tokenAddress.toLowerCase()].join('|');
  const intentId = `pay_${crypto.createHash('sha256').update(payload).digest('hex').slice(0,32)}`;
  return {
    protocol: 'a2a402-payment-intent-v1',
    intentId,
    jobId: job.id,
    status: job.status,
    chain: 'eip155:8453',
    network: 'base',
    chainId: 8453,
    asset: 'A2A',
    tokenContract: tokenAddress,
    payerAddress: job.payerAddress,
    totalAmountUnits: String(job.paymentAmountUnits),
    transfers: [
      { purpose: 'worker', to: job.payeeAddress, amountUnits: String(job.workerPaymentUnits) },
      { purpose: 'marketplace-fee', to: treasuryAddress, amountUnits: String(job.marketplaceFeeUnits) }
    ],
    safety: {
      exactContract: true,
      exactRecipients: true,
      exactAmounts: true,
      twoDistinctTransactionsRequired: true,
      privateKeyNeverSharedWithMarketplace: true,
      signerMustBeControlledByPayerAgent: true
    },
    verifyBeforeSigning: `${baseUrl}/jobs/${job.id}`,
    submitSettlement: {
      method: 'POST',
      url: `${baseUrl}/jobs/${job.id}/settle`,
      body: { workerTxHash: '<0x...>', feeTxHash: '<0x...>' }
    }
  };
}

export function pendingPaymentIntents(economy, agentId, config) {
  return [...economy.jobs.values()]
    .filter(job => job.creatorId === agentId && job.status === 'AWAITING_PAYMENT' && job.paymentAsset === 'A2A' && job.paymentNetwork === 'base')
    .map(job => paymentIntentForJob(job, config));
}

export function transactionHashAlreadyUsed(economy, txHash) {
  const needle = String(txHash || '').toLowerCase();
  if (!needle) return false;
  return economy.transactions.some(tx => [tx.reference, tx.feeReference].some(ref => String(ref || '').toLowerCase() === needle));
}
