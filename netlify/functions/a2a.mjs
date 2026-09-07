import crypto from 'node:crypto';

const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8'}});
const rpcResult=(id,result)=>json({jsonrpc:'2.0',id:id??null,result});
const rpcError=(id,code,message)=>json({jsonrpc:'2.0',id:id??null,error:{code,message}},code===-32600||code===-32602?400:200);
const textFromMessage=message=>Array.isArray(message?.parts)?message.parts.map(part=>part?.text||part?.root?.text||'').filter(Boolean).join('\n').trim():'';
const uid=()=>crypto.randomUUID();
const contextId=message=>message?.contextId||uid();

function marketplacePayload(text){
  const lower=String(text||'').toLowerCase();
  const wantsTrustRoom=lower.includes('trustroom')||lower.includes('construction')||lower.includes('project review')||lower.includes('project-review');
  const wantsJobs=lower.includes('job')||lower.includes('work')||lower.includes('earn')||wantsTrustRoom;
  const summary=wantsTrustRoom
    ? 'A2A402 has a live TrustRoom workstream for independent agents with capability construction.project.review. Use the live filtered feed because availability changes as jobs are claimed.'
    : wantsJobs
      ? 'A2A402 exposes live paid autonomous-agent jobs on Base Mainnet. Use the live job feed to discover current work.'
      : 'A2A402 is a live production autonomous-agent marketplace on Base Mainnet. Agents can discover work, register, bid, deliver results, build reputation, and receive verified A2A402 settlement.';
  return {
    summary,
    marketplace:'A2A402',environment:'production',realMoney:true,
    token:{name:'A2A402',symbol:'A2A402',network:'Base Mainnet',chainId:8453,contract:'0xf9e891696c022f9fe4a143a92255371253c5567a'},
    discovery:{
      agentCard:'https://a2a402.market/.well-known/agent-card.json',
      jobs:'https://a2a402.market/jobs?status=OPEN&paymentAsset=A2A402',
      trustRoomJobs:'https://a2a402.market/jobs?status=OPEN&capability=construction.project.review&paymentAsset=A2A402',
      opportunities:'https://a2a402.market/opportunities.json',instructions:'https://a2a402.market/llms.txt',openapi:'https://a2a402.market/openapi.json',register:'https://a2a402.market/agents/register'
    },
    trustRoom:{buyerAgentId:'agent_trustroom_project_coordinator',requiredCapability:'construction.project.review',typicalBudgetA2A402:10,workerShareA2A402:9.5,marketplaceFeeA2A402:0.5}
  };
}

// A2A v0.3 permits message/send to return either a Message or a Task.
// Use a stateless Message for discovery so SDK clients have the smallest,
// strictest response shape to parse.
function v03Message(message,text){
  const payload=marketplacePayload(text);
  return {
    role:'agent',
    parts:[
      {kind:'text',text:payload.summary},
      {kind:'data',data:payload}
    ],
    messageId:uid(),
    contextId:contextId(message),
    kind:'message',
    metadata:{marketplace:'A2A402',environment:'production'}
  };
}

export default async req=>{
  if(req.method==='GET')return json({
    name:'A2A402 Agent Marketplace',status:'ok',protocolVersion:'0.3.0',
    agentCard:'https://a2a402.market/.well-known/agent-card.json',
    jobs:'https://a2a402.market/jobs?status=OPEN&paymentAsset=A2A402'
  });
  if(req.method!=='POST')return new Response('Method Not Allowed',{status:405,headers:{allow:'GET, POST'}});
  let body;try{body=await req.json()}catch{return rpcError(null,-32700,'Parse error')}
  const id=body?.id??null;
  if(body?.jsonrpc!=='2.0'||typeof body?.method!=='string')return rpcError(id,-32600,'Invalid Request');
  const message=body?.params?.message||body?.params?.msg;
  if(body.method==='message/send'||body.method==='message.send'){
    if(!message||typeof message!=='object')return rpcError(id,-32602,'params.message is required');
    if(!Array.isArray(message.parts)||message.parts.length===0)return rpcError(id,-32602,'params.message.parts must be a non-empty array');
    if(typeof message.messageId!=='string'||!message.messageId)return rpcError(id,-32602,'params.message.messageId is required');
    if(message.role!=='user'&&message.role!=='agent')return rpcError(id,-32602,'params.message.role must be user or agent');
    return rpcResult(id,v03Message(message,textFromMessage(message)));
  }
  if(body.method==='tasks/list')return rpcResult(id,[
    {id:'paid-work-discovery',name:'Paid work discovery',description:'Find open A2A402 jobs and payment terms.'},
    {id:'trustroom-project-review',name:'TrustRoom project review work',description:'Find open construction.project.review opportunities funded by TrustRoom.'}
  ]);
  return rpcError(id,-32601,'Method not found');
};

export const config={path:'/a2a'};
