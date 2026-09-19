import { withEconomy } from '../../apps/api/src/persistence.js';
import { deepRedactSecrets, containsLikelySecret } from '../../apps/api/src/security-sanitize.js';
import { baseHeaders as headers, reply, errorResponse } from './_http.mjs';

export const config={path:'/need',rateLimit:{windowLimit:60,windowSize:60,aggregateBy:['ip','domain']}};
const authenticate=(economy,event)=>{const agentId=event.headers?.['x-agent-id']??event.headers?.['X-Agent-Id'];const auth=event.headers?.authorization??event.headers?.Authorization??'';const token=auth.startsWith('Bearer ')?auth.slice(7):'';if(!economy.authenticate(agentId,token))throw new Error('unauthorized');return agentId};
const bodyFor=event=>{if(!event.body)throw new Error('request body required');if(event.body.length>200000)throw new Error('payload too large');const data=JSON.parse(event.body);if(containsLikelySecret(data))throw new Error('payload appears to contain a credential or secret');return data};
const clean=(v,n,max=2000)=>{const s=String(v??'').trim();if(!s)throw new Error(n+' required');if(s.length>max)throw new Error(n+' too long');return s};

export async function handler(event){
  try{
    if(event.httpMethod==='OPTIONS')return{statusCode:204,headers,body:''};
    if(event.httpMethod!=='POST')return reply(405,{error:{code:'METHOD_NOT_ALLOWED',message:'POST required',retryable:false}});
    return await withEconomy(async economy=>{
      const creatorId=authenticate(economy,event),data=bodyFor(event);
      const capability=clean(data.capability||data.requiredCapability,'capability',120).toLowerCase();
      const objective=clean(data.need||data.objective||data.description,'need',4000);
      const budget=Number(data.budget??data.maxBudget??data.reward);
      if(!Number.isFinite(budget)||budget<=0)throw new Error('positive budget required');
      const paymentAsset=String(data.paymentAsset||'USDC').trim().toUpperCase();
      if(!['USDC','A2A402'].includes(paymentAsset))throw new Error('paymentAsset must be USDC or A2A402');
      const matches=economy.searchAgents({requiredCapability:capability,maxPrice:budget,minimumReputation:Number(data.minimumReputation||0)}).slice(0,10);
      if(data.preview===true)return reply(200,deepRedactSecrets({need:{capability,objective,budget,paymentAsset,paymentNetwork:'base'},matches,matchCount:matches.length,nextAction:matches.length?'POST /need again with preview=false to create the job.':'No matching provider is registered yet; creating the job will expose the demand to capable agents.'}));
      const job=economy.createJob({creatorId,creatorType:'agent',title:String(data.title||objective).slice(0,180),description:objective,requiredCapability:capability,reward:budget,paymentAsset,paymentNetwork:'base',deadline:data.deadline,input:{requirements:{version:'1.0',objective,acceptanceCriteria:Array.isArray(data.acceptanceCriteria)?data.acceptanceCriteria.slice(0,20).map(String):[]},source:'need-router',requestedBudget:budget}});
      economy.event('NEED_ROUTED',{jobId:job.id,creatorId,capability,budget,paymentAsset,matchCount:matches.length});
      return reply(201,deepRedactSecrets({job,matches,matchCount:matches.length,recommendedProvider:matches[0]||null,next:{bids:`/jobs/${job.id}/bids`,job:`/jobs/${job.id}`}}));
    });
  }catch(error){return errorResponse(error)}
}
