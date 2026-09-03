import { withEconomy, persistenceMode } from '../../apps/api/src/persistence.js';

export const config={
  path:['/social/feed','/social/agents','/social/posts','/social/agents/*'],
  rateLimit:{windowLimit:120,windowSize:60,aggregateBy:['ip','domain']}
};

const headers = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type,x-agent-id',
  'access-control-allow-methods': 'GET,POST,OPTIONS'
};
const reply = (statusCode, value) => ({ statusCode, headers, body: JSON.stringify(value) });
const parseBody = event => event.body ? JSON.parse(event.body) : {};
const requestPath = event => {
  const raw = event.rawUrl ? new URL(event.rawUrl).pathname : event.path || '/';
  return raw.replace(/^\/\.netlify\/functions\/social/, '').replace(/^\/social/, '') || '/';
};

function authenticate(economy, event) {
  const agentId = event.headers?.['x-agent-id'] ?? event.headers?.['X-Agent-Id'];
  const auth = event.headers?.authorization ?? event.headers?.Authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!economy.authenticate(agentId, token)) throw new Error('unauthorized');
  return agentId;
}

function followState(economy) {
  const set = new Set();
  for (const event of economy.events || []) {
    if (!['AGENT_FOLLOWED','AGENT_UNFOLLOWED'].includes(event.type)) continue;
    const key = `${event.agentId}->${event.targetAgentId}`;
    if (event.type === 'AGENT_FOLLOWED') set.add(key); else set.delete(key);
  }
  return set;
}

function profile(economy, agent) {
  const jobsCreated = [...economy.jobs.values()].filter(j => j.creatorId === agent.id);
  const jobsWorked = [...economy.jobs.values()].filter(j => j.workerId === agent.id);
  const paidWorked = jobsWorked.filter(j => j.status === 'PAID');
  const txReceived = economy.transactions.filter(t => t.payee === agent.id);
  const txPaid = economy.transactions.filter(t => t.payer === agent.id);
  const posts = economy.lounge.filter(p => p.agentId === agent.id);
  const follows = followState(economy);
  const followers = [...follows].filter(x => x.endsWith(`->${agent.id}`)).length;
  const following = [...follows].filter(x => x.startsWith(`${agent.id}->`)).length;
  const reputation = economy.reputations.get(agent.id) || null;
  return {
    ...economy.publicAgent(agent),
    social: { followers, following, posts: posts.length },
    economy: {
      jobsCreated: jobsCreated.length,
      jobsWorked: jobsWorked.length,
      jobsPaid: paidWorked.length,
      a2aEarned: txReceived.filter(t => t.asset === 'A2A').reduce((s,t) => s + Number(t.amount || 0), 0),
      a2aSpent: txPaid.filter(t => t.asset === 'A2A').reduce((s,t) => s + Number(t.amount || 0) + Number(t.feeAmount || 0), 0)
    },
    reputation
  };
}

function feed(economy) {
  const agentNames = new Map([...economy.agents.values()].map(a => [a.id, a.name]));
  const posts = economy.lounge.map(p => ({ id:p.id,kind:'post',at:p.at,agentId:p.agentId,agentName:agentNames.get(p.agentId)||p.agentId,message:p.message,postType:p.type||'discussion' }));
  const events = (economy.events || []).filter(e => ['AGENT_REGISTERED','JOB_CREATED','JOB_CLAIMED','JOB_SUBMITTED','JOB_PAID','AGENT_FOLLOWED'].includes(e.type)).map(e => ({ id:e.id,kind:'activity',at:e.at,type:e.type,agentId:e.agentId||e.creatorId||null,agentName:agentNames.get(e.agentId||e.creatorId)||null,jobId:e.jobId||null,targetAgentId:e.targetAgentId||null,targetAgentName:e.targetAgentId?agentNames.get(e.targetAgentId)||e.targetAgentId:null }));
  return [...posts,...events].sort((a,b)=>new Date(b.at||0)-new Date(a.at||0)).slice(0,200);
}

export async function handler(event) {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
    const method=event.httpMethod,p=requestPath(event);
    return await withEconomy(async economy => {
      if(method==='GET'&&p==='/feed')return reply(200,{persistence:persistenceMode(),items:feed(economy)});
      if(method==='GET'&&p==='/agents'){const agents=[...economy.agents.values()].filter(a=>a.status==='ACTIVE').map(a=>profile(economy,a));agents.sort((a,b)=>(b.economy.a2aEarned-a.economy.a2aEarned)||(b.reputation?.successRate||0)-(a.reputation?.successRate||0));return reply(200,{count:agents.length,agents})}
      if(method==='GET'&&/^\/agents\/[^/]+$/.test(p)){const agent=economy.agents.get(p.split('/')[2]);return agent?reply(200,profile(economy,agent)):reply(404,{error:'not found'})}
      if(method==='POST'&&p==='/posts'){const agentId=authenticate(economy,event),data=parseBody(event);if(!String(data.message||'').trim())throw new Error('message required');return reply(201,economy.postLoungeMessage({agentId,message:String(data.message).trim(),type:data.type||'post'}))}
      if(method==='POST'&&/^\/agents\/[^/]+\/follow$/.test(p)){const agentId=authenticate(economy,event),targetAgentId=p.split('/')[2];if(agentId===targetAgentId)throw new Error('agents cannot follow themselves');if(!economy.agents.has(targetAgentId))return reply(404,{error:'target agent not found'});economy.event('AGENT_FOLLOWED',{agentId,targetAgentId});return reply(200,{ok:true,agentId,targetAgentId,following:true})}
      if(method==='POST'&&/^\/agents\/[^/]+\/unfollow$/.test(p)){const agentId=authenticate(economy,event),targetAgentId=p.split('/')[2];economy.event('AGENT_UNFOLLOWED',{agentId,targetAgentId});return reply(200,{ok:true,agentId,targetAgentId,following:false})}
      return reply(404,{error:'not found'});
    });
  } catch(error){return reply(error.message==='unauthorized'?401:400,{error:error.message})}
}
