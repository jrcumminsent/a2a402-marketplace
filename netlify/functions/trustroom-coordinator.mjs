import { withEconomy } from '../../apps/api/src/persistence.js';
import { deepRedactSecrets, containsLikelySecret } from '../../apps/api/src/security-sanitize.js';
import { baseHeaders as headers, reply, errorResponse } from './_http.mjs';
import { TRUSTROOM_COORDINATOR_ID, ensureTrustRoomCoordinator, createTrustRoomReviewJob, verifyTrustRoomReviewResult, trustRoomJobStatus, trustRoomSettlementIntent } from '../../apps/api/src/trustroom-coordinator.js';

export const config={path:'/integrations/trustroom/*',rateLimit:{windowLimit:120,windowSize:60,aggregateBy:['ip','domain']}};
const WALLET=()=>process.env.TRUSTROOM_COORDINATOR_WALLET_ADDRESS||'';
const TOKEN=()=>process.env.TRUSTROOM_COORDINATOR_AUTH_TOKEN||'';
const TREASURY=()=>process.env.A2A402_TREASURY_ADDRESS||process.env.A2A402_EXPECTED_TREASURY_ADDRESS||'';
const MAX_PER_JOB=()=>Number(process.env.TRUSTROOM_COORDINATOR_MAX_PER_JOB_A2A||10);
function bearer(event){const auth=event.headers?.authorization??event.headers?.Authorization??'';return auth.startsWith('Bearer ')?auth.slice(7):''}
function authorize(event){const supplied=bearer(event);if(!supplied||supplied!==TOKEN())throw new Error('unauthorized')}
function parse(event){if(!event.body)return{};if(event.body.length>250000)throw new Error('payload too large');const data=JSON.parse(event.body);if(containsLikelySecret(data))throw new Error('payload appears to contain a credential or secret');return data}
function path(event){try{return new URL(event.rawUrl||`https://a2a402.market${event.path||''}`).pathname}catch{return event.path||''}}
function jobFromPath(p){const m=p.match(/^\/integrations\/trustroom\/project-reviews\/([^/]+)(?:\/(verify|settlement-intent))?\/?$/);return m?{jobId:decodeURIComponent(m[1]),action:m[2]||null}:null}
export async function handler(event){try{
  if(event.httpMethod==='OPTIONS')return{statusCode:204,headers,body:''};authorize(event);
  return await withEconomy(async economy=>{
    const coordinator=ensureTrustRoomCoordinator(economy,{walletAddress:WALLET(),authToken:TOKEN()});const p=path(event);
    if(p==='/integrations/trustroom/coordinator'&&event.httpMethod==='GET')return reply(200,deepRedactSecrets(economy.publicAgent(coordinator)));
    if(p==='/integrations/trustroom/project-reviews'&&event.httpMethod==='POST'){
      const data=parse(event),job=createTrustRoomReviewJob(economy,data.project||data);
      return reply(201,{...trustRoomJobStatus(economy,job),message:'Specialist job created OPEN. The TrustRoom Project Coordinator cannot claim its own job.'});
    }
    const target=jobFromPath(p);if(target){const job=economy.jobs.get(target.jobId);if(!job||job.creatorId!==TRUSTROOM_COORDINATOR_ID)throw new Error('TrustRoom project-review job not found');
      if(event.httpMethod==='GET'&&!target.action)return reply(200,deepRedactSecrets(trustRoomJobStatus(economy,job)));
      if(event.httpMethod==='POST'&&target.action==='verify'){
        const verification=verifyTrustRoomReviewResult(job,job.result);if(job.status!=='SUBMITTED')throw new Error('job must be SUBMITTED before TrustRoom verification');
        const verified=await economy.verifyJob(job.id,TRUSTROOM_COORDINATOR_ID,{accepted:verification.accepted});
        return reply(200,{...deepRedactSecrets(trustRoomJobStatus(economy,verified)),verification});
      }
      if(event.httpMethod==='POST'&&target.action==='settlement-intent'){
        const verification=verifyTrustRoomReviewResult(job,job.result);if(!verification.accepted)throw new Error(`result failed TrustRoom schema verification: ${verification.errors.join('; ')}`);
        return reply(200,deepRedactSecrets(trustRoomSettlementIntent(job,{treasuryAddress:TREASURY(),maxPerJob:MAX_PER_JOB()})));
      }
    }
    return reply(405,{error:{code:'METHOD_NOT_ALLOWED',message:'method not allowed',retryable:false}});
  });
}catch(error){return errorResponse(error)}}
