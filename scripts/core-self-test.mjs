import { Economy } from '../apps/api/src/economy.js';
import { submitBid, selectBid } from '../apps/api/src/contracts.js';
import { deliverArtifact } from '../apps/api/src/artifacts.js';
import { evaluateDelivery } from '../apps/api/src/evaluations.js';
import { paymentIntentForJob } from '../apps/api/src/payment-execution.js';

const PAYER='0x1111111111111111111111111111111111111111';
const WORKER='0x2222222222222222222222222222222222222222';
const TREASURY='0xD08eA67ef730fc336a9B6fB89A4B66dF67Fbb69c';
const USDC='0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const A2A='0xf9e891696c022f9fe4a143a92255371253c5567a';

export async function runCoreSelfTest(){
  const economy=new Economy();
  economy.bids=new Map(); economy.contracts=new Map(); economy.artifacts=new Map(); economy.deliveries=new Map(); economy.evaluations=new Map();

  const creator=economy.registerAgent({name:'A2A402 Build Self-Test Creator',description:'Ephemeral build validation creator.',endpoint:'https://a2a402.market/a2a',capabilities:['routing'],wallets:[{chain:'eip155:8453',address:PAYER,assets:['USDC','A2A402']}]});
  const worker=economy.registerAgent({name:'A2A402 Build Self-Test Worker',description:'Ephemeral build validation worker.',endpoint:'https://a2a402.market/a2a',capabilities:['research'],wallets:[{chain:'eip155:8453',address:WORKER,assets:['USDC','A2A402']}]});

  const job=economy.createJob({creatorId:creator.id,creatorType:'internal-self-test',title:'Build self-test research request',description:'Validate the complete pre-signing lifecycle.',requiredCapability:'research',reward:0.10,paymentAsset:'USDC',paymentNetwork:'base',input:{source:'build-self-test'}});
  const matches=economy.searchAgents({requiredCapability:'research',maxPrice:0.10});
  const bid=submitBid(economy,job.id,worker.id,{amount:0.10,idempotencyKey:'build-self-test-bid'});
  const selected=selectBid(economy,bid.id,creator.id,{idempotencyKey:'build-self-test-select'});
  const delivered=deliverArtifact(economy,selected.contract.id,worker.id,{name:'self-test.json',mimeType:'application/json',summary:'Build self-test delivery',content:{ok:true},idempotencyKey:'build-self-test-delivery'});
  const evaluated=await evaluateDelivery(economy,delivered.delivery.id,creator.id,{accepted:true,qualityScore:100,reason:'Deterministic build self-test.',idempotencyKey:'build-self-test-evaluate'});
  const intent=paymentIntentForJob(evaluated.job,{baseUrl:'https://a2a402.market',tokenAddress:A2A,usdcAddress:USDC,treasuryAddress:TREASURY});

  const checks={
    providerDiscovered:matches.some(x=>x.agentId===worker.id),
    bidSelected:bid.status==='SELECTED',
    contractCreated:Boolean(selected.contract?.id),
    artifactDelivered:Boolean(delivered.artifact?.sha256),
    deliveryAccepted:evaluated.delivery.status==='ACCEPTED',
    awaitingPayment:evaluated.job.status==='AWAITING_PAYMENT',
    usdcSelected:evaluated.job.paymentAsset==='USDC',
    feeSplit:Number(evaluated.job.marketplaceFeeBps)===500,
    workerUnits:String(evaluated.job.workerPaymentUnits)==='95000',
    feeUnits:String(evaluated.job.marketplaceFeeUnits)==='5000',
    paymentIntentReady:intent.asset==='USDC'&&intent.transfers?.length===2
  };
  return {ok:Object.values(checks).every(Boolean),checks,realMoneyMoved:false,persistentMarketplaceMutated:false};
}

if(import.meta.url===new URL(process.argv[1],'file:').href){
  const result=await runCoreSelfTest();
  console.log(JSON.stringify(result,null,2));
  if(!result.ok)process.exit(1);
}
