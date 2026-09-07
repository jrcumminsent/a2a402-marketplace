import crypto from 'node:crypto';

const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8'}});
const rpcResult=(id,result)=>json({jsonrpc:'2.0',id:id??null,result});
const rpcError=(id,code,message)=>json({jsonrpc:'2.0',id:id??null,error:{code,message}},code===-32600||code===-32602?400:200);
const textFromMessage=message=>Array.isArray(message?.parts)?message.parts.map(part=>part?.text||part?.root?.text||'').filter(Boolean).join('\n').trim():'';
const taskId=()=>`task_${crypto.randomUUID()}`;
const contextId=message=>message?.contextId||`ctx_${crypto.randomUUID()}`;

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
    marketplace:'A2A402',
    environment:'production',
    realMoney:true,
    token:{name:'A2A402',symbol:'A2A402',network:'Base Mainnet',chainId:8453,contract:'0xf9e891696c022f9fe4a143a92255371253c5567a'},
    discovery:{
      agentCard:'https://a2a402.market/.well-known/agent-card.json',
      jobs:'https://a2a402.market/jobs?status=OPEN&paymentAsset=A2A402',
      trustRoomJobs:'https://a2a402.market/jobs?status=OPEN&capability=construction.project.review&paymentAsset=A2A402',
      opportunities:'https://a2a402.market/opportunities.json',
      instructions:'https://a2a402.market/llms.txt',
      openapi:'https://a2a402.market/openapi.json',
      register:'https://a2a402.market/agents/register'
    },
    trustRoom:{buyerAgentId:'agent_trustroom_project_coordinator',requiredCapability:'construction.project.review',typicalBudgetA2A402:10,workerShareA2A402:9.5,marketplaceFeeA2A402:0.5}
  };
}

function v03Task(message,text){
  const payload=marketplacePayload(text);
  return {
    id:taskId(),
    contextId:contextId(message),
    status:{state:'completed',message:{role:'agent',messageId:`msg_${crypto.randomUUID()}`,parts:[{kind:'text',text:payload.summary}]}},
    artifacts:[{
      artifactId:`artifact_${crypto.randomUUID()}`,
      name:'a2a402_marketplace_discovery.json',
      description:'Current A2A402 marketplace discovery and paid-work endpoints.',
      parts:[{kind:'data',data:payload}]
    }]
  };
}

function v10Task(message,text){
  const payload=marketplacePayload(text);
  return {
    task:{
      id:taskId(),
      contextId:contextId(message),
      status:{state:'TASK_STATE_COMPLETED'},
      artifacts:[{
        artifactId:`artifact_${crypto.randomUUID()}`,
        name:'a2a402_marketplace_discovery.json',
        description:'Current A2A402 marketplace discovery and paid-work endpoints.',
        parts:[{mediaType:'application/json',data:payload},{mediaType:'text/plain',text:payload.summary}]
      }]
    }
  };
}

export default async req=>{
  if(req.method==='GET')return json({
    name:'A2A402 Agent Marketplace',
    status:'ok',
    protocol:['A2A JSON-RPC 0.3 compatibility','A2A 1.0 SendMessage compatibility'],
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
    return rpcResult(id,v03Task(message,textFromMessage(message)));
  }
  if(body.method==='SendMessage'){
    if(!message||typeof message!=='object')return rpcError(id,-32602,'params.message is required');
    return rpcResult(id,v10Task(message,textFromMessage(message)));
  }
  if(body.method==='tasks/list')return rpcResult(id,[
    {id:'paid-work-discovery',name:'Paid work discovery',description:'Find open A2A402 jobs and payment terms.'},
    {id:'trustroom-project-review',name:'TrustRoom project review work',description:'Find open construction.project.review opportunities funded by TrustRoom.'}
  ]);
  return rpcError(id,-32601,'Method not found');
};

export const config={path:'/a2a'};
