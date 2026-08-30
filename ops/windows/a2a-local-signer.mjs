import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { JsonRpcProvider, Wallet } from 'ethers';

const RPC = process.env.A2A402_BASE_MAINNET_RPC_URL || 'https://mainnet.base.org';
const PRIVATE_KEY = process.env.A2A402_LOCAL_PRIVATE_KEY;
const RPC_TOKEN = process.env.A2A402_SIGNER_RPC_TOKEN;
const EXPECTED_FROM = String(process.env.A2A402_SIGNER_FROM || '').toLowerCase();
const TOKEN = '0xF2bb6DC14E9097EC08F9Eaa9C6B7d39662195F01'.toLowerCase();
const PORT = Number(process.env.A2A402_SIGNER_PORT || 8547);
const MAX_TRANSFER = BigInt(process.env.A2A402_SIGNER_MAX_TRANSFER_UNITS || '10000000000000000000');
const DAILY_CAP = BigInt(process.env.A2A402_SIGNER_DAILY_CAP_UNITS || '20000000000000000000');
const STATE = path.resolve(process.env.A2A402_SIGNER_STATE_FILE || '.a2a402-signer-spend-state.json');
const TRANSFER_SELECTOR = 'a9059cbb';

if (!PRIVATE_KEY) throw new Error('A2A402_LOCAL_PRIVATE_KEY is required');
if (!RPC_TOKEN || RPC_TOKEN.length < 24) throw new Error('A2A402_SIGNER_RPC_TOKEN is required and must be strong');
if (!/^0x[a-f0-9]{40}$/.test(EXPECTED_FROM)) throw new Error('A2A402_SIGNER_FROM is required');

const provider = new JsonRpcProvider(RPC, 8453);
const wallet = new Wallet(PRIVATE_KEY, provider);
if (wallet.address.toLowerCase() !== EXPECTED_FROM) throw new Error('private key does not match A2A402_SIGNER_FROM');

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function utcDay() { return new Date().toISOString().slice(0, 10); }
function loadSpend() {
  try { const x = JSON.parse(fs.readFileSync(STATE, 'utf8')); return x.day === utcDay() ? x : {day:utcDay(),units:'0'}; }
  catch { return {day:utcDay(),units:'0'}; }
}
function saveSpend(x) {
  fs.mkdirSync(path.dirname(STATE), {recursive:true});
  const tmp = `${STATE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(x, null, 2));
  fs.renameSync(tmp, STATE);
}
function validateTransfer(tx) {
  if (!tx || String(tx.from || '').toLowerCase() !== EXPECTED_FROM) throw new Error('unexpected from address');
  if (String(tx.to || '').toLowerCase() !== TOKEN) throw new Error('only the A2A token contract is allowed');
  if (BigInt(tx.value || '0x0') !== 0n) throw new Error('native ETH transfers are forbidden');
  const data = String(tx.data || '').replace(/^0x/, '').toLowerCase();
  if (data.length !== 136 || data.slice(0,8) !== TRANSFER_SELECTOR) throw new Error('only ERC20 transfer(address,uint256) is allowed');
  const amount = BigInt(`0x${data.slice(72,136)}`);
  if (amount <= 0n || amount > MAX_TRANSFER) throw new Error('transfer exceeds signer per-transfer policy');
  const spend = loadSpend();
  if (BigInt(spend.units) + amount > DAILY_CAP) throw new Error('daily A2A signer cap exceeded');
  return {amount, spend};
}
function reply(res, id, result, error) {
  res.writeHead(200, {'content-type':'application/json'});
  res.end(JSON.stringify(error ? {jsonrpc:'2.0',id,error:{code:-32000,message:error}} : {jsonrpc:'2.0',id,result}));
}

const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    if (!safeEqual(req.headers.authorization || '', `Bearer ${RPC_TOKEN}`)) { res.writeHead(401); return res.end(JSON.stringify({error:'unauthorized'})); }
    let raw=''; for await (const chunk of req) { raw += chunk; if (raw.length > 100000) throw new Error('request too large'); }
    const body = JSON.parse(raw || '{}');
    if (body.method === 'eth_chainId') return reply(res, body.id, '0x2105');
    if (body.method === 'eth_getTransactionReceipt') return reply(res, body.id, await provider.send('eth_getTransactionReceipt', body.params || []));
    if (body.method !== 'eth_sendTransaction') throw new Error('RPC method not allowed');
    const tx = body.params?.[0];
    const {amount, spend} = validateTransfer(tx);
    const sent = await wallet.sendTransaction({to:tx.to,data:tx.data,value:0n});
    saveSpend({day:utcDay(),units:(BigInt(spend.units)+amount).toString(),lastTxHash:sent.hash,updatedAt:new Date().toISOString()});
    return reply(res, body.id, sent.hash);
  } catch (error) { return reply(res, null, null, error.message); }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`A2A402 hardened signer running for ${wallet.address}`);
  console.log(`RPC: http://127.0.0.1:${PORT}`);
});
