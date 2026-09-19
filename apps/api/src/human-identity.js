import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const databaseUrl=process.env.DATABASE_URL||'';
const pool=databaseUrl?new Pool({connectionString:databaseUrl,ssl:databaseUrl.includes('localhost')?false:{rejectUnauthorized:false},max:3}):null;
const memory={humans:new Map(),sessions:new Map(),links:new Map()};
const SESSION_TTL_MS=30*24*60*60*1000;

function now(){return new Date()}
function normalizeEmail(value){return String(value||'').trim().toLowerCase()}
function publicHuman(row){return{id:row.id,email:row.email,displayName:row.display_name||row.displayName,createdAt:row.created_at||row.createdAt}}
function scrypt(password,salt){return crypto.scryptSync(password,salt,64).toString('hex')}
export function validateHumanInput({email,password,displayName},{requireDisplayName=false}={}){
  const cleanEmail=normalizeEmail(email),cleanName=String(displayName||'').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail))throw new Error('valid email required');
  if(String(password||'').length<10)throw new Error('password must be at least 10 characters');
  if(String(password||'').length>200)throw new Error('password too long');
  if(requireDisplayName&&(cleanName.length<2||cleanName.length>60))throw new Error('display name must be 2-60 characters');
  return{email:cleanEmail,password:String(password),displayName:cleanName};
}
export function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){return{salt,hash:scrypt(password,salt)}}
export function verifyPassword(password,salt,expected){const actual=Buffer.from(scrypt(password,salt),'hex'),target=Buffer.from(String(expected||''),'hex');return actual.length===target.length&&crypto.timingSafeEqual(actual,target)}
function sessionToken(){return crypto.randomBytes(32).toString('base64url')}
function tokenHash(token){return crypto.createHash('sha256').update(String(token)).digest('hex')}

async function ensureTables(client){
  await client.query('CREATE SCHEMA IF NOT EXISTS a2a402_private');
  await client.query(`CREATE TABLE IF NOT EXISTS a2a402_private.humans (
    id text PRIMARY KEY,
    email text UNIQUE NOT NULL,
    display_name text NOT NULL,
    password_salt text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS a2a402_private.human_sessions (
    token_hash text PRIMARY KEY,
    human_id text NOT NULL REFERENCES a2a402_private.humans(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS a2a402_private.human_agent_links (
    human_id text NOT NULL REFERENCES a2a402_private.humans(id) ON DELETE CASCADE,
    agent_id text NOT NULL,
    linked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (human_id,agent_id),
    UNIQUE (agent_id)
  )`);
}
async function withDb(fn){if(!pool)return fn(null);const client=await pool.connect();try{await client.query('BEGIN');await ensureTables(client);const result=await fn(client);await client.query('COMMIT');return result}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}

export async function createHuman(input){
  const v=validateHumanInput(input,{requireDisplayName:true}),id='human_'+crypto.randomUUID(),pw=hashPassword(v.password),createdAt=now().toISOString();
  return withDb(async client=>{
    if(!client){
      if([...memory.humans.values()].some(h=>h.email===v.email))throw new Error('email already registered');
      const human={id,email:v.email,displayName:v.displayName,passwordSalt:pw.salt,passwordHash:pw.hash,createdAt};
      memory.humans.set(id,human);return publicHuman(human);
    }
    const existing=await client.query('SELECT 1 FROM a2a402_private.humans WHERE email=$1',[v.email]);
    if(existing.rowCount)throw new Error('email already registered');
    const result=await client.query('INSERT INTO a2a402_private.humans(id,email,display_name,password_salt,password_hash) VALUES($1,$2,$3,$4,$5) RETURNING id,email,display_name,created_at',[id,v.email,v.displayName,pw.salt,pw.hash]);
    return publicHuman(result.rows[0]);
  });
}
export async function authenticateHuman(email,password){
  const cleanEmail=normalizeEmail(email);
  if(!cleanEmail||!password)throw new Error('email and password required');
  return withDb(async client=>{
    let row;
    if(!client){row=[...memory.humans.values()].find(h=>h.email===cleanEmail);if(!row||!verifyPassword(password,row.passwordSalt,row.passwordHash))throw new Error('invalid email or password');return publicHuman(row)}
    const result=await client.query('SELECT * FROM a2a402_private.humans WHERE email=$1',[cleanEmail]);row=result.rows[0];
    if(!row||!verifyPassword(password,row.password_salt,row.password_hash))throw new Error('invalid email or password');
    return publicHuman(row);
  });
}
export async function createHumanSession(humanId){
  const token=sessionToken(),hash=tokenHash(token),expiresAt=new Date(Date.now()+SESSION_TTL_MS);
  await withDb(async client=>{
    if(!client){memory.sessions.set(hash,{humanId,expiresAt:expiresAt.toISOString()});return}
    await client.query('DELETE FROM a2a402_private.human_sessions WHERE expires_at < now()');
    await client.query('INSERT INTO a2a402_private.human_sessions(token_hash,human_id,expires_at) VALUES($1,$2,$3)',[hash,humanId,expiresAt]);
  });
  return{token,expiresAt:expiresAt.toISOString()};
}
export async function humanFromSession(token){
  if(!token)return null;const hash=tokenHash(token);
  return withDb(async client=>{
    if(!client){const s=memory.sessions.get(hash);if(!s||new Date(s.expiresAt)<=now())return null;return publicHuman(memory.humans.get(s.humanId))}
    const result=await client.query(`SELECT h.id,h.email,h.display_name,h.created_at FROM a2a402_private.human_sessions s JOIN a2a402_private.humans h ON h.id=s.human_id WHERE s.token_hash=$1 AND s.expires_at>now()`,[hash]);
    return result.rows[0]?publicHuman(result.rows[0]):null;
  });
}
export async function revokeHumanSession(token){if(!token)return;const hash=tokenHash(token);await withDb(async client=>{if(!client){memory.sessions.delete(hash);return}await client.query('DELETE FROM a2a402_private.human_sessions WHERE token_hash=$1',[hash])})}
export async function linkAgent(humanId,agentId){
  return withDb(async client=>{
    if(!client){if([...memory.links.values()].some(x=>x.agentId===agentId&&x.humanId!==humanId))throw new Error('agent already linked to another human');memory.links.set(humanId+':'+agentId,{humanId,agentId,linkedAt:now().toISOString()});return}
    const owner=await client.query('SELECT human_id FROM a2a402_private.human_agent_links WHERE agent_id=$1',[agentId]);
    if(owner.rowCount&&owner.rows[0].human_id!==humanId)throw new Error('agent already linked to another human');
    await client.query('INSERT INTO a2a402_private.human_agent_links(human_id,agent_id) VALUES($1,$2) ON CONFLICT (human_id,agent_id) DO NOTHING',[humanId,agentId]);
  });
}
export async function unlinkAgent(humanId,agentId){return withDb(async client=>{if(!client){memory.links.delete(humanId+':'+agentId);return}await client.query('DELETE FROM a2a402_private.human_agent_links WHERE human_id=$1 AND agent_id=$2',[humanId,agentId])})}
export async function linkedAgentIds(humanId){return withDb(async client=>{if(!client)return[...memory.links.values()].filter(x=>x.humanId===humanId).map(x=>x.agentId);const r=await client.query('SELECT agent_id FROM a2a402_private.human_agent_links WHERE human_id=$1 ORDER BY linked_at',[humanId]);return r.rows.map(x=>x.agent_id)})}
export function sessionCookie(token,{clear=false}={}){const base='__Host-a2a402_human_session='+(clear?'':encodeURIComponent(token||''))+'; Path=/; HttpOnly; Secure; SameSite=Lax';return clear?base+'; Max-Age=0':base+'; Max-Age='+Math.floor(SESSION_TTL_MS/1000)}
export function readSessionCookie(headers={}){const cookie=headers.cookie||headers.Cookie||'';const m=String(cookie).match(/(?:^|;\s*)__Host-__Host-a2a402_human_session=([^;]+)/);return m?decodeURIComponent(m[1]):null}
