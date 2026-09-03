import { id, now, assert } from '../../../packages/protocol/src/index.js';

function ensureCollections(economy) {
  if (!(economy.bids instanceof Map)) economy.bids = new Map();
  if (!(economy.contracts instanceof Map)) economy.contracts = new Map();
  return economy;
}
function key(value){const v=value==null?null:String(value).trim();assert(v==null||v.length<=200,'idempotencyKey too long');return v||null}

export function submitBid(economy, jobId, bidderId, input = {}) {
  ensureCollections(economy);
  const idem=key(input.idempotencyKey);
  if(idem){const existing=[...economy.bids.values()].find(b=>b.jobId===jobId&&b.bidderId===bidderId&&b.idempotencyKey===idem);if(existing)return existing}
  const job = economy.jobs.get(jobId);
  const bidder = economy.agents.get(bidderId);
  assert(job, 'job not found');
  assert(bidder, 'bidder not found');
  assert(job.status === 'OPEN', 'job not open for bids');
  assert(job.creatorId !== bidderId, 'creator cannot bid on own job');
  assert(bidder.capabilities?.some(c => c.name === job.requiredCapability && c.availability !== false), 'bidder lacks required capability');
  assert(![...economy.bids.values()].some(b => b.jobId === jobId && b.bidderId === bidderId && b.status === 'OPEN'), 'bidder already has an open bid for this job');

  const amount = Number(input.amount ?? job.reward);
  assert(Number.isFinite(amount) && amount > 0, 'bid amount must be positive');
  assert(amount === Number(job.reward), 'bid amount must match posted reward');

  const bid = {
    id: id('bid'), jobId, bidderId, creatorId: job.creatorId, amount,
    paymentAsset: job.paymentAsset, paymentNetwork: job.paymentNetwork,
    message: input.message ? String(input.message).slice(0, 4000) : null,
    estimatedSeconds: input.estimatedSeconds == null ? null : Number(input.estimatedSeconds),
    idempotencyKey:idem,status: 'OPEN', createdAt: now(), updatedAt: now(), selectedAt: null, withdrawnAt: null, rejectedAt: null, contractId: null,
  };
  if (bid.estimatedSeconds != null) assert(Number.isFinite(bid.estimatedSeconds) && bid.estimatedSeconds > 0, 'estimatedSeconds must be positive');
  economy.bids.set(bid.id, bid);
  economy.event('BID_SUBMITTED', { bidId: bid.id, jobId, bidderId, creatorId: job.creatorId, amount });
  return bid;
}

export function withdrawBid(economy, bidId, bidderId) {
  ensureCollections(economy);
  const bid = economy.bids.get(bidId);
  assert(bid, 'bid not found');
  assert(bid.bidderId === bidderId, 'only bidder may withdraw bid');
  if(bid.status==='WITHDRAWN')return bid;
  assert(bid.status === 'OPEN', 'bid not open');
  bid.status = 'WITHDRAWN'; bid.withdrawnAt = now(); bid.updatedAt = bid.withdrawnAt;
  economy.event('BID_WITHDRAWN', { bidId, jobId: bid.jobId, bidderId });
  return bid;
}

export function selectBid(economy, bidId, creatorId, input={}) {
  ensureCollections(economy);
  const idem=key(input.idempotencyKey);
  if(idem){const existing=[...economy.contracts.values()].find(c=>c.bidId===bidId&&c.creatorId===creatorId&&c.selectionIdempotencyKey===idem);if(existing){const bid=economy.bids.get(bidId),job=economy.jobs.get(existing.jobId);return{bid,contract:syncContractFromJob(economy,existing.jobId)||existing,job}}}
  const bid = economy.bids.get(bidId);
  assert(bid, 'bid not found');
  assert(bid.creatorId === creatorId, 'only job creator may select bid');
  assert(bid.status === 'OPEN', 'bid not open');
  const job = economy.jobs.get(bid.jobId);
  assert(job, 'job not found');
  assert(job.status === 'OPEN', 'job not open');
  const claimed = economy.claimJob(job.id, bid.bidderId);
  bid.status = 'SELECTED'; bid.selectedAt = now(); bid.updatedAt = bid.selectedAt;
  for (const other of economy.bids.values()) {
    if (other.jobId !== job.id || other.id === bid.id || other.status !== 'OPEN') continue;
    other.status = 'REJECTED'; other.rejectedAt = now(); other.updatedAt = other.rejectedAt;
    economy.event('BID_REJECTED', { bidId: other.id, jobId: job.id, bidderId: other.bidderId, reason: 'another bid selected' });
  }
  const contract = {
    id: id('contract'), jobId: job.id, bidId: bid.id, creatorId, workerId: bid.bidderId,
    requiredCapability: job.requiredCapability, amount: Number(job.reward), paymentAsset: claimed.paymentAsset,
    paymentNetwork: claimed.paymentNetwork, payerAddress: claimed.payerAddress, payeeAddress: claimed.payeeAddress,
    marketplaceFeeBps: claimed.marketplaceFeeBps, workerPaymentUnits: claimed.workerPaymentUnits,
    marketplaceFeeUnits: claimed.marketplaceFeeUnits, verificationMethod: claimed.verificationMethod,
    deadline: claimed.deadline, selectionIdempotencyKey:idem,status: 'ACTIVE', createdAt: now(), activatedAt: now(), completedAt: null, settledAt: null,
  };
  economy.contracts.set(contract.id, contract); bid.contractId = contract.id; job.contractId = contract.id; job.selectedBidId = bid.id; job.updatedAt = now();
  economy.event('BID_SELECTED', { bidId: bid.id, jobId: job.id, creatorId, bidderId: bid.bidderId, contractId: contract.id });
  economy.event('CONTRACT_ACTIVATED', { contractId: contract.id, jobId: job.id, creatorId, workerId: bid.bidderId });
  return { bid, contract, job: claimed };
}

export function syncContractFromJob(economy, jobId) {
  ensureCollections(economy); const job = economy.jobs.get(jobId); if (!job?.contractId) return null; const contract = economy.contracts.get(job.contractId); if (!contract) return null;
  const nextStatus = job.status === 'PAID' ? 'SETTLED' : job.status === 'COMPLETED' || job.status === 'AWAITING_PAYMENT' ? 'COMPLETED' : job.status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE';
  if (contract.status !== nextStatus) { contract.status = nextStatus; if (nextStatus === 'COMPLETED' && !contract.completedAt) contract.completedAt = now(); if (nextStatus === 'SETTLED' && !contract.settledAt) contract.settledAt = now(); }
  return contract;
}

export function listJobBids(economy, jobId, requesterId = null) {
  ensureCollections(economy); const job = economy.jobs.get(jobId); assert(job, 'job not found');
  return [...economy.bids.values()].filter(bid => bid.jobId === jobId && (requesterId === job.creatorId || requesterId === bid.bidderId || bid.status === 'SELECTED'));
}
export function getContract(economy, contractId, requesterId = null) {
  ensureCollections(economy); const contract = economy.contracts.get(contractId); assert(contract, 'contract not found'); assert(!requesterId || requesterId === contract.creatorId || requesterId === contract.workerId, 'not authorized for contract'); syncContractFromJob(economy, contract.jobId); return contract;
}
export function listAgentContracts(economy, agentId) {
  ensureCollections(economy); return [...economy.contracts.values()].filter(c => c.creatorId === agentId || c.workerId === agentId).map(c => syncContractFromJob(economy, c.jobId) || c);
}
