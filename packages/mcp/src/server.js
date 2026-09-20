#!/usr/bin/env node
const BASE=(process.env.A2A402_BASE_URL||'https://a2a402.market').replace(/\/$/,'');
const AGENT_ID=process.env.A2A402_AGENT_ID||'';
const TOKEN=process.env.A2A402_AUTH_TOKEN||'';

const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const fail=(id,error)=>send({jsonrpc:'2.0',id,error:{code:-32000,message:error?.message||String(error)}});

async function request(path,{method='GET',body,auth=false}={}){
  const headers={accept:'application/json'};
  if(body!==undefined)headers['content-type']='application/json';
  if(auth){
    if(!AGENT_ID||!TOKEN)throw new Error('A2A402_AGENT_ID and A2A402_AUTH_TOKEN are required for authenticated actions');
    headers.authorization=`Bearer ${TOKEN}`;
    headers['x-agent-id']=AGENT_ID;
  }
  const res=await fetch(BASE+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const text=await res.text();
  let data=text;
  try{data=text?JSON.parse(text):null}catch{}
  if(!res.ok){
    const message=typeof data?.error==='object'?data.error.message:(data?.error||`HTTP ${res.status}`);
    throw new Error(String(message));
  }
  return data;
}

const tools=[
  {
    name:'a2a402_need',
    description:'Route a capability need through A2A402. Creates a real marketplace job unless preview=true.',
    inputSchema:{
      type:'object',
      required:['capability','need','budget'],
      properties:{
        capability:{type:'string'},
        need:{type:'string'},
        budget:{type:'number',minimum:0},
        paymentAsset:{type:'string',enum:['USDC','A2A'],description:'USDC is primary. A2A is secondary and Base-only.'},
        paymentNetwork:{type:'string',enum:['base','ethereum','arbitrum','optimism','polygon'],description:'Optional USDC network. Omit to negotiate from declared wallets.'},
        preview:{type:'boolean'},
        minimumReputation:{type:'number'},
        acceptanceCriteria:{type:'array',items:{type:'string'}}
      }
    }
  },
  {
    name:'a2a402_find_providers',
    description:'Find public A2A402 providers by capability, price and reputation.',
    inputSchema:{type:'object',properties:{capability:{type:'string'},maxPrice:{type:'number'},minimumReputation:{type:'number'}}}
  },
  {
    name:'a2a402_jobs',
    description:'List genuine public marketplace jobs.',
    inputSchema:{type:'object',properties:{status:{type:'string'},capability:{type:'string'},paymentAsset:{type:'string'},paymentNetwork:{type:'string'}}}
  },
  {
    name:'a2a402_reputation',
    description:'Read an agent economic reputation record.',
    inputSchema:{type:'object',required:['agentId'],properties:{agentId:{type:'string'}}}
  },
  {
    name:'a2a402_payment_capabilities',
    description:'Read supported settlement assets, networks, contracts and payment capabilities.',
    inputSchema:{type:'object',properties:{}}
  }
];

function qs(input={}){
  const p=new URLSearchParams();
  for(const [k,v] of Object.entries(input))if(v!==undefined&&v!==null&&v!=='')p.set(k,String(v));
  return p.toString();
}

async function call(name,args={}){
  if(name==='a2a402_need')return request('/need',{method:'POST',body:args,auth:true});
  if(name==='a2a402_find_providers'){
    const q=qs(args);
    return request('/agents/search'+(q?'?'+q:''));
  }
  if(name==='a2a402_jobs'){
    const q=qs(args);
    return request('/jobs'+(q?'?'+q:''));
  }
  if(name==='a2a402_reputation')return request('/reputation/'+encodeURIComponent(args.agentId));
  if(name==='a2a402_payment_capabilities')return request('/payments/capabilities');
  throw new Error('Unknown tool: '+name);
}

let buffer='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',async chunk=>{
  buffer+=chunk;
  let i;
  while((i=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,i).trim();
    buffer=buffer.slice(i+1);
    if(!line)continue;
    let m;
    try{m=JSON.parse(line)}catch{continue}
    try{
      if(m.method==='initialize'){
        send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params?.protocolVersion||'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'a2a402-mcp',version:'0.1.0'}}});
      }else if(m.method==='notifications/initialized'){
        // notification; no response
      }else if(m.method==='tools/list'){
        send({jsonrpc:'2.0',id:m.id,result:{tools}});
      }else if(m.method==='tools/call'){
        const result=await call(m.params?.name,m.params?.arguments||{});
        send({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:JSON.stringify(result,null,2)}],structuredContent:result}});
      }else if(m.id!==undefined){
        send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}});
      }
    }catch(e){
      if(m.id!==undefined)fail(m.id,e);
    }
  }
});
