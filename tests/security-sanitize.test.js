import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSecretString, deepRedactSecrets, containsLikelySecret } from '../apps/api/src/security-sanitize.js';

test('redacts credential-bearing connection URIs',()=>{
  const input='worker endpoint postgresql://dbuser:super-secret@example.invalid:6543/app?sslmode=require';
  const output=redactSecretString(input);
  assert.equal(output.includes('super-secret'),false);
  assert.equal(output.includes('[REDACTED]'),true);
});

test('deep redaction removes explicit secret fields and bearer tokens',()=>{
  const output=deepRedactSecrets({password:'dont-store-me',nested:{authorization:'Bearer abcdefghijklmnopqrstuvwxyz0123456789'}});
  assert.equal(output.password,'[REDACTED]');
  assert.equal(JSON.stringify(output).includes('dont-store-me'),false);
  assert.equal(JSON.stringify(output).includes('abcdefghijklmnopqrstuvwxyz0123456789'),false);
});

test('detects likely secrets before persistence',()=>{
  assert.equal(containsLikelySecret({result:'postgres://user:password@example.invalid/db'}),true);
  assert.equal(containsLikelySecret({result:'https://example.invalid/public-artifact.json'}),false);
});
