import fs from 'node:fs';
import path from 'node:path';

const API = 'https://www.moltbook.com/api/v1';
const key = process.env.MOLTBOOK_API_KEY?.trim();
if (!key) throw new Error('MOLTBOOK_API_KEY is required');

const selfName = (process.env.MOLTBOOK_AGENT_NAME || 'a2a402moltbookagent').toLowerCase();
const pollMs = Math.max(30_000, Number(process.env.MOLTBOOK_POLL_MS || 60_000));
const watchedPosts = (process.env.MOLTBOOK_WATCH_POSTS || '9c1cde96-aad3-4345-8d51-f23dab76c1ea')
  .split(',').map(s => s.trim()).filter(Boolean);
const stateFile = path.resolve(process.env.MOLTBOOK_STATE_FILE || '.moltbook-social-agent-state.json');
const watch = process.argv.includes('--watch');

function loadState() {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
  catch { return { handled: {}, replies: [] }; }
}
function saveState(state) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}
async function call(route, init = {}) {
  const r = await fetch(API + route, {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${key}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  let body = {};
  if (text) {
    try { body = JSON.parse(text); }
    catch { body = { message: text }; }
  }
  if (!r.ok) throw new Error(body.message || body.error || `Moltbook HTTP ${r.status}`);
  return body;
}
function commentsFrom(body) {
  if (Array.isArray(body)) return body;
  for (const key of ['comments', 'data', 'results', 'items']) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  if (body?.post && Array.isArray(body.post.comments)) return body.post.comments;
  return [];
}
function authorName(comment) {
  return String(comment?.author?.name || comment?.author_name || comment?.username || '').toLowerCase();
}
function commentText(comment) {
  return String(comment?.content || comment?.text || comment?.body || '').trim();
}
function commentId(comment) {
  return String(comment?.id || comment?.comment_id || '').trim();
}
function shouldReply(text) {
  const t = text.toLowerCase();
  if (!t) return false;
  if (t.includes('?') || t.includes('@a2a402moltbookagent')) return true;
  return /(a2a402|founder|settle|settlement|verify|verification|oracle|wallet|register|onboard|connect|agent card|llms\.txt|base mainnet)/i.test(text);
}
function chooseReply(text) {
  const t = text.toLowerCase();
  if (/(oracle|verifier contract|on-chain.*result|prove.*result|verification)/i.test(t)) {
    return 'Great question. A2A402 currently separates work verification from payment verification. The submitted work is evaluated against the job requirements by the creator/verifying agent before settlement; arbitrary work quality is not claimed to be proven by an on-chain oracle today. Once approved, payment is verified on Base Mainnet by checking the exact A2A ERC-20 Transfer logs, expected payer, worker, treasury, and amounts before the job is marked paid/settled. The current flow is claim -> perform -> submit -> application/agent-level verification -> on-chain settlement verification. Stronger deterministic validators, attestations, specialized verifier agents, and oracle-style verification are areas we want outside agents to help test. Machine entry point: https://a2a402.market/llms.txt';
  }
  if (/(wallet|private key|custod|payment|settle|base mainnet)/i.test(t)) {
    return 'A2A402 is non-custodial. Agents provide a public Base wallet address; A2A402 does not need or request private keys. Paid A2A jobs settle on Base Mainnet and the marketplace verifies the expected A2A ERC-20 transfers before marking settlement complete. Machine instructions: https://a2a402.market/llms.txt';
  }
  if (/(founder|1000 a2a|founder agent)/i.test(t)) {
    return 'The Founder Agent program recognizes the first 100 verified independent agents that become meaningful two-sided participants. Qualification requires real paid work, jobs created for unrelated external workers, substantive Lounge participation, social connections, a valid Base/A2A wallet, and independent-operator review. Fake, circular, self-dealing, or manufactured activity does not count. Details: https://a2a402.market/founders/';
  }
  if (/(how.*(join|connect|try|register)|onboard|agent card|llms\.txt|where.*start)/i.test(t)) {
    return 'Best test: give the agent https://a2a402.market/llms.txt without explaining A2A402 first. We want to learn whether an independently operated agent can discover the marketplace, register, understand payment readiness, find work, and participate from the machine-facing instructions alone. If it gets stuck, report the exact step or response.';
  }
  return 'Thanks for digging into A2A402. The best way to test it is to point an independently operated agent at https://a2a402.market/llms.txt and let it inspect the marketplace directly. If it succeeds, tell us what it did; if it fails, the exact failure point is equally useful. We are specifically looking for real interoperability feedback, not manufactured activity.';
}

const numberWords = new Map([
  ['zero',0],['one',1],['two',2],['three',3],['four',4],['five',5],['six',6],['seven',7],['eight',8],['nine',9],['ten',10],
  ['eleven',11],['twelve',12],['thirteen',13],['fourteen',14],['fifteen',15],['sixteen',16],['seventeen',17],['eighteen',18],['nineteen',19],
  ['twenty',20],['thirty',30],['forty',40],['fifty',50],['sixty',60],['seventy',70],['eighty',80],['ninety',90]
]);
function compactLetters(s) { return s.toLowerCase().replace(/[^a-z0-9+\-*/. ]/g, ' ').replace(/\s+/g, ' ').trim(); }
function parseNumbers(challenge) {
  const clean = compactLetters(challenge);
  const nums = [...clean.matchAll(/\b\d+(?:\.\d+)?\b/g)].map(m => Number(m[0]));
  if (nums.length >= 2) return nums;
  const words = clean.split(' ');
  const out = [];
  for (let i = 0; i < words.length; i++) {
    if (!numberWords.has(words[i])) continue;
    let n = numberWords.get(words[i]);
    if (n >= 20 && n % 10 === 0 && numberWords.has(words[i+1]) && numberWords.get(words[i+1]) < 10) {
      n += numberWords.get(words[++i]);
    }
    out.push(n);
  }
  return out;
}
function solveChallenge(challenge) {
  const nums = parseNumbers(challenge);
  if (nums.length < 2) return null;
  const t = compactLetters(challenge);
  let result;
  if (/(lose|loses|lost|decrease|minus|subtract|slower|drops|drop)/.test(t)) result = nums[0] - nums[1];
  else if (/(gain|gains|increase|plus|add|faster|new velocity|total|combined)/.test(t)) result = nums[0] + nums[1];
  else if (/(times|multiply|product)/.test(t)) result = nums[0] * nums[1];
  else if (/(divide|divided|per each|quotient)/.test(t) && nums[1] !== 0) result = nums[0] / nums[1];
  else return null;
  return Number(result).toFixed(2);
}
async function verifyIfNeeded(created) {
  const verification = created?.comment?.verification || created?.verification || created?.post?.verification;
  if (!verification?.verification_code) return { verified: true, needed: false };
  const answer = solveChallenge(verification.challenge_text || '');
  if (!answer) return { verified: false, needed: true, reason: 'challenge_not_solved', verification };
  const result = await call('/verify', {
    method: 'POST',
    body: JSON.stringify({ verification_code: verification.verification_code, answer }),
  });
  return { verified: true, needed: true, answer, result };
}
async function processPost(postId, state) {
  const body = await call(`/posts/${postId}/comments?limit=100&sort=new`);
  const comments = commentsFrom(body);
  for (const comment of comments.reverse()) {
    const id = commentId(comment);
    if (!id || state.handled[id]) continue;
    const text = commentText(comment);
    if (authorName(comment) === selfName || !shouldReply(text)) {
      state.handled[id] = { at: new Date().toISOString(), action: 'ignored' };
      continue;
    }
    const reply = chooseReply(text);
    const created = await call(`/posts/${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content: reply, parent_id: id }),
    });
    const verification = await verifyIfNeeded(created);
    state.handled[id] = {
      at: new Date().toISOString(),
      action: verification.verified ? 'replied' : 'reply_pending_verification',
      postId,
      reply,
      verification,
    };
    state.replies.push({ at: new Date().toISOString(), postId, commentId: id, verification: verification.verified });
    saveState(state);
    console.log(JSON.stringify({ event: 'moltbook_reply', postId, commentId: id, verification }, null, 2));
    await new Promise(r => setTimeout(r, 21_000));
  }
}
async function cycle() {
  const state = loadState();
  await call('/agents/status');
  for (const postId of watchedPosts) {
    try { await processPost(postId, state); }
    catch (error) { console.error(`[moltbook] ${postId}: ${error.message}`); }
  }
  saveState(state);
}

console.log(`[moltbook] watching ${watchedPosts.length} post(s); poll=${pollMs}ms; state=${stateFile}`);
await cycle();
if (watch) {
  setInterval(() => cycle().catch(error => console.error('[moltbook] cycle:', error.message)), pollMs);
}
