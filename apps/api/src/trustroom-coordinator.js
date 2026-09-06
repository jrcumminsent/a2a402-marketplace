import crypto from 'node:crypto';
import { containsLikelySecret } from './security-sanitize.js';

export const TRUSTROOM_COORDINATOR_ID='agent_trustroom_project_coordinator';
export const TRUSTROOM_COORDINATOR_NAME='TrustRoom Project Coordinator';
export const TRUSTROOM_REVIEW_CAPABILITY='construction.project.review';
export const TRUSTROOM_REVIEW_REWARD=10;
export const TRUSTROOM_COORDINATOR_CAPABILITIES=[
  'construction.project.coordinate',
  'construction.review.purchase',
  'construction.agent.delegate',
  'construction.result.verify'
];

const EVM=/^0x[a-fA-F0-9]{40}$/;
const PROHIBITED_KEY=/(^|_)(name|email|phone|street|address|password|passphrase|private[_-]?key|seed|mnemonic|auth|token|credential|secret|photo|image|document[_-]?url|private[_-]?url)($|_)/i;
const ALLOWED_PROJECT_KEYS=new Set([
  'projectRef','originalEstimate','approvedChangeOrderTotal','invoice',
  'warrantyProvided','lienWaiverProvided','scopeMetadata','changeMetadata','documentMetadata'
]);

function assert(condition,message){if(!condition)throw new Error(message)}
function finiteMoney(value,name){const n=Number(value);assert(Number.isFinite(n)&&n>=0,`${name} must be a non-negative number`);return Math.round(n*100)/100}
function cleanRef(value){const ref=String(value??'').trim();assert(ref&&ref.length<=120,'projectRef required and must be at most 120 characters');assert(!ref.includes('@'),'projectRef must be anonymous and must not contain an email address');return ref}
function safeMetadata(value,name){if(value==null)return undefined;assert(value&&typeof value==='object'&&!Array.isArray(value),`${name} must be an object`);assert(!containsLikelySecret(value),`${name} appears to contain a credential or secret`);const walk=(obj,path='')=>{for(const [key,v] of Object.entries(obj)){assert(!PROHIBITED_KEY.test(String(key)),`${name}${path}.${key} is not allowed in A2A402 specialist input`);if(v&&typeof v==='object'){assert(!Array.isArray(v)||v.length<=50,`${name}${path}.${key} is too large`);if(!Array.isArray(v))walk(v,`${path}.${key}`)}}};walk(value);return value}

export function sanitizeTrustRoomProject(input={}){
  assert(input&&typeof input==='object'&&!Array.isArray(input),'project payload must be an object');
  assert(!containsLikelySecret(input),'project payload appears to contain a credential or secret');
  for(const key of Object.keys(input))assert(ALLOWED_PROJECT_KEYS.has(key),`project field ${key} is not allowed; TrustRoom must send only the approved sanitized schema`);
  const project={
    projectRef:cleanRef(input.projectRef),
    originalEstimate:finiteMoney(input.originalEstimate,'originalEstimate'),
    approvedChangeOrderTotal:finiteMoney(input.approvedChangeOrderTotal,'approvedChangeOrderTotal'),
    invoice:finiteMoney(input.invoice,'invoice'),
    warrantyProvided:Boolean(input.warrantyProvided),
    lienWaiverProvided:Boolean(input.lienWaiverProvided)
  };
  for(const key of ['scopeMetadata','changeMetadata','documentMetadata']){const v=safeMetadata(input[key],key);if(v!==undefined)project[key]=v}
  return project;
}

export function trustRoomReviewRequirements(project){
  return {
    version:'1.0',
    objective:'Perform an independent TrustRoom construction project review using only the sanitized project data supplied.',
    inputs:[
      {name:'projectRef',type:'string',required:true,description:'Anonymous TrustRoom project reference.'},
      {name:'originalEstimate',type:'number',required:true},
      {name:'approvedChangeOrderTotal',type:'number',required:true},
      {name:'invoice',type:'number',required:true},
      {name:'warrantyProvided',type:'boolean',required:true},
      {name:'lienWaiverProvided',type:'boolean',required:true}
    ],
    deliverable:{mimeType:'application/json',description:'Structured TrustRoom Project Review v1.',schema:{
      type:'object',required:['schemaVersion','projectRef','financials','documents','scope','summary'],
      properties:{
        schemaVersion:{const:'trustroom.project-review.v1'},projectRef:{type:'string'},
        financials:{type:'object',required:['expectedTotal','invoiceTotal','variance','status']},
        documents:{type:'object',required:['warrantyProvided','lienWaiverProvided','issues']},
        scope:{type:'object',required:['issues']},
        summary:{type:'object',required:['status','findings']}
      }
    }},
    acceptanceCriteria:[
      'Return schemaVersion exactly trustroom.project-review.v1.',
      'Return the same anonymous projectRef supplied by TrustRoom.',
      'Expected total must equal original estimate plus approved change-order total.',
      'Report invoice variance without inventing documents or project facts.',
      'Document and scope findings must be arrays derived only from supplied sanitized metadata.',
      'Do not request or infer homeowner identity, contact information, street address, private media, credentials, or payment data.'
    ],
    maxDurationSeconds:86400,
    values:project
  };
}

export function ensureTrustRoomCoordinator(economy,{walletAddress,authToken,baseUrl='https://a2a402.market'}={}){
  assert(EVM.test(String(walletAddress||'')),'TRUSTROOM_COORDINATOR_WALLET_ADDRESS must be a valid EVM address');
  assert(String(authToken||'').length>=32,'TRUSTROOM_COORDINATOR_AUTH_TOKEN must be configured');
  let agent=economy.agents.get(TRUSTROOM_COORDINATOR_ID);
  if(!agent){
    agent=economy.registerAgent({
      id:TRUSTROOM_COORDINATOR_ID,
      authToken,
      name:TRUSTROOM_COORDINATOR_NAME,
      description:'Permanent first-party buyer/coordinator agent representing TrustRoom. Purchases independent construction review work and never claims its own specialist jobs.',
      endpoint:`${baseUrl}/integrations/trustroom/project-reviews`,
      capabilities:TRUSTROOM_COORDINATOR_CAPABILITIES,
      wallets:[{id:'trustroom-coordinator-base-mainnet',chain:'eip155:8453',address:walletAddress,label:'TrustRoom Project Coordinator',walletType:'metamask-agent-server-wallet',assets:['A2A402']}]
    });
  } else {
    agent.name=TRUSTROOM_COORDINATOR_NAME;
    agent.description='Permanent first-party buyer/coordinator agent representing TrustRoom. Purchases independent construction review work and never claims its own specialist jobs.';
    agent.endpoint=`${baseUrl}/integrations/trustroom/project-reviews`;
    agent.capabilities=TRUSTROOM_COORDINATOR_CAPABILITIES.map((name,i)=>({id:`${TRUSTROOM_COORDINATOR_ID}:cap:${i}`,name,description:name,inputTypes:['application/json'],outputTypes:['application/json'],pricingModel:'fixed',price:0,providerAgent:TRUSTROOM_COORDINATOR_ID,availability:true}));
    agent.wallets=[{id:'trustroom-coordinator-base-mainnet',chain:'eip155:8453',address:walletAddress,label:'TrustRoom Project Coordinator',walletType:'metamask-agent-server-wallet',assets:['A2A402']}];
    agent.paymentAddress=walletAddress;
    agent.supportedPayments=[{network:'eip155:8453',asset:'A2A402',primary:true,marketplaceFeeBps:500}];
    agent.authTokenHash=crypto.createHash('sha256').update(authToken).digest('hex');
    agent.status='ACTIVE';
  }
  return agent;
}

export function createTrustRoomReviewJob(economy,project,{coordinatorId=TRUSTROOM_COORDINATOR_ID}={}){
  const sanitized=sanitizeTrustRoomProject(project);
  const requirements=trustRoomReviewRequirements(sanitized);
  return economy.createJob({
    creatorId:coordinatorId,creatorType:'agent',
    title:`TrustRoom Project Review — ${sanitized.projectRef}`,
    description:'Independent specialist review of sanitized TrustRoom project financial, document, scope, and change-order data.',
    requiredCapability:TRUSTROOM_REVIEW_CAPABILITY,
    reward:TRUSTROOM_REVIEW_REWARD,paymentAsset:'A2A402',paymentNetwork:'base',
    verificationMethod:'trustroom-project-review-v1',
    deadline:new Date(Date.now()+24*60*60*1000).toISOString(),
    input:{program:'trustroom-project-review',classification:'first-party-integration',systemGenerated:false,countsTowardOrganic:false,project:sanitized,requirements}
  });
}

export function verifyTrustRoomReviewResult(job,result){
  const errors=[];const obj=result&&typeof result==='object'&&!Array.isArray(result)?result:null;
  if(!obj)errors.push('result must be a JSON object');
  if(obj?.schemaVersion!=='trustroom.project-review.v1')errors.push('schemaVersion must equal trustroom.project-review.v1');
  if(obj?.projectRef!==job?.input?.project?.projectRef)errors.push('projectRef does not match the TrustRoom job');
  const financials=obj?.financials;if(!financials||typeof financials!=='object')errors.push('financials object required');
  else{for(const key of ['expectedTotal','invoiceTotal','variance'])if(!Number.isFinite(Number(financials[key])))errors.push(`financials.${key} must be numeric`);if(typeof financials.status!=='string'||!financials.status)errors.push('financials.status required')}
  const documents=obj?.documents;if(!documents||typeof documents!=='object')errors.push('documents object required');
  else{if(typeof documents.warrantyProvided!=='boolean')errors.push('documents.warrantyProvided must be boolean');if(typeof documents.lienWaiverProvided!=='boolean')errors.push('documents.lienWaiverProvided must be boolean');if(!Array.isArray(documents.issues))errors.push('documents.issues must be an array')}
  const scope=obj?.scope;if(!scope||typeof scope!=='object'||!Array.isArray(scope.issues))errors.push('scope.issues array required');
  const summary=obj?.summary;if(!summary||typeof summary!=='object')errors.push('summary object required');else{if(typeof summary.status!=='string'||!summary.status)errors.push('summary.status required');if(!Array.isArray(summary.findings))errors.push('summary.findings must be an array')}
  if(obj&&containsLikelySecret(obj))errors.push('result appears to contain a credential or secret');
  return{accepted:errors.length===0,errors,schemaVersion:'trustroom.project-review.v1',verifiedAt:new Date().toISOString()};
}

export function trustRoomJobStatus(economy,job){
  const worker=job?.workerId?economy.agents.get(job.workerId):null;
  const verification=job?.result?verifyTrustRoomReviewResult(job,job.result):{accepted:false,errors:['result not submitted'],schemaVersion:'trustroom.project-review.v1',verifiedAt:null};
  return {
    jobId:job.id,status:job.status,coordinatorAgentId:job.creatorId,
    workerAgentId:job.workerId||null,workerWallet:job.payeeAddress||null,
    result:job.result||null,verification,
    payment:{asset:'A2A402',network:'base',chainId:8453,totalA2A:10,workerA2A:9.5,marketplaceFeeA2A:0.5,marketplaceFeeBps:500,payerWallet:job.payerAddress||null,workerTxHash:job.settlementTxHash||null,feeTxHash:job.feeTxHash||null,settlementStatus:job.status==='PAID'?'SETTLED':job.status==='AWAITING_PAYMENT'?'READY_FOR_AUTHORIZATION':'NOT_READY',settledAt:job.paidAt||null}
  };
}

export function trustRoomSettlementIntent(job,{treasuryAddress,maxPerJob=10}={}){
  assert(job.status==='AWAITING_PAYMENT','job must be verified and awaiting payment');
  assert(job.creatorId===TRUSTROOM_COORDINATOR_ID,'job is not owned by the TrustRoom Project Coordinator');
  assert(Number(job.reward)<=Number(maxPerJob),'job exceeds TrustRoom coordinator per-job spending limit');
  assert(EVM.test(job.payerAddress||''),'coordinator payer wallet missing');
  assert(EVM.test(job.payeeAddress||''),'worker payout wallet missing');
  assert(EVM.test(treasuryAddress||''),'marketplace treasury wallet missing');
  return {authorizationRequired:true,transactionBroadcast:false,jobId:job.id,asset:'A2A402',network:'base',chainId:8453,tokenAddress:process.env.A2A402_TOKEN_ADDRESS||process.env.A2A402_EXPECTED_TOKEN_ADDRESS||null,payerAddress:job.payerAddress,worker:{to:job.payeeAddress,amountA2A:9.5,amountUnits:job.workerPaymentUnits},fee:{to:treasuryAddress,amountA2A:0.5,amountUnits:job.marketplaceFeeUnits},marketplaceFeeBps:job.marketplaceFeeBps};
}
