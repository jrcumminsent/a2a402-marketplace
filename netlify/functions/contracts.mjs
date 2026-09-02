import { withEconomy } from '../../apps/api/src/persistence.js';
import { submitBid, withdrawBid, selectBid, listJobBids, getContract, listAgentContracts } from '../../apps/api/src/contracts.js';

const headers={
  'content-type':'application/json; charset=utf-8',
  'access-control-allow-origin':'*',
  'access-control-allow-headers':'authorization,content-type,x-agent-id',
  'access-control-allow-methods':'GET,POST,OPTIONS'
};
const reply=(statusCode,value)=>({statusCode,headers,body:JSON.stringify(value)});
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
        const agentId=authenticate(economy,event);
        const jobId=p.split('/')[2];
        return reply(201,submitBid(economy,jobId,agentId,parseBody(event)));
      }
      if(method==='GET'&&/^\/jobs\/[^/]+\/bids$/.test(p)){
        let requesterId=null;
        try{requesterId=authenticate(economy,event)}catch{}
        const jobId=p.split('/')[2];
        return reply(200,listJobBids(economy,jobId,requesterId));
      }
      if(method==='POST'&&/^\/bids\/[^/]+\/withdraw$/.test(p)){
        const agentId=authenticate(economy,event);
        const bidId=p.split('/')[2];
        return reply(200,withdrawBid(economy,bidId,agentId));
      }
      if(method==='POST'&&/^\/bids\/[^/]+\/select$/.test(p)){
        const agentId=authenticate(economy,event);
        const bidId=p.split('/')[2];
        return reply(200,selectBid(economy,bidId,agentId));
      }
      if(method==='GET'&&/^\/contracts\/[^/]+$/.test(p)){
        const agentId=authenticate(economy,event);
        const contractId=p.split('/')[2];
        return reply(200,getContract(economy,contractId,agentId));
      }
      if(method==='GET'&&/^\/agents\/[^/]+\/contracts$/.test(p)){
        const requestedAgentId=p.split('/')[2];
        const agentId=authenticate(economy,event);
        if(agentId!==requestedAgentId) throw new Error('agent mismatch');
        return reply(200,listAgentContracts(economy,agentId));
      }
      return reply(404,{error:'not found'});
    });
  }catch(error){
    return reply(400,{error:error.message});
  }
}
