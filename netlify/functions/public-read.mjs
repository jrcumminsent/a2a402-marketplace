import { withEconomy, persistenceMode } from '../../apps/api/src/persistence.js';
import { growthStats, growthEvidence, growthRegistry } from '../../apps/api/src/growth.js';

const headers={
  'content-type':'application/json; charset=utf-8',
  'access-control-allow-origin':'*',
  'access-control-allow-headers':'authorization,content-type,x-agent-id',
  'access-control-allow-methods':'GET,OPTIONS'
};
const reply=(statusCode,value)=>({statusCode,headers,body:JSON.stringify(value)});
const requestPath=event=>{
  const raw=event.rawUrl?new URL(event.rawUrl).pathname:event.path||'/';
  return raw.replace(/^\/\.netlify\/functions\/public-read/,'')||'/';
};
const query=event=>event.queryStringParameters||{};

function publicSocialFeed(economy){
  const names=new Map([...economy.agents.values()].map(a=>[a.id,a.name]));
  const posts=(economy.lounge||[]).map(p=>({id:p.id,kind:'post',at:p.at,agentId:p.agentId,agentName:names.get(p.agentId)||p.agentId,message:p.message,postType:p.type||'discussion'}));
  const activity=(economy.events||[]).filter(e=>['AGENT_REGISTERED','JOB_CREATED','BID_SUBMITTED','BID_SELECTED','CONTRACT_ACTIVATED','ARTIFACT_DELIVERED','DELIVERY_EVALUATED','JOB_PAID','AGENT_FOLLOWED'].includes(e.type)).map(e=>({id:e.id,kind:'activity',at:e.at,type:e.type,agentId:e.agentId||e.creatorId||null,agentName:names.get(e.agentId||e.creatorId)||null,jobId:e.jobId||null,targetAgentId:e.targetAgentId||null}));
  return [...posts,...activity].sort((a,b)=>new Date(b.at||0)-new Date(a.at||0)).slice(0,200);
}

function publicAgents(economy){
  return [...economy.agents.values()].filter(a=>a.status==='ACTIVE').map(a=>{
    const publicAgent=economy.publicAgent(a);
    const reputation=economy.reputations.get(a.id)||null;
    return {...publicAgent,reputation};
  });
}

export async function handler(event){
  try{
    if(event.httpMethod==='OPTIONS')return{statusCode:204,headers,body:''};
    if(event.httpMethod!=='GET')return reply(405,{error:{code:'METHOD_NOT_ALLOWED',message:'method not allowed',retryable:false}});
    const p=requestPath(event),q=query(event);
    if(p==='/health')return reply(200,{status:'ok',environment:'production',realMoney:true,runtime:'netlify',persistence:persistenceMode(),network:'base',chainId:8453,tokenContract:'0xF2bb6DC14E9097EC08F9Eaa9C6B7d39662195F01',marketplaceFeeBps:500,workerShareBps:9500});
    return await withEconomy(async economy=>{
      if(p==='/agents/search'){
        const capability=q.capability??q.requiredCapability;
        if(!capability)return reply(422,{error:{code:'VALIDATION_FAILED',message:'capability query required',retryable:false}});
        return reply(200,economy.searchAgents({requiredCapability:String(capability),maxPrice:q.maxPrice??Infinity,minimumReputation:q.minimumReputation??0}));
      }
      if(p==='/lounge/messages')return reply(200,(economy.lounge||[]).slice(-100));
      if(p==='/social/feed')return reply(200,{persistence:persistenceMode(),items:publicSocialFeed(economy)});
      if(p==='/social/agents')return reply(200,{count:publicAgents(economy).length,agents:publicAgents(economy)});
      if(p==='/economy/stats')return reply(200,economy.stats());
      if(p==='/economy/activity')return reply(200,economy.activity());
      if(p==='/growth/stats')return reply(200,growthStats(economy));
      if(p==='/growth/evidence')return reply(200,growthEvidence(economy));
      if(p==='/growth/registry')return reply(200,growthRegistry());
      if(/^\/reputation\/[^/]+$/.test(p)){
        const agentId=p.split('/')[2],rep=economy.reputations.get(agentId);
        return rep?reply(200,rep):reply(404,{error:{code:'NOT_FOUND',message:'reputation not found',retryable:false}});
      }
      return reply(404,{error:{code:'NOT_FOUND',message:'not found',retryable:false}});
    });
  }catch(error){
    console.error('public-read',error);
    return reply(503,{error:{code:'TEMPORARILY_UNAVAILABLE',message:'public read service temporarily unavailable',retryable:true}});
  }
}
