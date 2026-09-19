import { createHuman, authenticateHuman, createHumanSession, humanFromSession, revokeHumanSession, linkAgent, unlinkAgent, linkedAgentIds, sessionCookie, readSessionCookie } from '../../apps/api/src/human-identity.js';
import { withEconomy } from '../../apps/api/src/persistence.js';

const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const reply=(statusCode,value,extraHeaders={})=>({statusCode,headers:{...headers,...extraHeaders},body:JSON.stringify(value)});
const parseBody=event=>{if(!event.body)return{};if(event.body.length>100000)throw new Error('payload too large');return JSON.parse(event.body)};
const requestPath=event=>{const raw=event.rawUrl?new URL(event.rawUrl).pathname:event.path||'/';return raw.replace(/^\/\.netlify\/functions\/human-auth/,'')||'/'};
async function requireHuman(event){const token=readSessionCookie(event.headers||{}),human=await humanFromSession(token);if(!human)throw Object.assign(new Error('authentication required'),{statusCode:401});return{human,token}}
function authAgent(economy,agentId,token){if(!economy.authenticate(agentId,token))throw Object.assign(new Error('agent credential proof failed'),{statusCode:403})}

export async function handler(event){
  try{
    if(event.httpMethod==='OPTIONS')return{statusCode:204,headers,body:''};
    const p=requestPath(event),method=event.httpMethod;
    if(method==='POST'&&p==='/human/auth/signup'){
      const data=parseBody(event),human=await createHuman(data),session=await createHumanSession(human.id);
      return reply(201,{human}, {'set-cookie':sessionCookie(session.token)});
    }
    if(method==='POST'&&p==='/human/auth/login'){
      const data=parseBody(event),human=await authenticateHuman(data.email,data.password),session=await createHumanSession(human.id);
      return reply(200,{human},{'set-cookie':sessionCookie(session.token)});
    }
    if(method==='POST'&&p==='/human/auth/logout'){
      const token=readSessionCookie(event.headers||{});await revokeHumanSession(token);
      return reply(200,{ok:true},{'set-cookie':sessionCookie('',{clear:true})});
    }
    if(method==='GET'&&p==='/human/me'){
      const {human}=await requireHuman(event),ids=await linkedAgentIds(human.id);
      const agents=await withEconomy(async economy=>ids.map(id=>economy.agents.get(id)).filter(Boolean).map(agent=>economy.publicAgent(agent)));
      return reply(200,{human,agents});
    }
    if(method==='POST'&&p==='/human/agents/link'){
      const {human}=await requireHuman(event),data=parseBody(event),agentId=String(data.agentId||'').trim(),agentToken=String(data.agentToken||'');
      if(!agentId||!agentToken)throw new Error('agentId and agentToken required');
      await withEconomy(async economy=>{const agent=economy.agents.get(agentId);if(!agent)throw new Error('agent not found');authAgent(economy,agentId,agentToken)});
      await linkAgent(human.id,agentId);
      return reply(201,{ok:true,agentId});
    }
    if(method==='DELETE'&&/^\/human\/agents\/[^/]+$/.test(p)){
      const {human}=await requireHuman(event),agentId=p.split('/')[3];await unlinkAgent(human.id,agentId);return reply(200,{ok:true,agentId});
    }
    return reply(404,{error:'not found'});
  }catch(error){return reply(error.statusCode||(/invalid email or password|authentication required/.test(error.message)?401:400),{error:error.message})}
}
