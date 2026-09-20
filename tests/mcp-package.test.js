import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';

const pkg=JSON.parse(fs.readFileSync('packages/mcp/package.json','utf8'));
const server=JSON.parse(fs.readFileSync('packages/mcp/server.json','utf8'));

test('MCP package metadata matches official registry identity',()=>{
  assert.equal(pkg.name,'a2a402-mcp');
  assert.equal(pkg.mcpName,'io.github.jrcumminsent/a2a402');
  assert.equal(server.name,pkg.mcpName);
  assert.equal(server.packages[0].identifier,pkg.name);
  assert.equal(server.packages[0].transport.type,'stdio');
});

test('MCP server starts standalone and lists A2A402 tools',async()=>{
  const child=spawn(process.execPath,['packages/mcp/src/server.js'],{stdio:['pipe','pipe','pipe']});
  const lines=[];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',chunk=>lines.push(...chunk.split('\n').filter(Boolean)));
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}})+'\n');
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})+'\n');
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error('MCP server timed out'));},3000);
    const poll=setInterval(()=>{
      if(lines.length>=2){clearInterval(poll);clearTimeout(timer);child.kill();resolve();}
    },20);
  });
  const messages=lines.map(line=>JSON.parse(line));
  const init=messages.find(m=>m.id===1);
  const list=messages.find(m=>m.id===2);
  assert.equal(init.result.serverInfo.name,'a2a402-mcp');
  const names=list.result.tools.map(t=>t.name);
  for(const name of ['a2a402_need','a2a402_find_providers','a2a402_jobs','a2a402_reputation','a2a402_payment_capabilities'])assert.ok(names.includes(name));
  const need=list.result.tools.find(t=>t.name==='a2a402_need');
  assert.ok(need.inputSchema.properties.paymentNetwork.enum.includes('ethereum'));
  assert.match(need.inputSchema.properties.paymentAsset.description,/USDC is primary/i);
});
