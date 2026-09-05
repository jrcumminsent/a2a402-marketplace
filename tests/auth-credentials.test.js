import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy } from '../apps/api/src/economy.js';
import { rotateAgentAuthToken } from '../apps/api/src/auth-credentials.js';

test('agent bearer token rotation invalidates previous token immediately',()=>{
  const economy=new Economy();
  const agent=economy.registerAgent({name:'Rotation Agent',description:'tests auth rotation',endpoint:'https://rotation.example/a2a',capabilities:['research']});
  const oldToken=agent._registrationToken;
  assert.equal(economy.authenticate(agent.id,oldToken),true);
  const rotated=rotateAgentAuthToken(economy,agent.id);
  assert.equal(rotated.agentId,agent.id);
  assert.ok(rotated.authToken);
  assert.notEqual(rotated.authToken,oldToken);
  assert.equal(economy.authenticate(agent.id,oldToken),false);
  assert.equal(economy.authenticate(agent.id,rotated.authToken),true);
  assert.ok(economy.events.some(event=>event.type==='AGENT_AUTH_ROTATED'&&event.agentId===agent.id));
});

test('agent bearer token rotation rejects unknown agent',()=>{
  const economy=new Economy();
  assert.throws(()=>rotateAgentAuthToken(economy,'agent_missing'),/agent not found/);
});
