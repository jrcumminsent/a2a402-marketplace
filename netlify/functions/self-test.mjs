import { Economy } from '../../apps/api/src/economy.js';
import { submitBid, selectBid } from '../../apps/api/src/contracts.js';
import { deliverArtifact } from '../../apps/api/src/artifacts.js';
import { evaluateDelivery } from '../../apps/api/src/evaluations.js';
import { paymentIntentForJob } from '../../apps/api/src/payment-execution.js';

export const config={path:'/system/self-test'};
const PAYER='0x1111111111111111111111111111111111111111';
const WORKER='0x2222222222222222222222222222222222222222';
const TREASURY='0xD08eA67ef730fc336a9B6fB89A4B66dF67Fbb69c';
const USDC='0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const A2A='0xf9e891696c022f9fe4a143a92255371253c5567a';
const json=(status,value)=>new Response(JSON.stringify(value,null,2),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
export default async (req)=>{
 if(req.method!=='GET')return json(405,{ok:false,error:'GET required'});
 try{
  const economy=new Economy(); economy.bids=new Map(); economy.contracts=new Map(); economy.artifacts=new Map(); economy.deliveries=new Map(); economy.evaluations=new Map();
  const creator=economy.registerAgent({name:'A2A402 Self-Test Creator',description:'Ephemeral self-test creator.',endpoint:'https://a2a402.market/a2a',capabilities:['routing'],wallets:[{chain:'eip155:8453',address:PAYER,assets:['USDC','A2A402']}]});
  const worker=economy.registerAgent({name:'A2A402 Self-Test Worker',description:'Ephemeral self-test worker.',endpoint:'https://a2a402.market/a2a',capabilities:['research'],wallets:[{chain:'eip155:8453',address:WORKER,assets:['USDC','A2A402']}]});
  const job=economy.createJob({creatorId:creator.id,creatorType:'internal-self-test',title:'Self-test research request',description:'Validate lifecycle without persistence or real money.',requiredCapability:'research',reward:0.10,paymentAsset:'USDC',paymentNetwork:'base',input:{source:'system-self-test'}});
  const matches=economy.searchAgents({requiredCapability:'research',maxPrice:0.10});
  const bid=submitBid(economy,job.id,worker.id,{amount:0.10,idempotencyKey:'self-test-bid'});
  const selected=selectBid(economy,bid.id,creator.id,{idempotencyKey:'self-test-select'});
  const delivered=deliverArtifact(economy,selected.contract.id,worker.id,{name:'self-test.json',mimeType:'application/json',summary:'Ephemeral self-test delivery',content:{ok:true,source:'a2a402-self-test'},idempotencyKey:'self-test-delivery'});
  const evaluated=await evaluateDelivery(economy,delivered.delivery.id,creator.id,{accepted:true,qualityScore:100,reason:'Deterministic self-test acceptance.',idempotencyKey:'self-test-evaluate'});
  const intent=paymentIntentForJob(evaluated.job,{baseUrl:'https://a2a402.market',tokenAddress:A2A,usdcAddress:USDC,treasuryAddress:TREASURY});
  const checks={providerDiscovered:matches.some(x=>x.agentId===worker.id),bidCreated:bid.status==='SELECTED',contractCreated:Boolean(selected.contract?.id),artifactDelivered:Boolean(delivered.artifact?.sha256),deliveryAccepted:evaluated.delivery.status==='ACCEPTED',awaitingPayment:evaluated.job.status==='AWAITING_PAYMENT',usdcSelected:evaluated.job.paymentAsset==='USDC',feeSplit:Number(evaluated.job.marketplaceFeeBps)===500,paymentIntentReady:intent.asset==='USDC'&&intent.transfers?.length===2};
  const ok=Object.values(checks).every(Boolean);
  return json(ok?200:500,{ok,mode:'ephemeral-in-memory',realMoneyMoved:false,persistentMarketplaceMutated:false,checks,lifecycle:['discover','job','bid','contract','artifact','delivery','evaluation','payment-intent'],settlementNotBroadcast:true});
 }catch(error){return json(500,{ok:false,mode:'ephemeral-in-memory',realMoneyMoved:false,persistentMarketplaceMutated:false,error:error.message});}
};