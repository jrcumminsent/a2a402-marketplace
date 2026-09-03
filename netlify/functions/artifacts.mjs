import { withEconomy } from '../../apps/api/src/persistence.js';
import { createArtifact, deliverArtifact, getArtifact, getDelivery, listContractDeliveries } from '../../apps/api/src/artifacts.js';
import { containsLikelySecret, deepRedactSecrets } from '../../apps/api/src/security-sanitize.js';
import { baseHeaders as headers, reply, errorResponse } from './_http.mjs';

const parseBody=event=>{if(!event.body)return{};if(event.body.length>1_000_000)throw new Error('payload too large');const data=JSON.parse(event.body);if(containsLikelySecret(data))throw new Error('payload appears to contain a credential or secret; submit references instead of secrets');return data};
const requestPath=event=>{const raw=event.rawUrl?new URL(event.rawUrl).pathname:event.path||'/';return raw.replace(/^\/\.netlify\/functions\/artifacts/,'')||'/'};
const authenticate=(economy,event)=>{const agentId=event.headers?.['x-agent-id']??event.headers?.['X-Agent-Id'];const auth=event.headers?.authorization??event.headers?.Authorization??'';const token=auth.startsWith('Bearer ')?auth.slice(7):'';if(!economy.authenticate(agentId,token))throw new Error('unauthorized');return agentId};

export async function handler(event){
  try{
    if(event.httpMethod==='OPTIONS') return {statusCode:204,headers,body:''};
    const method=event.httpMethod,p=requestPath(event);
    return await withEconomy(async economy=>{
      if(method==='POST'&&/^\/contracts\/[^/]+\/artifacts$/.test(p)){
        const agentId=authenticate(economy,event),contractId=p.split('/')[2];
        return reply(201,deepRedactSecrets(createArtifact(economy,contractId,agentId,parseBody(event))));
      }
      if(method==='POST'&&/^\/contracts\/[^/]+\/deliveries$/.test(p)){
        const agentId=authenticate(economy,event),contractId=p.split('/')[2];
        return reply(201,deepRedactSecrets(deliverArtifact(economy,contractId,agentId,parseBody(event))));
      }
      if(method==='GET'&&/^\/contracts\/[^/]+\/deliveries$/.test(p)){
        const agentId=authenticate(economy,event),contractId=p.split('/')[2];
        return reply(200,deepRedactSecrets(listContractDeliveries(economy,contractId,agentId)));
      }
      if(method==='GET'&&/^\/artifacts\/[^/]+$/.test(p)){
        const agentId=authenticate(economy,event),artifactId=p.split('/')[2];
        return reply(200,deepRedactSecrets(getArtifact(economy,artifactId,agentId)));
      }
      if(method==='GET'&&/^\/deliveries\/[^/]+$/.test(p)){
        const agentId=authenticate(economy,event),deliveryId=p.split('/')[2];
        return reply(200,deepRedactSecrets(getDelivery(economy,deliveryId,agentId)));
      }
      return reply(404,{error:{code:'NOT_FOUND',message:'not found',retryable:false}});
    });
  }catch(error){return errorResponse(error)}
}
