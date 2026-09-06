import { withEconomy } from '../../apps/api/src/persistence.js';
import { evaluateDelivery, getEvaluation, listContractEvaluations, listAgentEvaluations } from '../../apps/api/src/evaluations.js';
import { baseHeaders as headers, reply, errorResponse } from './_http.mjs';

const parseBody=event=>{if(!event.body)return{};if(event.body.length>250000)throw new Error('payload too large');return JSON.parse(event.body)};
const requestPath=event=>{const raw=event.rawUrl?new URL(event.rawUrl).pathname:event.path||'/';return raw.replace(/^\/\.netlify\/functions\/evaluations/,'')||'/'};
const authenticate=(economy,event)=>{const agentId=event.headers?.['x-agent-id']??event.headers?.['X-Agent-Id'];const auth=event.headers?.authorization??event.headers?.Authorization??'';const token=auth.startsWith('Bearer ')?auth.slice(7):'';if(!economy.authenticate(agentId,token))throw new Error('unauthorized');return agentId};

function isPublicHttpUrl(value){
  try{
    const u=new URL(String(value));
    if(!['http:','https:'].includes(u.protocol))return false;
    const h=u.hostname.toLowerCase();
    if(h==='localhost'||h.endsWith('.local')||h==='127.0.0.1'||h==='0.0.0.0'||h==='::1')return false;
    if(/^10\./.test(h)||/^192\.168\./.test(h)||/^169\.254\./.test(h)||/^172\.(1[6-9]|2\d|3[0-1])\./.test(h))return false;
    return true;
  }catch{return false}
}
function extractEntries(content){
  if(Array.isArray(content))return content;
  if(!content||typeof content!=='object')return null;
  for(const key of ['surfaces','entries','items','results','discoverySurfaces'])if(Array.isArray(content[key]))return content[key];
  return null;
}
function field(obj,names){for(const name of names){if(obj?.[name]!=null&&String(obj[name]).trim())return String(obj[name]).trim()}return null}
async function reachable(url){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),7000);
  try{
    let r=await fetch(url,{method:'HEAD',redirect:'follow',signal:controller.signal,headers:{'user-agent':'a2a402-genesis-verifier/1.0'}});
    if(r.status===405||r.status===403)r=await fetch(url,{method:'GET',redirect:'follow',signal:controller.signal,headers:{'user-agent':'a2a402-genesis-verifier/1.0','accept':'application/json,text/plain,text/html;q=0.8,*/*;q=0.5'}});
    return r.status>=200&&r.status<400;
  }catch{return false}finally{clearTimeout(timer)}
}
async function validateDiscoveryGenesis(economy,delivery){
  const job=economy.jobs.get(delivery.jobId),artifact=economy.artifacts?.get(delivery.artifactId);
  if(!job||!artifact)return{eligible:false,accepted:false,reason:'Missing job or artifact.'};
  if(job.input?.program!=='genesis-work-pool'||job.input?.bootstrapKey!=='external-agent-discovery-1')return{eligible:false,accepted:false,reason:'No deterministic auto-validator exists for this Genesis job.'};
  const entries=extractEntries(artifact.content);
  if(!entries||entries.length!==5)return{eligible:true,accepted:false,reason:'Expected exactly five discovery surfaces.'};
  const urls=[];
  for(let i=0;i<entries.length;i++){
    const item=entries[i];
    if(!item||typeof item!=='object')return{eligible:true,accepted:false,reason:`Entry ${i+1} must be an object.`};
    const name=field(item,['name','title']);
    const url=field(item,['url','href','endpoint']);
    const protocol=field(item,['protocol','format','protocolFormat','protocol_or_format','protocolOrFormat']);
    const usefulness=field(item,['usefulness','whyUseful','why_useful','why','utility','description']);
    if(!name||!url||!protocol||!usefulness)return{eligible:true,accepted:false,reason:`Entry ${i+1} is missing name, URL, protocol/format, or usefulness.`};
    if(!isPublicHttpUrl(url))return{eligible:true,accepted:false,reason:`Entry ${i+1} URL is not a permitted public HTTP(S) URL.`};
    urls.push(url);
  }
  if(new Set(urls.map(x=>x.toLowerCase())).size!==5)return{eligible:true,accepted:false,reason:'All five URLs must be distinct.'};
  const checks=await Promise.all(urls.map(reachable));
  if(checks.some(ok=>!ok))return{eligible:true,accepted:false,reason:'One or more submitted URLs could not be independently reached by the verifier.',urlChecks:urls.map((url,i)=>({url,reachable:checks[i]}))};
  return{eligible:true,accepted:true,qualityScore:100,reason:'Deterministic Genesis validator passed: exactly five distinct surfaces, required fields present, and all public URLs independently reachable.',evidence:{artifactSha256:artifact.sha256,validator:'genesis-discovery-v1',urlChecks:urls.map(url=>({url,reachable:true}))}};
}

export async function handler(event){
  try{
    if(event.httpMethod==='OPTIONS')return{statusCode:204,headers,body:''};
    const method=event.httpMethod,p=requestPath(event);
    return await withEconomy(async economy=>{
      if(method==='POST'&&/^\/deliveries\/[^/]+\/auto-evaluate$/.test(p)){
        const agentId=authenticate(economy,event),deliveryId=p.split('/')[2];
        const delivery=economy.deliveries?.get(deliveryId);
        if(!delivery)return reply(404,{error:{code:'NOT_FOUND',message:'delivery not found',retryable:false}});
        if(delivery.workerId!==agentId)return reply(403,{error:{code:'FORBIDDEN',message:'only the delivery worker may request Genesis auto-evaluation',retryable:false}});
        if(delivery.status!=='SUBMITTED'){
          const existing=[...(economy.evaluations?.values?.()||[])].find(e=>e.deliveryId===deliveryId&&e.status==='FINAL');
          if(existing)return reply(200,{evaluation:existing,delivery,job:economy.jobs.get(delivery.jobId),autoEvaluation:{eligible:true,alreadyEvaluated:true}});
          return reply(409,{error:{code:'INVALID_STATE',message:'delivery is not awaiting evaluation',retryable:false}});
        }
        const verdict=await validateDiscoveryGenesis(economy,delivery);
        if(!verdict.eligible)return reply(200,{delivery,autoEvaluation:verdict});
        if(!verdict.accepted)return reply(422,{delivery,autoEvaluation:verdict});
        const result=await evaluateDelivery(economy,deliveryId,delivery.creatorId,{accepted:true,qualityScore:verdict.qualityScore,reason:verdict.reason,evidence:verdict.evidence,idempotencyKey:`genesis-auto-evaluate:${deliveryId}:v1`});
        return reply(201,{...result,autoEvaluation:{eligible:true,accepted:true,validator:'genesis-discovery-v1'}});
      }
      if(method==='POST'&&/^\/deliveries\/[^/]+\/evaluate$/.test(p)){
        const agentId=authenticate(economy,event),deliveryId=p.split('/')[2];
        return reply(201,await evaluateDelivery(economy,deliveryId,agentId,parseBody(event)));
      }
      if(method==='GET'&&/^\/evaluations\/[^/]+$/.test(p)){
        const agentId=authenticate(economy,event),evaluationId=p.split('/')[2];
        return reply(200,getEvaluation(economy,evaluationId,agentId));
      }
      if(method==='GET'&&/^\/contracts\/[^/]+\/evaluations$/.test(p)){
        const agentId=authenticate(economy,event),contractId=p.split('/')[2];
        return reply(200,listContractEvaluations(economy,contractId,agentId));
      }
      if(method==='GET'&&/^\/agents\/[^/]+\/evaluations$/.test(p)){
        const requested=p.split('/')[2],agentId=authenticate(economy,event);
        return reply(200,listAgentEvaluations(economy,requested,agentId));
      }
      return reply(404,{error:{code:'NOT_FOUND',message:'not found',retryable:false}});
    });
  }catch(error){return errorResponse(error);}
}
