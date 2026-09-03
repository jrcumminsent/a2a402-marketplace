import { withEconomy } from '../../apps/api/src/persistence.js';
import { submitBid, withdrawBid, selectBid, listJobBids, getContract, listAgentContracts } from '../../apps/api/src/contracts.js';
import { baseHeaders as headers, reply, errorResponse } from './_http.mjs';

const parseBody=event=>event.body?JSON.parse(event.body):{};
const requestPath=event=>{const raw=event.rawUrl?new URL(event.rawUrl).pathname:event.path||'/';return raw.replace(/^\/\.netlify\/functions\/contracts/,'')||'/'};
const authenticate=(economy,event)=>{const agentId=event.headers?.['x-agent-id']??event.headers?.['X-Agent-Id'];const auth=event.headers?.authorization??event.headers?.Authorization??'';const token=auth.startsWith('Bearer ')?auth.slice(7):'';if(!economy.authenticate(agentId,token))throw new Error('unauthorized');return agentId};

export async function handler(event){
  try{
    if(event.httpMethod==='OPTIONS') return {statusCode:204,headers,body:''};
    const method=event.httpMethod;
    const p=requestPath(event);
    return await withEconomy(async economy=>{
      if(method==='POST'&&/^\/jobs\/[^/]+\/bids$/.test(p)){
        const agentId=authenticate(economy,event); const jobId=p.split('/')[2];
        return reply(201,submitBid(economy,jobId,agentId,parseBody(event)));
      }
      if(method==='GET'&&/^\/jobs\/[^/]+\/bids$/.test(p)){
        let requesterId=null; try{requesterId=authenticate(economy,event)}catch{}
        return reply(200,listJobBids(economy,p.split('/')[2],requesterId));
      }
      if(method==='POST'&&/^\/bids\/[^/]+\/withdraw$/.test(p)){
        const agentId=authenticate(economy,event); return reply(200,withdrawBid(economy,p.split('/')[2],agentId));
      }
      if(method==='POST'&&/^\/bids\/[^/]+\/select$/.test(p)){
        const agentId=authenticate(economy,event); return reply(200,selectBid(economy,p.split('/')[2],agentId,parseBody(event)));
      }
      if(method==='GET'&&/^\/contracts\/[^/]+$/.test(p)){
        const agentId=authenticate(economy,event); return reply(200,getContract(economy,p.split('/')[2],agentId));
      }
      if(method==='GET'&&/^\/agents\/[^/]+\/contracts$/.test(p)){
        const requestedAgentId=p.split('/')[2]; const agentId=authenticate(economy,event); if(agentId!==requestedAgentId) throw new Error('agent mismatch');
        return reply(200,listAgentContracts(economy,agentId));
      }
      return reply(404,{error:{code:'NOT_FOUND',message:'not found',retryable:false}});
    });
  }catch(error){return errorResponse(error);}
}
