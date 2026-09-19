import crypto from 'node:crypto';
import { usdcNetworkConfig } from './token-config.js';

const EVM_ADDRESS=/^0x[a-fA-F0-9]{40}$/;
const normalizeNetwork=value=>String(value||'').trim().toLowerCase();
const chainConfigForJob=(job,config)=>{
  if(job.paymentAsset==='A2A402'){
    if(!['base','eip155:8453'].includes(normalizeNetwork(job.paymentNetwork)))throw new Error('A2A402 settlement remains on Base');
    return{network:'base',chain:'eip155:8453',chainId:8453,tokenContract:config.tokenAddress};
  }
  if(job.paymentAsset==='USDC'){
    const chain=usdcNetworkConfig(job.paymentNetwork);
    if(!chain)throw new Error('job is not on a supported USDC network');
    const configured=config.usdcAddresses?.[chain.network]||chain.contractAddress;
    return{network:chain.network,chain:chain.caipChainId,chainId:chain.chainId,tokenContract:configured};
  }
  throw new Error('unsupported settlement asset');
};
export function normalizePaymentExecutor(input={}){
  if(!input||typeof input!=='object')throw new Error('paymentExecutor must be an object');
  const mode=String(input.mode||'pull').toLowerCase();if(mode!=='pull')throw new Error('paymentExecutor.mode must be pull');
  return{mode:'pull',protocol:'a2a402-payment-intent-v1',autoExecute:input.autoExecute!==false,chain:input.chain?String(input.chain):null,asset:String(input.asset||'USDC').toUpperCase(),signerType:input.signerType?String(input.signerType):'agent-controlled',maxPerJobUnits:input.maxPerJobUnits?String(input.maxPerJobUnits):null};
}
export function paymentIntentForJob(job,config){
  if(!job)throw new Error('job not found');if(job.status!=='AWAITING_PAYMENT')throw new Error('job not awaiting payment');
  if(!EVM_ADDRESS.test(job.payerAddress||'')||!EVM_ADDRESS.test(job.payeeAddress||''))throw new Error('job payment wallets are invalid');
  const chain=chainConfigForJob(job,config),treasuryAddress=config.treasuryAddress;
  if(!EVM_ADDRESS.test(chain.tokenContract||'')||!EVM_ADDRESS.test(treasuryAddress||''))throw new Error('payment configuration is invalid');
  const payload=[job.id,job.paymentAsset,chain.chain,job.payerAddress.toLowerCase(),job.payeeAddress.toLowerCase(),String(job.workerPaymentUnits),treasuryAddress.toLowerCase(),String(job.marketplaceFeeUnits),chain.tokenContract.toLowerCase()].join('|');
  const intentId='pay_'+crypto.createHash('sha256').update(payload).digest('hex').slice(0,32);
  return{protocol:'a2a402-payment-intent-v1',intentId,jobId:job.id,status:job.status,chain:chain.chain,network:chain.network,chainId:chain.chainId,asset:job.paymentAsset,tokenContract:chain.tokenContract,payerAddress:job.payerAddress,totalAmountUnits:String(job.paymentAmountUnits),transfers:[{purpose:'worker',to:job.payeeAddress,amountUnits:String(job.workerPaymentUnits)},{purpose:'marketplace-fee',to:treasuryAddress,amountUnits:String(job.marketplaceFeeUnits)}],safety:{exactChain:true,exactContract:true,exactRecipients:true,exactAmounts:true,twoDistinctTransactionsRequired:true,privateKeyNeverSharedWithMarketplace:true,signerMustBeControlledByPayerAgent:true},verifyBeforeSigning:config.baseUrl+'/jobs/'+job.id,submitSettlement:{method:'POST',url:config.baseUrl+'/jobs/'+job.id+'/settle',body:{workerTxHash:'<0x...>',feeTxHash:'<0x...>'}}};
}
export function pendingPaymentIntents(economy,agentId,config){return[...economy.jobs.values()].filter(job=>job.creatorId===agentId&&job.status==='AWAITING_PAYMENT'&&['A2A402','USDC'].includes(job.paymentAsset)).map(job=>paymentIntentForJob(job,config))}
export function transactionHashAlreadyUsed(economy,txHash){const needle=String(txHash||'').toLowerCase();if(!needle)return false;return economy.transactions.some(tx=>[tx.reference,tx.feeReference].some(ref=>String(ref||'').toLowerCase()===needle))}
