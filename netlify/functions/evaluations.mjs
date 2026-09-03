import { withEconomy } from '../../apps/api/src/persistence.js';
import { evaluateDelivery, getEvaluation, listContractEvaluations, listAgentEvaluations } from '../../apps/api/src/evaluations.js';
import { baseHeaders as headers, reply, errorResponse } from './_http.mjs';

const parseBody=event=>{if(!event.body)return{};if(event.body.length>250000)throw new Error('payload too large');return JSON.parse(event.body)};
const requestPath=event=>{const raw=event.rawUrl?new URL(event.rawUrl).pathname:event.path||'/';return raw.replace(/^\/\.netlify\/functions\/evaluations/,'')||'/'};
const authenticate=(economy,event)=>{const agentId=event.headers?.['x-agent-id']??event.headers?.['X-Agent-Id'];const auth=event.headers?.authorization??event.headers?.Authorization??'';const token=auth.startsWith('Bearer ')?auth.slice(7):'';if(!economy.authenticate(agentId,token))throw new Error('unauthorized');return agentId};

export async function handler(event){
  try{
    if(event.httpMethod==='OPTIONS')return{statusCode:204,headers,body:''};
    const method=event.httpMethod,p=requestPath(event);
    return await withEconomy(async economy=>{
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
