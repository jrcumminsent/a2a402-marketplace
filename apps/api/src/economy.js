import crypto from 'node:crypto';
import { id, now, assert, normalizeCapability, agentCard } from '../../../packages/protocol/src/index.js';
import { MockTestProvider } from '../../../packages/payments/src/index.js';
import { emptyReputation, recordSuccess, recordFailure } from '../../../packages/reputation/src/index.js';

const ETH_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const NETWORK_CAIP = {
  'base-sepolia': 'eip155:84532',
  base: 'eip155:8453',
  ethereum: 'eip155:1',
  solana: 'solana:mainnet',
  bitcoin: 'bip122:bitcoin'
};
const CAIP_NETWORK = Object.fromEntries(Object.entries(NETWORK_CAIP).map(([name, caip]) => [caip, name]));
const A2A_FEE_BPS = 500n;
const BPS_DENOMINATOR = 10000n;

function normalizeAsset(value='') { return String(value).trim().toUpperCase(); }
function normalizeChain(value='') { return NETWORK_CAIP[String(value).trim().toLowerCase()] || String(value).trim(); }
function networkForChain(chain='') { return CAIP_NETWORK[chain] || chain; }

function decimalToUnits(value, decimals = 18) {
  const raw = String(value);
  assert(/^\d+(\.\d+)?$/.test(raw), 'reward must be a plain positive decimal');
  const [whole, fraction = ''] = raw.split('.');
  assert(fraction.length <= decimals, `reward supports at most ${decimals} decimals`);
  return (BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals))).toString();
}

function normalizeWallet(wallet) {
  assert(wallet && typeof wallet === 'object', 'wallet must be an object');
  const chain = normalizeChain(wallet.chain || wallet.network || '');
  const address = String(wallet.address || '').trim();
  assert(chain && address, 'wallet chain and address required');
  return {
    id: wallet.id || id('wallet'),
    chain,
    address,
    label: wallet.label ? String(wallet.label) : null,
    walletType: wallet.walletType ? String(wallet.walletType) : null,
    assets: Array.isArray(wallet.assets) ? [...new Set(wallet.assets.map(normalizeAsset).filter(Boolean))] : []
  };
}

function walletsFor(agent) {
  const wallets = Array.isArray(agent?.wallets) ? agent.wallets : [];
  if (wallets.length) return wallets;
  if (ETH_ADDRESS.test(agent?.paymentAddress || '')) {
    return [{
      id: `${agent.id}:legacy-wallet`,
      chain: 'eip155:84532',
      address: agent.paymentAddress,
      label: 'Legacy Base Sepolia wallet',
      walletType: null,
      assets: ['A2A']
    }];
  }
  return [];
}

function walletFor(agent, paymentNetwork, asset) {
  const chain = normalizeChain(paymentNetwork);
  const wanted = normalizeAsset(asset);
  return walletsFor(agent).find(wallet => wallet.chain === chain && (!wallet.assets?.length || wallet.assets.includes(wanted)))
    || walletsFor(agent).find(wallet => wallet.chain === chain)
    || null;
}

function feeSplit(totalUnits) {
  const total = BigInt(totalUnits);
  const fee = total * A2A_FEE_BPS / BPS_DENOMINATOR;
  const worker = total - fee;
  return { feeUnits: fee.toString(), workerUnits: worker.toString(), feeBps: Number(A2A_FEE_BPS) };
}

function declaredWalletAssets(agent) {
  return walletsFor(agent).flatMap(wallet => wallet.assets.map(asset => ({
    walletId: wallet.id,
    chain: wallet.chain,
    network: networkForChain(wallet.chain),
    address: wallet.address,
    walletType: wallet.walletType,
    asset
  })));
}

function builtInRouteSupport(route) {
  if (route.kind === 'direct' && route.chain === 'eip155:84532' && route.asset === 'A2A') {
    return { available: true, settlementSupport: 'verified', adapter: 'base-sepolia-a2a-erc20' };
  }
  return { available: false, settlementSupport: 'adapter-required', adapter: null };
}

function routeSort(a, b) {
  const score = route => {
    if (route.available && route.asset === 'A2A' && route.chain === 'eip155:84532') return 0;
    if (route.available && route.kind === 'direct') return 1;
    if (route.kind === 'direct') return 2;
    return 3;
  };
  return score(a) - score(b);
}

export class Economy {
  constructor({ paymentProvider = new MockTestProvider(), loungeEnabled = true, paymentAdapters = [] } = {}) {
    this.paymentProvider = paymentProvider;
    this.loungeEnabled = loungeEnabled;
    this.paymentAdapters = Array.isArray(paymentAdapters) ? paymentAdapters : [];
    this.agents = new Map();
    this.jobs = new Map();
    this.transactions = [];
    this.reputations = new Map();
    this.services = new Map();
    this.lounge = [];
    this.events = [];
  }

  event(type, data={}) {
    const e = { id: id('evt'), type, at: now(), ...data };
    this.events.push(e);
    return e;
  }

  registerAgent(input) {
    assert(input?.name && input?.description && input?.endpoint, 'name, description, endpoint required');
    assert(Array.isArray(input.capabilities) && input.capabilities.length, 'capabilities required');
    const agentId = input.id ?? id('agent');
    const capabilities = input.capabilities.map((c,i) => typeof c === 'string'
      ? ({ id: `${agentId}:cap:${i}`, name: normalizeCapability(c), description: c, inputTypes:['application/json'], outputTypes:['application/json'], pricingModel:'fixed', price:0.001, providerAgent:agentId, availability:true })
      : ({...c, name: normalizeCapability(c.name), providerAgent: agentId, availability: c.availability !== false }));
    const authToken = input.authToken ?? crypto.randomBytes(24).toString('base64url');
    const wallets = Array.isArray(input.wallets) ? input.wallets.map(normalizeWallet) : [];
    if (input.paymentAddress && !wallets.some(w => w.chain === 'eip155:84532' && w.address.toLowerCase() === String(input.paymentAddress).toLowerCase())) {
      assert(ETH_ADDRESS.test(input.paymentAddress), 'legacy paymentAddress must be an EVM address');
      wallets.push(normalizeWallet({ chain:'eip155:84532', address:input.paymentAddress, label:'Base Sepolia', assets:['A2A'] }));
    }
    const walletPayments = declaredWalletAssets({ id:agentId, wallets }).map(item => ({ network:item.chain, asset:item.asset }));
    const hasA2AWallet = walletPayments.some(p => p.network === 'eip155:84532' && p.asset === 'A2A');
    const defaultPayments = hasA2AWallet
      ? [{network:'eip155:84532',asset:'A2A',primary:true,marketplaceFeeBps:Number(A2A_FEE_BPS)}, ...walletPayments.filter(p => !(p.network==='eip155:84532'&&p.asset==='A2A'))]
      : walletPayments;
    const agent = {
      id: agentId,
      name: input.name,
      description: input.description,
      endpoint: input.endpoint,
      capabilities,
      wallets,
      paymentAddress: input.paymentAddress ?? (wallets.find(w=>w.chain==='eip155:84532')?.address || `walletless:${agentId}`),
      supportedPayments: input.supportedPayments ?? defaultPayments,
      status:'ACTIVE',
      createdAt: now(),
      balance: Number(input.balance ?? 0),
      authTokenHash: crypto.createHash('sha256').update(authToken).digest('hex')
    };
    Object.defineProperty(agent, '_registrationToken', { value: authToken, enumerable: false, writable: false });
    this.agents.set(agent.id, agent);
    this.reputations.set(agent.id, emptyReputation(agent.id));
    this.event('AGENT_REGISTERED',{agentId:agent.id,walletCount:wallets.length,paymentAssets:[...new Set(walletPayments.map(p=>p.asset))]});
    return agent;
  }

  authenticate(agentId, token) {
    const agent=this.agents.get(agentId);
    if(!agent||!token)return false;
    const hash=crypto.createHash('sha256').update(token).digest('hex');
    try{return crypto.timingSafeEqual(Buffer.from(hash),Buffer.from(agent.authTokenHash));}catch{return false;}
  }

  paymentCapabilities(agentId) {
    const agent = typeof agentId === 'string' ? this.agents.get(agentId) : agentId;
    assert(agent, 'agent not found');
    return {
      agentId: agent.id,
      wallets: walletsFor(agent),
      assets: declaredWalletAssets(agent),
      preferredSettlementAsset: 'A2A',
      preferredSettlementNetwork: 'base-sepolia'
    };
  }

  negotiatePaymentRoutes(payerId, payeeId, { preferredAsset='A2A' }={}) {
    const payer = this.agents.get(payerId);
    const payee = this.agents.get(payeeId);
    assert(payer && payee, 'payer and payee agents required');
    const payerAssets = declaredWalletAssets(payer);
    const payeeAssets = declaredWalletAssets(payee);
    const routes = [];

    for (const source of payerAssets) {
      for (const destination of payeeAssets) {
        if (source.chain === destination.chain && source.asset === destination.asset) {
          const base = {
            id: `direct:${source.chain}:${source.asset}:${source.walletId}:${destination.walletId}`,
            kind:'direct',
            chain:source.chain,
            network:source.network,
            asset:source.asset,
            payerWalletId:source.walletId,
            payerAddress:source.address,
            payeeWalletId:destination.walletId,
            payeeAddress:destination.address,
            marketplaceFeeBps:Number(A2A_FEE_BPS)
          };
          routes.push({...base, ...builtInRouteSupport(base)});
        }
      }
    }

    if (!routes.some(route => route.available)) {
      for (const source of payerAssets.slice(0,6)) {
        for (const destination of payeeAssets.slice(0,6)) {
          if (source.chain === destination.chain && source.asset === destination.asset) continue;
          routes.push({
            id:`convert:${source.chain}:${source.asset}:${destination.chain}:${destination.asset}:${source.walletId}:${destination.walletId}`,
            kind:'conversion',
            source:{chain:source.chain,network:source.network,asset:source.asset,walletId:source.walletId,address:source.address},
            destination:{chain:destination.chain,network:destination.network,asset:destination.asset,walletId:destination.walletId,address:destination.address},
            preferredDestination:normalizeAsset(destination.asset)===normalizeAsset(preferredAsset),
            marketplaceFeeBps:Number(A2A_FEE_BPS),
            available:false,
            settlementSupport:'adapter-required',
            adapter:null,
            requires:['quote','swap-or-bridge','source-chain-verification','destination-chain-verification']
          });
          if (routes.length >= 24) break;
        }
        if (routes.length >= 24) break;
      }
    }

    for (const adapter of this.paymentAdapters) {
      if (!adapter || typeof adapter.match !== 'function') continue;
      for (const route of routes) {
        if (route.available) continue;
        const match = adapter.match(route, {payer:this.publicAgent(payer),payee:this.publicAgent(payee)});
        if (match) Object.assign(route,{available:true,settlementSupport:'adapter',adapter:adapter.name||'custom-adapter',...match});
      }
    }

    routes.sort(routeSort);
    return {
      payerId,
      payeeId,
      preferredAsset:normalizeAsset(preferredAsset),
      executable:routes.filter(r=>r.available),
      candidates:routes,
      selected:routes.find(r=>r.available) || null
    };
  }

  publicAgent(agent) {
    if(!agent)return null;
    const { authTokenHash, ...safe }=agent;
    return { ...safe, wallets: walletsFor(agent), paymentCapabilities:declaredWalletAssets(agent) };
  }

  searchAgents({ requiredCapability, maxPrice = Infinity, minimumReputation = 0 }={}) {
    const cap = normalizeCapability(requiredCapability);
    return [...this.agents.values()]
      .map(agent => ({ agent: this.publicAgent(agent), capability: agent.capabilities.find(c => c.name === cap && c.availability && Number(c.price)<=Number(maxPrice)), reputation: this.reputations.get(agent.id) }))
      .filter(x => x.agent.status==='ACTIVE' && x.capability && x.reputation.successRate >= minimumReputation)
      .sort((a,b) => Number(a.capability.price)-Number(b.capability.price) || b.reputation.successRate-a.reputation.successRate)
      .map(x => ({agentId:x.agent.id,name:x.agent.name,endpoint:x.agent.endpoint,capability:x.capability,reputation:x.reputation,wallets:x.agent.wallets,paymentCapabilities:x.agent.paymentCapabilities}));
  }

  createJob(input) {
    assert(input?.creatorId && this.agents.has(input.creatorId), 'valid creatorId required');
    assert(input?.title && input?.description && input?.requiredCapability, 'title, description, requiredCapability required');
    assert(Number(input.reward)>0, 'reward must be positive');
    const parent = input.parentJobId ? this.jobs.get(input.parentJobId) : null;
    if (input.parentJobId) assert(parent, 'parentJobId not found');
    const creator = this.agents.get(input.creatorId);
    const creatorA2AWallet = walletFor(creator,'base-sepolia','A2A');
    const explicitAsset = input.paymentAsset ? normalizeAsset(input.paymentAsset) : null;
    const paymentAsset = explicitAsset ?? (creatorA2AWallet && ETH_ADDRESS.test(creatorA2AWallet.address) ? 'A2A' : null);
    const paymentNetwork = input.paymentNetwork ?? (paymentAsset==='A2A' ? 'base-sepolia' : null);
    const paymentMode = paymentAsset ? 'FIXED' : 'NEGOTIATE_ON_CLAIM';
    const payerWallet = paymentAsset ? walletFor(creator,paymentNetwork,paymentAsset) : null;
    if (paymentAsset === 'A2A') {
      assert(paymentNetwork === 'base-sepolia', 'A2A token is currently deployed on base-sepolia');
      assert(payerWallet && ETH_ADDRESS.test(payerWallet.address), 'creator needs a Base Sepolia-compatible wallet for A2A jobs');
    }
    if (paymentAsset && paymentAsset !== 'USDC_TEST') assert(payerWallet, 'creator needs a compatible wallet for the requested payment asset');
    const paymentAmountUnits = paymentAsset==='A2A'?decimalToUnits(input.reward):null;
    const split = paymentAmountUnits ? feeSplit(paymentAmountUnits) : {feeUnits:null,workerUnits:null,feeBps:Number(A2A_FEE_BPS)};
    const job = {
      id:id('job'), creatorId:input.creatorId, creatorType:input.creatorType ?? 'agent', title:input.title, description:input.description, input:input.input ?? {}, requiredCapability:normalizeCapability(input.requiredCapability), reward:Number(input.reward),
      paymentMode, paymentAsset, paymentNetwork, paymentRoute:null,
      payerAddress:payerWallet?.address||null, payeeAddress:null,
      paymentAmountUnits, workerPaymentUnits:split.workerUnits, marketplaceFeeUnits:split.feeUnits, marketplaceFeeBps:split.feeBps,
      deadline:input.deadline ?? new Date(Date.now()+3600000).toISOString(), verificationMethod:input.verificationMethod ?? 'deterministic', status:'OPEN', workerId:null, result:null,
      parentJobId:input.parentJobId ?? null, rootJobId:parent?.rootJobId ?? parent?.id ?? null, spawnedByJobId:input.spawnedByJobId ?? input.parentJobId ?? null,
      createdAt:now(), updatedAt:now(), claimedAt:null, submittedAt:null, completedAt:null, paidAt:null, settlementTxHash:null, feeTxHash:null
    };
    this.jobs.set(job.id, job);
    this.event('JOB_CREATED',{jobId:job.id,creatorId:job.creatorId,parentJobId:job.parentJobId,paymentMode:job.paymentMode,paymentAsset:job.paymentAsset,marketplaceFeeBps:job.marketplaceFeeBps});
    return job;
  }

  claimJob(jobId, agentId) {
    const job=this.jobs.get(jobId);
    assert(job,'job not found');
    assert(job.status==='OPEN','job not open');
    assert(agentId!==job.creatorId,'creator cannot claim own job');
    const agent=this.agents.get(agentId);
    assert(agent,'agent not found');
    assert(agent.capabilities.some(c=>c.name===job.requiredCapability && c.availability),'agent lacks capability');

    if (job.paymentMode === 'NEGOTIATE_ON_CLAIM') {
      const negotiation = this.negotiatePaymentRoutes(job.creatorId, agentId);
      assert(negotiation.selected, 'no executable payment route; a payment adapter is required for these wallets/assets');
      const route = negotiation.selected;
      job.paymentRoute = route;
      job.paymentAsset = route.asset || route.destination?.asset || null;
      job.paymentNetwork = route.network || route.destination?.network || null;
      job.payerAddress = route.payerAddress || route.source?.address || null;
      job.payeeAddress = route.payeeAddress || route.destination?.address || null;
      if (job.paymentAsset === 'A2A' && job.paymentNetwork === 'base-sepolia') {
        job.paymentAmountUnits = decimalToUnits(job.reward);
        const split=feeSplit(job.paymentAmountUnits);
        job.workerPaymentUnits=split.workerUnits;
        job.marketplaceFeeUnits=split.feeUnits;
        job.marketplaceFeeBps=split.feeBps;
      }
      this.event('PAYMENT_ROUTE_SELECTED',{jobId,route});
    } else if(job.paymentAsset==='A2A') {
      const wallet=walletFor(agent,job.paymentNetwork,job.paymentAsset);
      assert(wallet&&ETH_ADDRESS.test(wallet.address),'worker needs a Base Sepolia-compatible wallet for A2A jobs');
      job.payeeAddress=wallet.address;
      job.paymentRoute={kind:'direct',chain:'eip155:84532',network:'base-sepolia',asset:'A2A',payerAddress:job.payerAddress,payeeAddress:wallet.address,available:true,settlementSupport:'verified',adapter:'base-sepolia-a2a-erc20',marketplaceFeeBps:Number(A2A_FEE_BPS)};
    } else if(job.paymentAsset && job.paymentAsset!=='USDC_TEST') {
      const wallet=walletFor(agent,job.paymentNetwork,job.paymentAsset);
      assert(wallet,'worker needs a compatible wallet for this payment asset');
      const route={kind:'direct',chain:normalizeChain(job.paymentNetwork),network:job.paymentNetwork,asset:job.paymentAsset,payerAddress:job.payerAddress,payeeAddress:wallet.address,marketplaceFeeBps:Number(A2A_FEE_BPS)};
      const support=builtInRouteSupport(route);
      assert(support.available,'payment route exists but requires a settlement adapter');
      job.payeeAddress=wallet.address;
      job.paymentRoute={...route,...support};
    }

    job.workerId=agentId;
    job.status='IN_PROGRESS';
    job.claimedAt=now();
    job.updatedAt=now();
    this.event('JOB_CLAIMED',{jobId,agentId,paymentRoute:job.paymentRoute});
    return job;
  }

  submitJob(jobId, agentId, result) {
    const job=this.jobs.get(jobId);
    assert(job,'job not found');
    assert(job.workerId===agentId,'only worker may submit');
    assert(job.status==='IN_PROGRESS','job not in progress');
    job.result=result;
    job.status='SUBMITTED';
    job.submittedAt=now();
    job.updatedAt=now();
    this.event('JOB_SUBMITTED',{jobId,agentId});
    return job;
  }

  async verifyJob(jobId, creatorId, { accepted=true }={}) {
    const job=this.jobs.get(jobId);
    assert(job,'job not found');
    assert(job.creatorId===creatorId,'only creator may verify');
    assert(job.status==='SUBMITTED','job not submitted');
    job.status='VERIFYING';
    if (!accepted) {
      job.status='FAILED';
      recordFailure(this.reputations.get(job.workerId),{capability:job.requiredCapability});
      this.event('JOB_FAILED',{jobId});
      return job;
    }
    job.completedAt=now();
    if (job.paymentAsset === 'A2A') {
      job.status='AWAITING_PAYMENT';
      job.updatedAt=now();
      this.event('JOB_AWAITING_PAYMENT',{jobId,asset:'A2A',amount:job.reward,payer:job.payerAddress,payee:job.payeeAddress,workerPaymentUnits:job.workerPaymentUnits,marketplaceFeeUnits:job.marketplaceFeeUnits,paymentRoute:job.paymentRoute});
      return job;
    }
    assert(job.paymentAsset === 'USDC_TEST', 'selected payment route requires a settlement adapter before work can be paid');
    job.status='COMPLETED';
    const worker=this.agents.get(job.workerId);
    const creator=this.agents.get(job.creatorId);
    assert(creator.balance >= job.reward, 'creator has insufficient simulated balance');
    const tx=await this.paymentProvider.settle({idempotencyKey:`job:${job.id}:settlement`,jobId:job.id,payer:creator.id,payee:worker.id,amount:job.reward,asset:job.paymentAsset,network:job.paymentNetwork});
    if (!this.transactions.find(t=>t.id===tx.id)) {
      creator.balance-=job.reward;
      worker.balance+=job.reward;
      this.transactions.push(tx);
      recordSuccess(this.reputations.get(worker.id),{capability:job.requiredCapability,amount:job.reward,durationMs:Math.max(1,new Date(job.completedAt)-new Date(job.claimedAt)),customerId:creator.id});
    }
    job.status='PAID';
    job.paidAt=now();
    job.updatedAt=now();
    this.event('JOB_PAID',{jobId,transactionId:tx.id});
    return job;
  }

  settleA2AJob(jobId, creatorId, chainPayment) {
    const job=this.jobs.get(jobId);
    assert(job,'job not found');
    assert(job.creatorId===creatorId,'only creator may settle');
    assert(job.paymentAsset==='A2A','job is not an A2A token job');
    assert(job.status==='AWAITING_PAYMENT','job not awaiting payment');
    const worker=this.agents.get(job.workerId);
    const creator=this.agents.get(job.creatorId);
    assert(worker&&creator,'job agents not found');
    assert(chainPayment?.worker?.txHash && chainPayment?.fee?.txHash, 'verified worker and fee payments required');
    assert(chainPayment.worker.from.toLowerCase()===job.payerAddress.toLowerCase(),'worker payment sender mismatch');
    assert(chainPayment.worker.to.toLowerCase()===job.payeeAddress.toLowerCase(),'worker payment recipient mismatch');
    assert(String(chainPayment.worker.amountUnits)===String(job.workerPaymentUnits),'worker payment amount mismatch');
    assert(String(chainPayment.fee.amountUnits)===String(job.marketplaceFeeUnits),'marketplace fee amount mismatch');
    const refs=[chainPayment.worker.txHash,chainPayment.fee.txHash].map(x=>String(x).toLowerCase());
    assert(refs[0]!==refs[1],'worker and fee transactions must be distinct');
    assert(!this.transactions.some(t=>refs.includes(String(t.reference).toLowerCase())),'transaction already used');
    const tx={id:id('tx'),jobId:job.id,payer:creator.id,payee:worker.id,payerAddress:job.payerAddress,payeeAddress:job.payeeAddress,amount:Number(job.reward)*0.95,amountUnits:job.workerPaymentUnits,feeAmount:Number(job.reward)*0.05,feeUnits:job.marketplaceFeeUnits,asset:'A2A',network:'base-sepolia',status:'SETTLED',provider:'base-sepolia-erc20',reference:chainPayment.worker.txHash,feeReference:chainPayment.fee.txHash,treasuryAddress:chainPayment.fee.to,blockNumber:chainPayment.worker.blockNumber,feeBlockNumber:chainPayment.fee.blockNumber,timestamp:now()};
    this.transactions.push(tx);
    recordSuccess(this.reputations.get(worker.id),{capability:job.requiredCapability,amount:Number(job.reward)*0.95,durationMs:Math.max(1,new Date(job.completedAt)-new Date(job.claimedAt)),customerId:creator.id});
    job.status='PAID';
    job.paidAt=now();
    job.settlementTxHash=chainPayment.worker.txHash;
    job.feeTxHash=chainPayment.fee.txHash;
    job.updatedAt=now();
    this.event('JOB_PAID',{jobId,transactionId:tx.id,txHash:chainPayment.worker.txHash,feeTxHash:chainPayment.fee.txHash,asset:'A2A',marketplaceFeeBps:job.marketplaceFeeBps});
    return {job,transaction:tx};
  }

  cancelJob(jobId, creatorId) { const job=this.jobs.get(jobId); assert(job,'job not found'); assert(job.creatorId===creatorId,'only creator may cancel'); assert(job.status==='OPEN','only open jobs may be cancelled'); job.status='CANCELLED'; job.updatedAt=now(); this.event('JOB_CANCELLED',{jobId}); return job; }
  createService(input) { assert(this.agents.has(input.ownerAgentId),'valid ownerAgentId required'); const service={id:id('svc'),name:input.name,description:input.description,ownerAgentId:input.ownerAgentId,capabilityChain:input.capabilityChain??[],createdAt:now()}; this.services.set(service.id,service); return service; }
  postLoungeMessage({agentId,message,type='discussion'}) { assert(this.loungeEnabled,'lounge disabled'); assert(this.agents.has(agentId),'agent not found'); const item={id:id('msg'),agentId,type,message:String(message).slice(0,1000),at:now()}; this.lounge.push(item); return item; }
  stats() { const jobs=[...this.jobs.values()]; const paid=jobs.filter(j=>j.status==='PAID'); const agentCreated=jobs.filter(j=>j.creatorType==='agent'); const repeats=new Map(); for(const tx of this.transactions){const k=`${tx.payer}->${tx.payee}`; repeats.set(k,(repeats.get(k)||0)+1);} return {activeAgents:[...this.agents.values()].filter(a=>a.status==='ACTIVE').length,activeJobs:jobs.filter(j=>['OPEN','CLAIMED','IN_PROGRESS','SUBMITTED','VERIFYING','AWAITING_PAYMENT'].includes(j.status)).length,jobsCreated:jobs.length,jobsCompleted:paid.length,agentCreatedJobs:agentCreated.length,agentToAgentTransactions:this.transactions.length,transactionVolume:this.transactions.reduce((s,t)=>s+Number(t.amount),0),a2aTransactionVolume:this.transactions.filter(t=>t.asset==='A2A').reduce((s,t)=>s+Number(t.amount),0),a2aTransactions:this.transactions.filter(t=>t.asset==='A2A').length,a2aMarketplaceFees:this.transactions.filter(t=>t.asset==='A2A').reduce((s,t)=>s+Number(t.feeAmount||0),0),marketplaceFeeBps:500,services:this.services.size,successRate:jobs.length?paid.length/jobs.length:0,repeatTransactions:[...repeats.values()].filter(n=>n>1).reduce((s,n)=>s+n-1,0)}; }
  activity() { return this.events.slice(-100); }
  graph() { return { nodes:[...this.agents.values()].map(a=>({id:a.id,type:'agent',label:a.name})).concat([...this.jobs.values()].map(j=>({id:j.id,type:'job',label:j.title})),this.transactions.map(t=>({id:t.id,type:'transaction',label:`${t.amount} ${t.asset}`}))), edges:[...this.jobs.values()].flatMap(j=>[{from:j.creatorId,to:j.id,type:'created'},...(j.workerId?[{from:j.id,to:j.workerId,type:'worked_by'}]:[]),...(j.parentJobId?[{from:j.parentJobId,to:j.id,type:'spawned'}]:[])]).concat(this.transactions.flatMap(t=>[{from:t.payer,to:t.id,type:'paid'},{from:t.id,to:t.payee,type:'received'}])) }; }
  getAgentCard(agentId, baseUrl) { const agent=this.agents.get(agentId); assert(agent,'agent not found'); return agentCard(agent,baseUrl); }
}
