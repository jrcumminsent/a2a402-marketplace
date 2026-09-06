import { withEconomy, persistenceMode } from '../../apps/api/src/persistence.js';
import { paymentIntentForJob } from '../../apps/api/src/payment-execution.js';

const baseUrl=process.env.APP_BASE_URL||process.env.URL||'https://a2a402.market';
const tokenAddress=(process.env.A2A402_TOKEN_ADDRESS||process.env.A2A402_EXPECTED_TOKEN_ADDRESS||'0xf9e891696c022f9fe4a143a92255371253c5567a').trim();
const treasuryAddress=(process.env.A2A402_TREASURY_ADDRESS||process.env.A2A402_EXPECTED_TREASURY_ADDRESS||'0xD08eA67ef730fc336a9B6fB89A4B66dF67Fbb69c').trim();
const genesisCreator=(process.env.A2A402_GENESIS_CREATOR_ID||'agent_10').trim();
const genesisPayer=(process.env.A2A402_GENESIS_PAYER_ADDRESS||'').trim();
const rpcUrl=process.env.A2A402_BASE_MAINNET_RPC_URL||'https://mainnet.base.org';
const transferTopic='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ADDRESS=/^0x[a-fA-F0-9]{40}$/;
const HASH=/^0x[a-fA-F0-9]{64}$/;
const headers={'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*','access-control-allow-headers':'content-type','access-control-allow-methods':'GET,POST,OPTIONS'};
const reply=(statusCode,value)=>({statusCode,headers,body:JSON.stringify(value)});
const parseBody=event=>event.body?JSON.parse(event.body):{};
const pathFor=event=>{const raw=event.rawUrl?new URL(event.rawUrl).pathname:event.path||'/';return raw.replace(/^\/\.netlify\/functions\/genesis-settlement/,'')||'/'};
const topicAddress=topic=>`0x${String(topic||'').slice(-40)}`.toLowerCase();

async function rpc(method,params=[]){const r=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:Date.now(),method,params})});if(!r.ok)throw new Error(`Base RPC HTTP ${r.status}`);const body=await r.json();if(body.error)throw new Error(body.error.message||'Base RPC error');return body.result}
async function verifyTransfer({txHash,from,to,amountUnits}){if(!HASH.test(txHash||''))throw new Error('valid Base Mainnet transaction hash required');if(!ADDRESS.test(from||'')||!ADDRESS.test(to||''))throw new Error('valid payer and recipient required');const receipt=await rpc('eth_getTransactionReceipt',[txHash]);if(!receipt)throw new Error('transaction is not mined yet');if(receipt.status!=='0x1')throw new Error('transaction failed on Base Mainnet');const match=(receipt.logs||[]).find(log=>{if(String(log.address||'').toLowerCase()!==tokenAddress.toLowerCase())return false;if(String(log.topics?.[0]||'').toLowerCase()!==transferTopic)return false;if(topicAddress(log.topics?.[1])!==from.toLowerCase()||topicAddress(log.topics?.[2])!==to.toLowerCase())return false;try{return BigInt(log.data||'0x0')===BigInt(amountUnits)}catch{return false}});if(!match)throw new Error('transaction does not contain the required A2A402 transfer');return{txHash,from,to,amountUnits:String(amountUnits),network:'base',chainId:8453,asset:'A2A402',tokenAddress}}
function isGenesis(job){return Boolean(job&&job.creatorId===genesisCreator&&job.input?.program==='genesis-work-pool'&&job.input?.systemGenerated===true&&job.input?.classification==='promotional'&&job.input?.countsTowardOrganic===false&&job.input?.countsTowardFounder===false)}
function assertPayer(job){if(!ADDRESS.test(genesisPayer))throw new Error('Genesis payer is not configured');if(String(job.payerAddress||'').toLowerCase()!==genesisPayer.toLowerCase())throw new Error('job payer does not match configured Genesis payer')}

export async function handler(event){try{if(event.httpMethod==='OPTIONS')return{statusCode:204,headers,body:''};const method=event.httpMethod,p=pathFor(event);return await withEconomy(async economy=>{
  if(method==='GET'&&p==='/payments/execution/genesis/intents'){
    const intents=[...economy.jobs.values()].filter(job=>isGenesis(job)&&job.status==='AWAITING_PAYMENT'&&job.paymentAsset==='A2A402'&&job.paymentNetwork==='base').map(job=>{assertPayer(job);return paymentIntentForJob(job,{baseUrl,tokenAddress,treasuryAddress})});
    return reply(200,{protocol:'a2a402-genesis-payment-execution-v1',environment:'production',realMoney:true,persistence:persistenceMode(),custody:false,signer:'metamask-agent-wallet',creatorId:genesisCreator,payerAddress:genesisPayer,asset:'A2A402',tokenAddress,intents});
  }
  const match=p.match(/^\/payments\/execution\/genesis\/jobs\/([^/]+)\/settle$/);
  if(method==='POST'&&match){const job=economy.jobs.get(match[1]);if(!job)return reply(404,{error:{code:'NOT_FOUND',message:'job not found'}});if(!isGenesis(job))return reply(403,{error:{code:'NOT_GENESIS',message:'job is not eligible for Genesis autonomous settlement'}});if(job.status!=='AWAITING_PAYMENT')return reply(409,{error:{code:'INVALID_STATE',message:'job is not awaiting payment'}});if(job.paymentAsset!=='A2A402'||job.paymentNetwork!=='base')return reply(409,{error:{code:'INVALID_ASSET',message:'job is not configured for Base Mainnet A2A402 settlement'}});assertPayer(job);if(!ADDRESS.test(job.payeeAddress||''))throw new Error('worker payout wallet is not configured');const data=parseBody(event);const worker=await verifyTransfer({txHash:data.workerTxHash,from:genesisPayer,to:job.payeeAddress,amountUnits:job.workerPaymentUnits});const fee=await verifyTransfer({txHash:data.feeTxHash,from:genesisPayer,to:treasuryAddress,amountUnits:job.marketplaceFeeUnits});const settled=economy.settleA2AJob(job.id,genesisCreator,{worker,fee});return reply(200,{protocol:'a2a402-genesis-payment-execution-v1',settled:true,asset:'A2A402',tokenAddress,job:settled});}
  return reply(404,{error:{code:'NOT_FOUND',message:'not found'}});
},{baseUrl,loungeEnabled:process.env.A2A402_ENABLE_LOUNGE!=='false'});}catch(error){return reply(400,{error:{code:'GENESIS_SETTLEMENT_ERROR',message:error.message,retryable:false}})}}
