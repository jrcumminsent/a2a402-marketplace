import fs from 'node:fs';
import path from 'node:path';
import { JsonRpcProvider, Wallet, Contract, formatEther, formatUnits, parseEther, parseUnits } from 'ethers';

const BASE = (process.env.A2A402_BASE_URL || 'https://a2a402.market').replace(/\/$/, '');
const RPC = process.env.A2A402_BASE_MAINNET_RPC_URL || 'https://mainnet.base.org';
const TOKEN = '0xF2bb6DC14E9097EC08F9Eaa9C6B7d39662195F01';
const TREASURY = '0xD08eA67ef730fc336a9B6fB89A4B66dF67Fbb69c';
const STATE = path.resolve('.a2a402-autonomous-wallet.json');
const TOKEN_ABI = ['function balanceOf(address) view returns (uint256)','function transfer(address to,uint256 amount) returns (bool)'];
const FIRST_REWARD = '1.0';
const SECOND_REWARD = '0.5';
const MIN_A2A = parseUnits('1.6', 18);
const MIN_ETH = parseEther('0.0005');
const WORKER_GAS_TOPUP = parseEther('0.00015');

function loadOrCreateFundingWallet() {
  if (fs.existsSync(STATE)) { const stored = JSON.parse(fs.readFileSync(STATE, 'utf8')); if (!stored.privateKey) throw new Error(`${STATE} is invalid`); return new Wallet(stored.privateKey); }
  const wallet = Wallet.createRandom(); fs.writeFileSync(STATE, JSON.stringify({address:wallet.address,privateKey:wallet.privateKey,createdAt:new Date().toISOString()}, null, 2)); return wallet;
}
async function api(pathname, init = {}) {
  const response = await fetch(`${BASE}${pathname}`, {...init,headers:{accept:'application/json',...(init.body?{'content-type':'application/json'}:{}),...(init.headers||{})}});
  const text = await response.text(); let body = {}; try { body = text ? JSON.parse(text) : {}; } catch { body = {raw:text}; }
  if (!response.ok) throw new Error(body.error || body.message || `${response.status} ${response.statusText}`); return body;
}
const auth = (id, token) => ({authorization:`Bearer ${token}`,'x-agent-id':id});
async function register(name, capability, wallet) { return api('/agents/register',{method:'POST',body:JSON.stringify({name,description:`Autonomous E2E ${capability} agent`,endpoint:`${BASE}/a2a`,capabilities:[capability],wallets:[{chain:'eip155:8453',address:wallet.address,walletType:'agent-controlled',assets:['A2A']}]})}); }

async function doJob({creator, worker, reward, capability, title, parentJobId=null}) {
  const discovered=await api(`/agents/search?capability=${encodeURIComponent(capability)}`);
  if(!Array.isArray(discovered)||!discovered.some(x=>x.agentId===worker.agent.id))throw new Error(`worker ${worker.agent.id} was not discoverable for ${capability}`);
  const job = await api('/jobs',{method:'POST',headers:auth(creator.agent.id,creator.authToken),body:JSON.stringify({title,description:'Autonomous end-to-end A2A402 proof job.',requiredCapability:capability,reward:Number(reward),paymentAsset:'A2A',paymentNetwork:'base',verificationMethod:'deterministic',parentJobId:parentJobId||undefined,spawnedByJobId:parentJobId||undefined,input:{purpose:'a2a402-economy',proof:'full-lifecycle-e2e'}})});
  const bidKey=`e2e-bid-${job.id}-${worker.agent.id}`;
  const bid=await api(`/jobs/${job.id}/bids`,{method:'POST',headers:auth(worker.agent.id,worker.authToken),body:JSON.stringify({amount:Number(reward),message:'Autonomous lifecycle bid',idempotencyKey:bidKey})});
  const selected=await api(`/bids/${bid.id}/select`,{method:'POST',headers:auth(creator.agent.id,creator.authToken),body:JSON.stringify({idempotencyKey:`e2e-select-${bid.id}`})});
  const contract=selected.contract;
  if(!contract?.id)throw new Error(`job ${job.id} did not produce a contract`);
  const delivered=await api(`/contracts/${contract.id}/deliveries`,{method:'POST',headers:auth(worker.agent.id,worker.authToken),body:JSON.stringify({name:'a2a402-e2e.json',mimeType:'application/json',summary:'Autonomous full lifecycle delivery',content:{ok:true,autonomous:true,proof:'a2a402-full-lifecycle-v2',jobId:job.id,contractId:contract.id},idempotencyKey:`e2e-delivery-${contract.id}`})});
  const evaluated=await api(`/deliveries/${delivered.delivery.id}/evaluate`,{method:'POST',headers:auth(creator.agent.id,creator.authToken),body:JSON.stringify({accepted:true,qualityScore:100,reason:'Deterministic E2E proof accepted.',evidence:{artifactSha256:delivered.artifact.sha256},idempotencyKey:`e2e-evaluation-${delivered.delivery.id}`})});
  if (evaluated.job?.status !== 'AWAITING_PAYMENT') throw new Error(`job ${job.id} did not reach AWAITING_PAYMENT`);
  return {job:evaluated.job,bid,contract,artifact:delivered.artifact,delivery:delivered.delivery,evaluation:evaluated.evaluation};
}

async function settle(job, creator, signer, token) {
  const workerAmount = BigInt(job.workerPaymentUnits), feeAmount = BigInt(job.marketplaceFeeUnits);
  const workerTx = await token.connect(signer).transfer(job.payeeAddress, workerAmount); await workerTx.wait();
  const feeTx = await token.connect(signer).transfer(TREASURY, feeAmount); await feeTx.wait();
  const settled = await api(`/jobs/${job.id}/settle`,{method:'POST',headers:auth(creator.agent.id,creator.authToken),body:JSON.stringify({workerTxHash:workerTx.hash,feeTxHash:feeTx.hash})});
  if ((settled.job?.status || settled.status) !== 'PAID') throw new Error(`job ${job.id} did not settle to PAID`); return {workerTxHash:workerTx.hash,feeTxHash:feeTx.hash};
}

async function main() {
  const provider = new JsonRpcProvider(RPC, 8453), fundingWallet = loadOrCreateFundingWallet().connect(provider), token = new Contract(TOKEN, TOKEN_ABI, provider);
  const [ethBalance, a2aBalance] = await Promise.all([provider.getBalance(fundingWallet.address), token.balanceOf(fundingWallet.address)]);
  if (ethBalance < MIN_ETH || a2aBalance < MIN_A2A) { console.log(JSON.stringify({ok:false,stage:'fund-once',message:'One-time funding is required before the autonomous production proof can run.',address:fundingWallet.address,network:'Base Mainnet',requiredMinimum:{ETH:formatEther(MIN_ETH),A2A:formatUnits(MIN_A2A,18)},current:{ETH:formatEther(ethBalance),A2A:formatUnits(a2aBalance,18)},tokenContract:TOKEN,privateKeyLocation:STATE,note:'Keep this file local. Never paste or share the private key. After funding this address once, rerun the same command.'}, null, 2)); return; }
  const workerWallet = Wallet.createRandom().connect(provider), secondWorkerWallet = Wallet.createRandom().connect(provider);
  const payer = await register(`A2A402 E2E Payer ${Date.now()}`, 'analysis', fundingWallet), worker = await register(`A2A402 E2E Worker ${Date.now()}`, 'analysis', workerWallet), secondWorker = await register(`A2A402 E2E Rehire ${Date.now()}`, 'research', secondWorkerWallet);
  const first=await doJob({creator:payer,worker,reward:FIRST_REWARD,capability:'analysis',title:'Autonomous economy proof: earn A2A'});const firstSettlement=await settle(first.job,payer,fundingWallet,token);
  const gasTopup=await fundingWallet.sendTransaction({to:workerWallet.address,value:WORKER_GAS_TOPUP});await gasTopup.wait();const workerBalanceAfterEarn=await token.balanceOf(workerWallet.address);
  const second=await doJob({creator:worker,worker:secondWorker,reward:SECOND_REWARD,capability:'research',title:'Autonomous economy proof: re-spend earned A2A',parentJobId:first.job.id});const secondSettlement=await settle(second.job,worker,workerWallet,token);
  const [workerFinal,secondWorkerFinal]=await Promise.all([token.balanceOf(workerWallet.address),token.balanceOf(secondWorkerWallet.address)]);
  console.log(JSON.stringify({ok:true,stage:'complete',proof:'discover/register/create/bid/select/contract/artifact/deliver/evaluate/settle/reputation/downstream',payerAgentId:payer.agent.id,workerAgentId:worker.agent.id,rehireAgentId:secondWorker.agent.id,firstJob:{id:first.job.id,contractId:first.contract.id,deliveryId:first.delivery.id,evaluationId:first.evaluation.id,status:'PAID',rewardA2A:FIRST_REWARD,...firstSettlement},earned:{workerBalanceA2A:formatUnits(workerBalanceAfterEarn,18)},respentJob:{id:second.job.id,parentJobId:first.job.id,contractId:second.contract.id,deliveryId:second.delivery.id,evaluationId:second.evaluation.id,status:'PAID',rewardA2A:SECOND_REWARD,...secondSettlement},finalBalances:{workerA2A:formatUnits(workerFinal,18),rehireWorkerA2A:formatUnits(secondWorkerFinal,18)},fundingWallet:fundingWallet.address,message:'A2A402 full autonomous economic lifecycle completed on Base Mainnet.'},null,2));
}
main().catch(error=>{console.error(JSON.stringify({ok:false,stage:'error',error:error.message},null,2));process.exitCode=1;});
