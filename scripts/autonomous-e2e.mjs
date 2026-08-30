import fs from 'node:fs';
import path from 'node:path';
import { JsonRpcProvider, Wallet, Contract, formatEther, formatUnits, parseEther, parseUnits } from 'ethers';

const BASE = (process.env.A2A402_BASE_URL || 'https://a2a402.market').replace(/\/$/, '');
const RPC = process.env.A2A402_BASE_MAINNET_RPC_URL || 'https://mainnet.base.org';
const TOKEN = '0xF2bb6DC14E9097EC08F9Eaa9C6B7d39662195F01';
const TREASURY = '0x5fDc419a849cA18D7960ABcb76827e717c2c67Db';
const STATE = path.resolve('.a2a402-autonomous-wallet.json');
const TOKEN_ABI = ['function balanceOf(address) view returns (uint256)','function transfer(address to,uint256 amount) returns (bool)'];
const FIRST_REWARD = '1.0';
const SECOND_REWARD = '0.5';
const MIN_A2A = parseUnits('1.6', 18);
const MIN_ETH = parseEther('0.0005');
const WORKER_GAS_TOPUP = parseEther('0.00015');

function loadOrCreateFundingWallet() {
  if (fs.existsSync(STATE)) {
    const stored = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    if (!stored.privateKey) throw new Error(`${STATE} is invalid`);
    return new Wallet(stored.privateKey);
  }
  const wallet = Wallet.createRandom();
  fs.writeFileSync(STATE, JSON.stringify({address:wallet.address,privateKey:wallet.privateKey,createdAt:new Date().toISOString()}, null, 2));
  return wallet;
}

async function api(pathname, init = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: {accept:'application/json', ...(init.body?{'content-type':'application/json'}:{}), ...(init.headers||{})}
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {raw:text}; }
  if (!response.ok) throw new Error(body.error || body.message || `${response.status} ${response.statusText}`);
  return body;
}

const auth = (id, token) => ({authorization:`Bearer ${token}`,'x-agent-id':id});

async function register(name, capability, wallet) {
  return api('/agents/register', {method:'POST', body:JSON.stringify({
    name,
    description:`Autonomous E2E ${capability} agent`,
    endpoint:`${BASE}/a2a`,
    capabilities:[capability],
    wallets:[{chain:'eip155:8453',address:wallet.address,walletType:'agent-controlled',assets:['A2A']}]
  })});
}

async function doJob({creator, worker, reward, capability, title}) {
  const job = await api('/jobs', {method:'POST', headers:auth(creator.agent.id, creator.authToken), body:JSON.stringify({
    title,
    description:'Autonomous end-to-end A2A402 proof job.',
    requiredCapability:capability,
    reward:Number(reward),
    paymentAsset:'A2A',
    paymentNetwork:'base',
    verificationMethod:'deterministic'
  })});
  const claimed = await api(`/jobs/${job.id}/claim`, {method:'POST', headers:auth(worker.agent.id, worker.authToken)});
  await api(`/jobs/${job.id}/submit`, {method:'POST', headers:auth(worker.agent.id, worker.authToken), body:JSON.stringify({result:{ok:true,autonomous:true,proof:'a2a402-e2e-v1',jobId:job.id}})});
  const verified = await api(`/jobs/${job.id}/verify`, {method:'POST', headers:auth(creator.agent.id, creator.authToken), body:JSON.stringify({accepted:true})});
  if (verified.status !== 'AWAITING_PAYMENT') throw new Error(`job ${job.id} did not reach AWAITING_PAYMENT`);
  return claimed;
}

async function settle(job, creator, signer, token) {
  const workerAmount = BigInt(job.workerPaymentUnits);
  const feeAmount = BigInt(job.marketplaceFeeUnits);
  const workerTx = await token.connect(signer).transfer(job.payeeAddress, workerAmount);
  await workerTx.wait();
  const feeTx = await token.connect(signer).transfer(TREASURY, feeAmount);
  await feeTx.wait();
  const settled = await api(`/jobs/${job.id}/settle`, {method:'POST', headers:auth(creator.agent.id, creator.authToken), body:JSON.stringify({workerTxHash:workerTx.hash,feeTxHash:feeTx.hash})});
  if ((settled.job?.status || settled.status) !== 'PAID') throw new Error(`job ${job.id} did not settle to PAID`);
  return {workerTxHash:workerTx.hash,feeTxHash:feeTx.hash};
}

async function main() {
  const provider = new JsonRpcProvider(RPC, 8453);
  const fundingWallet = loadOrCreateFundingWallet().connect(provider);
  const token = new Contract(TOKEN, TOKEN_ABI, provider);
  const [ethBalance, a2aBalance] = await Promise.all([provider.getBalance(fundingWallet.address), token.balanceOf(fundingWallet.address)]);

  if (ethBalance < MIN_ETH || a2aBalance < MIN_A2A) {
    console.log(JSON.stringify({
      ok:false,
      stage:'fund-once',
      message:'One-time funding is required before the autonomous production proof can run.',
      address:fundingWallet.address,
      network:'Base Mainnet',
      requiredMinimum:{ETH:formatEther(MIN_ETH),A2A:formatUnits(MIN_A2A,18)},
      current:{ETH:formatEther(ethBalance),A2A:formatUnits(a2aBalance,18)},
      tokenContract:TOKEN,
      privateKeyLocation:STATE,
      note:'Keep this file local. Never paste or share the private key. After funding this address once, rerun the same command.'
    }, null, 2));
    return;
  }

  const workerWallet = Wallet.createRandom().connect(provider);
  const secondWorkerWallet = Wallet.createRandom().connect(provider);

  const payer = await register(`A2A402 E2E Payer ${Date.now()}`, 'analysis', fundingWallet);
  const worker = await register(`A2A402 E2E Worker ${Date.now()}`, 'analysis', workerWallet);
  const secondWorker = await register(`A2A402 E2E Rehire ${Date.now()}`, 'research', secondWorkerWallet);

  const firstJob = await doJob({creator:payer, worker, reward:FIRST_REWARD, capability:'analysis', title:'Autonomous economy proof: earn A2A'});
  const firstSettlement = await settle(firstJob, payer, fundingWallet, token);

  const gasTopup = await fundingWallet.sendTransaction({to:workerWallet.address,value:WORKER_GAS_TOPUP});
  await gasTopup.wait();

  const workerBalanceAfterEarn = await token.balanceOf(workerWallet.address);
  const secondJob = await doJob({creator:worker, worker:secondWorker, reward:SECOND_REWARD, capability:'research', title:'Autonomous economy proof: re-spend earned A2A'});
  const secondSettlement = await settle(secondJob, worker, workerWallet, token);

  const [workerFinal, secondWorkerFinal] = await Promise.all([token.balanceOf(workerWallet.address),token.balanceOf(secondWorkerWallet.address)]);
  console.log(JSON.stringify({
    ok:true,
    stage:'complete',
    proof:'discover/register/create/claim/perform/submit/verify/pay/re-spend/pay',
    payerAgentId:payer.agent.id,
    workerAgentId:worker.agent.id,
    rehireAgentId:secondWorker.agent.id,
    firstJob:{id:firstJob.id,status:'PAID',rewardA2A:FIRST_REWARD,...firstSettlement},
    earned:{workerBalanceA2A:formatUnits(workerBalanceAfterEarn,18)},
    respentJob:{id:secondJob.id,status:'PAID',rewardA2A:SECOND_REWARD,...secondSettlement},
    finalBalances:{workerA2A:formatUnits(workerFinal,18),rehireWorkerA2A:formatUnits(secondWorkerFinal,18)},
    fundingWallet:fundingWallet.address,
    message:'A2A402 autonomous circular-economy proof completed on Base Mainnet.'
  }, null, 2));
}

main().catch(error=>{console.error(JSON.stringify({ok:false,stage:'error',error:error.message},null,2));process.exitCode=1;});
