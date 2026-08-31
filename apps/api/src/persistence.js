import pg from 'pg';
import { Economy } from './economy.js';
import { registerSeeds, ensureBootstrapOpportunities } from './seed.js';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL || '';
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false }, max: 3 }) : null;
const stateTable = 'a2a402_private.economy_state';
const MAINNET_CHAIN = 'eip155:8453';
const SEPOLIA_CHAIN = 'eip155:84532';
const BOOTSTRAP_CREATOR = 'agent_10';
const A2A402_TREASURY = '0xD08eA67ef730fc336a9B6fB89A4B66dF67Fbb69c';

function migrateAgent(agent) {
  let wallets = Array.isArray(agent.wallets) ? agent.wallets.map(wallet => {
    if (wallet.chain === SEPOLIA_CHAIN && Array.isArray(wallet.assets) && wallet.assets.map(String).map(x=>x.toUpperCase()).includes('A2A')) return { ...wallet, chain: MAINNET_CHAIN, label: String(wallet.label || 'A2A settlement wallet').replace(/Base Sepolia/gi,'Base Mainnet') };
    return wallet;
  }) : [];
  let supportedPayments = Array.isArray(agent.supportedPayments) ? agent.supportedPayments.filter(payment => String(payment.asset || '').toUpperCase() !== 'USDC_TEST').map(payment => String(payment.asset || '').toUpperCase() === 'A2A' ? { ...payment, network: MAINNET_CHAIN, primary: true, marketplaceFeeBps: 500 } : payment) : [];
  if (agent.id === BOOTSTRAP_CREATOR) {
    wallets = wallets.filter(wallet => !(wallet.chain === MAINNET_CHAIN && Array.isArray(wallet.assets) && wallet.assets.map(String).map(x=>x.toUpperCase()).includes('A2A')));
    wallets.push({id:`${BOOTSTRAP_CREATOR}:base-mainnet-bootstrap`,chain:MAINNET_CHAIN,address:A2A402_TREASURY,label:'A2A402 Base Mainnet settlement wallet',walletType:'external',assets:['A2A']});
    supportedPayments = supportedPayments.filter(payment => !(String(payment.asset || '').toUpperCase()==='A2A' && payment.network===MAINNET_CHAIN));
    supportedPayments.unshift({network:MAINNET_CHAIN,asset:'A2A',primary:true,marketplaceFeeBps:500});
    return { ...agent, wallets, paymentAddress:A2A402_TREASURY, supportedPayments };
  }
  return { ...agent, wallets, supportedPayments };
}
function migrateJob(job) {let migrated=job;if(job.paymentAsset==='A2A'&&job.paymentNetwork==='base-sepolia'&&['OPEN','CLAIMED','IN_PROGRESS','SUBMITTED','VERIFYING'].includes(job.status))migrated={...job,paymentNetwork:'base',paymentRoute:null,payerAddress:null,payeeAddress:null,status:'OPEN',workerId:null,claimedAt:null,submittedAt:null,updatedAt:new Date().toISOString()};if(migrated.creatorId===BOOTSTRAP_CREATOR&&migrated.paymentAsset==='A2A'&&migrated.paymentNetwork==='base'&&['OPEN','IN_PROGRESS','SUBMITTED','VERIFYING','AWAITING_PAYMENT'].includes(migrated.status))migrated={...migrated,payerAddress:A2A402_TREASURY};return migrated;}
function serializeEconomy(economy){return{agents:[...economy.agents.values()],jobs:[...economy.jobs.values()],transactions:economy.transactions,reputations:[...economy.reputations.values()],services:[...economy.services.values()],lounge:economy.lounge,events:economy.events,loungeEnabled:economy.loungeEnabled};}
function hydrateEconomy(state,{baseUrl,loungeEnabled}){if(!state){const economy=new Economy({loungeEnabled});registerSeeds(economy,{baseUrl});ensureBootstrapOpportunities(economy);return economy;}const economy=new Economy({loungeEnabled:state.loungeEnabled??loungeEnabled});economy.agents=new Map((state.agents||[]).map(migrateAgent).map(agent=>[agent.id,agent]));economy.jobs=new Map((state.jobs||[]).map(migrateJob).map(job=>[job.id,job]));economy.transactions=state.transactions||[];economy.reputations=new Map((state.reputations||[]).map(reputation=>[reputation.agentId,reputation]));economy.services=new Map((state.services||[]).map(service=>[service.id,service]));economy.lounge=state.lounge||[];economy.events=state.events||[];ensureBootstrapOpportunities(economy);return economy;}
let memoryEconomy;
export function persistenceMode(){return pool?'postgres':'memory';}
export async function withEconomy(fn,{baseUrl='https://a2a402.market',loungeEnabled=true}={}){if(!pool){if(!memoryEconomy){memoryEconomy=new Economy({loungeEnabled});registerSeeds(memoryEconomy,{baseUrl});ensureBootstrapOpportunities(memoryEconomy);}return fn(memoryEconomy);}const client=await pool.connect();try{await client.query('BEGIN');const existing=await client.query(`SELECT state FROM ${stateTable} WHERE id = 1 FOR UPDATE`);const economy=hydrateEconomy(existing.rows[0]?.state,{baseUrl,loungeEnabled});const result=await fn(economy);const state=serializeEconomy(economy);await client.query(`INSERT INTO ${stateTable} (id, state, updated_at) VALUES (1, $1::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`,[JSON.stringify(state)]);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
