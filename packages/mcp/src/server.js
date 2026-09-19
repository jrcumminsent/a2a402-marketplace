#!/usr/bin/env node
import { A2A402Client } from '../sdk/src/index.js';

const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const fail=(id,error)=>send({jsonrpc:'2.0',id,error:{code:-32000,message:error.message||String(error)}});
const client=new A2A402Client({
  baseUrl:process.env.A2A402_BASE_URL||'https://a2a402.market',
  agentId:process.env.A2A402_AGENT_ID||null,
  authToken:process.env.A2A402_AUTH_TOKEN||null
});

const tools=[
 {name:'a2a402_need',description:'Route a capability need through A2A402. Creates a marketplace job unless preview=true.',inputSchema:{type:'object',required:['capability','need','budget'],properties:{capability:{type:'string'},need:{type:'string'},budget:{type:'number'},paymentAsset:{type:'string',enum:['USDC','A2A402']},preview:{type:'boolean'},minimumReputation:{type:'number'},acceptanceCriteria:{type:'array',items:{type:'string'}}}}},
 {name:'a2a402_find_providers',description:'Find A2A402 providers by capability, price and reputation.',inputSchema:{type:'object',properties:{capability:{type:'string'},maxPrice:{type:'number'},minimumReputation:{type:'number'}}}},
 {name:'a2a402_jobs',description:'List marketplace jobs.',inputSchema:{type:'object',properties:{status:{type:'string'},capability:{type:'string'},paymentAsset:{type:'string'}}}},
 {name:'a2a402_reputation',description:'Read an agent economic reputation record.',inputSchema:{type:'object',required:['agentId'],properties:{agentId:{type:'string'}}}},
 {name:'a2a402_payment_capabilities',description:'Read supported settlement assets and payment capabilities.',inputSchema:{type:'object',properties:{}}}
];

async function call(name,args){
 if(name==='a2a402_need')return client.need(args);
 if(name==='a2a402_find_providers')return client.findProviders(args);
 if(name==='a2a402_jobs')return client.jobs(args);
 if(name==='a2a402_reputation')return client.reputation(args.agentId);
 if(name==='a2a402_payment_capabilities')return client.paymentCapabilities();
 throw new Error('Unknown tool: '+name);
}

let buffer='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',async chunk=>{
 buffer+=chunk;
 let i;
 while((i=buffer.indexOf('\n'))>=0){
  const line=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);
  if(!line)continue;
  let m;try{m=JSON.parse(line)}catch{continue}
  try{
   if(m.method==='initialize')send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params?.protocolVersion||'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'a2a402-mcp',version:'0.1.0'}}});
   else if(m.method==='notifications/initialized'){}
   else if(m.method==='tools/list')send({jsonrpc:'2.0',id:m.id,result:{tools}});
   else if(m.method==='tools/call'){const result=await call(m.params?.name,m.params?.arguments||{});send({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:JSON.stringify(result,null,2)}],structuredContent:result}})}
   else if(m.id!==undefined)send({jsonrpc:'2.0',id:m.id,result:{}});
  }catch(e){if(m.id!==undefined)fail(m.id,e)}
 }
});
