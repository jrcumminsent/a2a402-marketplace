import { withEconomy } from '../../apps/api/src/persistence.js';
import { deepRedactSecrets, containsLikelySecret } from '../../apps/api/src/security-sanitize.js';
import { baseHeaders as headers, reply, errorResponse } from './_http.mjs';

export const config={
  path:'/jobs',
  rateLimit:{windowLimit:120,windowSize:60,aggregateBy:['ip','domain']}
};

const ALLOWED_REQUIREMENT_TYPES=new Set(['string','number','integer','boolean','array','object','url']);
const cleanString=(value,max,name)=>{const s=String(value??'').trim();if(!s)throw new Error(`${name} required`);if(s.length>max)throw new Error(`${name} must be at most ${max} characters`);return s};
const cleanTags=value=>Array.isArray(value)?[...new Set(value.map(x=>String(x).trim().toLowerCase()).filter(Boolean))].slice(0,20):[];
function normalizeRequirements(value){
  if(value==null)return null;
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('requirements must be an object');
  const out={version:'1.0'};
  if(value.objective!=null)out.objective=cleanString(value.objective,4000,'requirements.objective');
  if(value.inputs!=null){
    if(!Array.isArray(value.inputs)||value.inputs.length>50)throw new Error('requirements.inputs must be an array with at most 50 items');
    out.inputs=value.inputs.map((item,i)=>{
      if(!item||typeof item!=='object'||Array.isArray(item))throw new Error(`requirements.inputs[${i}] must be an object`);
      const name=cleanString(item.name??`input_${i+1}`,120,`requirements.inputs[${i}].name`);
      const type=String(item.type??'string').trim().toLowerCase();
      if(!ALLOWED_REQUIREMENT_TYPES.has(type))throw new Error(`requirements.inputs[${i}].type is unsupported`);
      const normalized={name,type,required:item.required!==false};
      if(item.description!=null)normalized.description=cleanString(item.description,1000,`requirements.inputs[${i}].description`);
      if(item.value!==undefined)normalized.value=item.value;
      return normalized;
    });
  }
  if(value.deliverable!=null){
    if(!value.deliverable||typeof value.deliverable!=='object'||Array.isArray(value.deliverable))throw new Error('requirements.deliverable must be an object');
    const d=value.deliverable;out.deliverable={};
    if(d.mimeType!=null)out.deliverable.mimeType=cleanString(d.mimeType,120,'requirements.deliverable.mimeType');
    if(d.description!=null)out.deliverable.description=cleanString(d.description,2000,'requirements.deliverable.description');
    if(d.schema!=null){if(!d.schema||typeof d.schema!=='object'||Array.isArray(d.schema))throw new Error('requirements.deliverable.schema must be an object');out.deliverable.schema=d.schema}
  }
  if(value.acceptanceCriteria!=null){
    if(!Array.isArray(value.acceptanceCriteria)||value.acceptanceCriteria.length>30)throw new Error('requirements.acceptanceCriteria must be an array with at most 30 items');
    out.acceptanceCriteria=value.acceptanceCriteria.map((x,i)=>cleanString(x,1000,`requirements.acceptanceCriteria[${i}]`));
  }
  if(value.maxDurationSeconds!=null){const n=Number(value.maxDurationSeconds);if(!Number.isFinite(n)||n<=0||n>604800)throw new Error('requirements.maxDurationSeconds must be between 1 and 604800');out.maxDurationSeconds=Math.floor(n)}
  return out;
}
function queryParams(event){
  const out={...(event.queryStringParameters||{})};
  try{if(event.rawUrl){for(const [key,value] of new URL(event.rawUrl).searchParams.entries()){if(out[key]==null)out[key]=value;}}}catch{}
  return out;
}
function isLegacyTestJob(job){
  const asset=String(job.paymentAsset||'').toUpperCase(),network=String(job.paymentNetwork||'').toLowerCase();
  return asset==='USDC_TEST'||network==='base-sepolia'||network==='eip155:84532';
}
function filteredJobs(economy,q){
  let jobs=[...economy.jobs.values()];
  const includeLegacy=['1','true','yes'].includes(String(q.includeLegacy||'').toLowerCase());
  if(!includeLegacy)jobs=jobs.filter(j=>!isLegacyTestJob(j));
  if(q.status)jobs=jobs.filter(j=>String(j.status||'').toUpperCase()===String(q.status).trim().toUpperCase());
  if(q.capability){const capability=String(q.capability).trim().toLowerCase();jobs=jobs.filter(j=>String(j.requiredCapability||'').trim().toLowerCase()===capability);}
  if(q.category)jobs=jobs.filter(j=>String(j.input?.category||'').toLowerCase()===String(q.category).trim().toLowerCase());
  if(q.tag){const tag=String(q.tag).trim().toLowerCase();jobs=jobs.filter(j=>Array.isArray(j.input?.tags)&&j.input.tags.map(x=>String(x).toLowerCase()).includes(tag));}
  if(q.paymentAsset)jobs=jobs.filter(j=>String(j.paymentAsset||'').toUpperCase()===String(q.paymentAsset).trim().toUpperCase());
  return deepRedactSecrets(jobs);
}
function authenticate(economy,event){const agentId=event.headers?.['x-agent-id']??event.headers?.['X-Agent-Id'];const auth=event.headers?.authorization??event.headers?.Authorization??'';const token=auth.startsWith('Bearer ')?auth.slice(7):'';if(!economy.authenticate(agentId,token))throw new Error('unauthorized');return agentId}
function parseBody(event){if(!event.body)return{};if(event.body.length>1_000_000)throw new Error('payload too large');const data=JSON.parse(event.body);if(containsLikelySecret(data))throw new Error('payload appears to contain a credential or secret; submit references instead of secrets');return data}

export async function handler(event){
  try{
    if(event.httpMethod==='OPTIONS')return{statusCode:204,headers,body:''};
    const q=queryParams(event);
    return await withEconomy(async economy=>{
      if(event.httpMethod==='GET')return reply(200,filteredJobs(economy,q));
      if(event.httpMethod==='POST'){
        const agentId=authenticate(economy,event),data=parseBody(event);
        if(data.creatorId&&data.creatorId!==agentId)throw new Error('creatorId must match authenticated agent');
        const requirements=normalizeRequirements(data.requirements);
        const category=data.category==null?null:cleanString(data.category,80,'category').toLowerCase();
        const tags=cleanTags(data.tags);
        data.creatorId=agentId;data.creatorType='agent';
        data.input={...(data.input&&typeof data.input==='object'&&!Array.isArray(data.input)?data.input:{}),...(requirements?{requirements}:{}),...(category?{category}:{}),...(tags.length?{tags}:{})};
        delete data.requirements;delete data.category;delete data.tags;
        return reply(201,deepRedactSecrets(economy.createJob(data)));
      }
      return reply(405,{error:{code:'METHOD_NOT_ALLOWED',message:'method not allowed',retryable:false}});
    });
  }catch(error){return errorResponse(error)}
}
