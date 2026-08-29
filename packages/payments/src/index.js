import { id, now, assert } from '../../protocol/src/index.js';

export class PaymentProvider {
  async settle() { throw new Error('Not implemented'); }
}

export class MockTestProvider extends PaymentProvider {
  constructor() { super(); this.settlements = new Map(); }
  async settle({ idempotencyKey, jobId, payer, payee, amount, asset, network }) {
    assert(idempotencyKey, 'idempotencyKey required');
    if (this.settlements.has(idempotencyKey)) return this.settlements.get(idempotencyKey);
    const tx = { id: id('tx'), jobId, payer, payee, amount, asset, network, status: 'SETTLED', provider: 'mock', reference: `mock:${jobId}:${idempotencyKey}`, timestamp: now() };
    this.settlements.set(idempotencyKey, tx);
    return tx;
  }
}

export class X402Provider extends PaymentProvider {
  constructor() { super(); this.enabled = false; }
  async settle() { throw new Error('X402Provider is intentionally disabled in v0.1. Configure testnet credentials outside source before enabling.'); }
}
