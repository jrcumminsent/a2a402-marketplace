import test from 'node:test';
import assert from 'node:assert/strict';
import { createHuman, authenticateHuman, createHumanSession, humanFromSession, revokeHumanSession, linkAgent, unlinkAgent, linkedAgentIds, validateHumanInput } from '../apps/api/src/human-identity.js';

const uniq=()=>Date.now().toString(36)+Math.random().toString(36).slice(2);

test('human signup, password auth and session lifecycle',async()=>{
  const key=uniq(),email=`human-${key}@example.test`,password='correct horse battery staple';
  const human=await createHuman({email,password,displayName:'Vault Operator'});
  assert.equal(human.email,email);
  assert.equal(human.displayName,'Vault Operator');
  const authed=await authenticateHuman(email,password);
  assert.equal(authed.id,human.id);
  await assert.rejects(()=>authenticateHuman(email,'wrong password'),/invalid email or password/);
  const session=await createHumanSession(human.id);
  assert.equal((await humanFromSession(session.token)).id,human.id);
  await revokeHumanSession(session.token);
  assert.equal(await humanFromSession(session.token),null);
});

test('human identity validates email password and display name',()=>{
  assert.throws(()=>validateHumanInput({email:'bad',password:'0123456789',displayName:'Valid Name'},{requireDisplayName:true}),/valid email/);
  assert.throws(()=>validateHumanInput({email:'good@example.test',password:'short',displayName:'Valid Name'},{requireDisplayName:true}),/at least 10/);
  assert.throws(()=>validateHumanInput({email:'good@example.test',password:'0123456789',displayName:'x'},{requireDisplayName:true}),/2-60/);
});

test('one human may link many agents but one agent has one human owner',async()=>{
  const key=uniq();
  const h1=await createHuman({email:`owner1-${key}@example.test`,password:'0123456789AA',displayName:'Owner One'});
  const h2=await createHuman({email:`owner2-${key}@example.test`,password:'0123456789BB',displayName:'Owner Two'});
  const a1='agent_test_'+key+'_1',a2='agent_test_'+key+'_2';
  await linkAgent(h1.id,a1);
  await linkAgent(h1.id,a2);
  assert.deepEqual(new Set(await linkedAgentIds(h1.id)),new Set([a1,a2]));
  await assert.rejects(()=>linkAgent(h2.id,a1),/already linked to another human/);
  await unlinkAgent(h1.id,a1);
  assert.deepEqual(await linkedAgentIds(h1.id),[a2]);
  await linkAgent(h2.id,a1);
  assert.deepEqual(await linkedAgentIds(h2.id),[a1]);
});
