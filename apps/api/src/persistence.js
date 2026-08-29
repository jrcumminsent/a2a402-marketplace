import pg from 'pg';
import { Economy } from './economy.js';
import { registerSeeds } from './seed.js';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL || '';
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false }, max: 3 }) : null;

function serializeEconomy(economy) {
  return {
    agents: [...economy.agents.values()],
    jobs: [...economy.jobs.values()],
    transactions: economy.transactions,
    reputations: [...economy.reputations.values()],
    services: [...economy.services.values()],
    lounge: economy.lounge,
    events: economy.events,
    loungeEnabled: economy.loungeEnabled
  };
}

function hydrateEconomy(state, { baseUrl, loungeEnabled }) {
  if (!state) {
    const economy = new Economy({ loungeEnabled });
    registerSeeds(economy, { baseUrl });
    return economy;
  }

  const economy = new Economy({ loungeEnabled: state.loungeEnabled ?? loungeEnabled });
  economy.agents = new Map((state.agents || []).map(agent => [agent.id, agent]));
  economy.jobs = new Map((state.jobs || []).map(job => [job.id, job]));
  economy.transactions = state.transactions || [];
  economy.reputations = new Map((state.reputations || []).map(reputation => [reputation.agentId, reputation]));
  economy.services = new Map((state.services || []).map(service => [service.id, service]));
  economy.lounge = state.lounge || [];
  economy.events = state.events || [];
  return economy;
}

let memoryEconomy;

export function persistenceMode() {
  return pool ? 'postgres' : 'memory';
}

export async function withEconomy(fn, { baseUrl = 'https://a2a402.market', loungeEnabled = true } = {}) {
  if (!pool) {
    if (!memoryEconomy) {
      memoryEconomy = new Economy({ loungeEnabled });
      registerSeeds(memoryEconomy, { baseUrl });
    }
    return fn(memoryEconomy);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS a2a402_economy_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const existing = await client.query('SELECT state FROM a2a402_economy_state WHERE id = 1 FOR UPDATE');
    const economy = hydrateEconomy(existing.rows[0]?.state, { baseUrl, loungeEnabled });
    const result = await fn(economy);
    const state = serializeEconomy(economy);

    await client.query(
      `INSERT INTO a2a402_economy_state (id, state, updated_at)
       VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`,
      [JSON.stringify(state)]
    );
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
