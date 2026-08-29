import http from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { Economy } from './economy.js';
import { registerSeeds } from './seed.js';

export const economy = new Economy({loungeEnabled:process.env.A2A402_ENABLE_LOUNGE!=='false'}); registerSeeds(economy);
const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json','access-control-allow-origin':'*'});res.end(JSON.stringify(body));};
const auth=(req)=>{const agentId=req.headers['x-agent-id'];const h=req.headers.authorization||'';const token=h.startsWith('Bearer ')?h.slice(7):'';if(!economy.authenticate(agentId,token))throw new Error('unauthorized');return agentId;};
const body=async req=>{let raw='';for await(const c of req){raw+=c;if(raw.length>1_000_000)throw new Error('payload too large');}return raw?JSON.parse(raw):{};};
const safe=(fn)=>async(req,res)=>{try{await fn(req,res);}catch(e){json(res,400,{error:e.message});}};
export function createServer(){return http.createServer(safe(async(req,res)=>{
  const u=new URL(req.url,'http://localhost'); const p=u.pathname; const m=req.method; const b=()=>body(req);
  if(m==='GET'&&p==='/health') return json(res,200,{status:'ok',environment:'test',realMoney:false});
  if(m==='GET'&&p==='/economy/stats') return json(res,200,economy.stats());
  if(m==='GET'&&p==='/economy/activity') return json(res,200,economy.activity());
  if(m==='GET'&&p==='/economy/graph') return json(res,200,economy.graph());
  if(m==='GET'&&p==='/agents/search') return json(res,200,economy.searchAgents({requiredCapability:u.searchParams.get('capability')||'',maxPrice:u.searchParams.get('maxPrice')||Infinity,minimumReputation:Number(u.searchParams.get('minimumReputation')||0)}));
  if(m==='POST'&&p==='/agents/register'){const a=economy.registerAgent(await b());return json(res,201,{agent:economy.publicAgent(a),authToken:a._registrationToken});}
  if(m==='GET'&&/^\/agents\/[^/]+$/.test(p)){const a=economy.agents.get(p.split('/')[2]);return a?json(res,200,economy.publicAgent(a)):json(res,404,{error:'not found'});}
  if(m==='POST'&&p==='/jobs'){const agentId=auth(req);const x=await b();return json(res,201,economy.createJob({...x,creatorId:agentId,creatorType:'agent'}));}
  if(m==='GET'&&p==='/jobs') return json(res,200,[...economy.jobs.values()]);
  if(m==='GET'&&/^\/jobs\/[^/]+$/.test(p)){const j=economy.jobs.get(p.split('/')[2]);return j?json(res,200,j):json(res,404,{error:'not found'});}
  if(m==='POST'&&/\/jobs\/[^/]+\/claim$/.test(p)){const agentId=auth(req);return json(res,200,economy.claimJob(p.split('/')[2],agentId));}
  if(m==='POST'&&/\/jobs\/[^/]+\/submit$/.test(p)){const agentId=auth(req);const x=await b();return json(res,200,economy.submitJob(p.split('/')[2],agentId,x.result));}
  if(m==='POST'&&/\/jobs\/[^/]+\/verify$/.test(p)){const agentId=auth(req);const x=await b();return json(res,200,await economy.verifyJob(p.split('/')[2],agentId,{accepted:x.accepted!==false}));}
  if(m==='POST'&&/\/jobs\/[^/]+\/cancel$/.test(p)){const agentId=auth(req);return json(res,200,economy.cancelJob(p.split('/')[2],agentId));}
  if(m==='GET'&&p==='/services') return json(res,200,[...economy.services.values()]);
  if(m==='POST'&&p==='/services'){const agentId=auth(req);const x=await b();return json(res,201,economy.createService({...x,ownerAgentId:agentId}));}
  if(m==='GET'&&/^\/reputation\/[^/]+$/.test(p)){const r=economy.reputations.get(p.split('/')[2]);return r?json(res,200,r):json(res,404,{error:'not found'});}
  if(m==='POST'&&p==='/lounge/messages'){const agentId=auth(req);const x=await b();return json(res,201,economy.postLoungeMessage({...x,agentId}));}
  if(m==='GET'&&p==='/lounge/messages') return json(res,200,economy.lounge);
  if(m==='GET'&&p==='/.well-known/agent-card.json') return json(res,200,economy.getAgentCard('agent_10',`${u.protocol}//${req.headers.host}`));
  if(m==='POST'&&p==='/a2a'){const x=await b(); if(x.method==='tasks/list') return json(res,200,{jsonrpc:'2.0',id:x.id,result:[...economy.jobs.values()]}); if(x.method==='message/send') return json(res,200,{jsonrpc:'2.0',id:x.id,result:{accepted:true}}); return json(res,400,{jsonrpc:'2.0',id:x.id,error:{code:-32601,message:'Method not found'}});}
  if(m==='GET'&&(p==='/'||p==='/index.html')){const html=fs.readFileSync(path.resolve('apps/dashboard/public/index.html'));res.writeHead(200,{'content-type':'text/html'});return res.end(html);}
  json(res,404,{error:'not found'});
}));}
if(import.meta.url===`file://${process.argv[1]}`){createServer().listen(Number(process.env.PORT||3000),()=>console.log(`A2A402 v0.1 listening on ${process.env.PORT||3000}`));}
