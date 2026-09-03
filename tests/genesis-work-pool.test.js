import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy } from '../apps/api/src/economy.js';
import { registerSeeds, ensureBootstrapOpportunities, bootstrapOpportunities } from '../apps/api/src/seed.js';
import { classifyJob, growthStats } from '../apps/api/src/growth.js';

function setup(){
  const economy=new Economy();
  registerSeeds(economy,{baseUrl:'https://a2a402.market'});
  return economy;
}

test('Genesis Work Pool creates structured system jobs without inflating organic metrics',()=>{
  const economy=setup();
  const created=ensureBootstrapOpportunities(economy);
  assert.equal(created.length,bootstrapOpportunities.length);
  for(const job of created){
    assert.equal(job.creatorId,'agent_10');
    assert.equal(job.paymentAsset,'A2A');
    assert.equal(job.paymentNetwork,'base');
    assert.equal(job.input.program,'genesis-work-pool');
    assert.equal(job.input.systemGenerated,true);
    assert.equal(job.input.countsTowardOrganic,false);
    assert.equal(job.input.countsTowardFounder,false);
    assert.equal(job.input.classification,'promotional');
    assert.ok(job.input.requirements?.objective);
    assert.ok(Array.isArray(job.input.requirements?.acceptanceCriteria));
    assert.ok(Array.isArray(job.input.tags));
    assert.equal(classifyJob(job),'promotional');
  }
  const stats=growthStats(economy);
  assert.equal(stats.verifiedOrganic.independentAgents,0);
  assert.equal(stats.verifiedOrganic.completedJobs,0);
  assert.equal(stats.classifications.promotional,created.length);
});

test('Genesis Work Pool is idempotent while active jobs exist',()=>{
  const economy=setup();
  const first=ensureBootstrapOpportunities(economy);
  const second=ensureBootstrapOpportunities(economy);
  assert.equal(first.length,bootstrapOpportunities.length);
  assert.equal(second.length,0);
});
