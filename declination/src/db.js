// Thin query helpers over Netlify Database (Postgres).
// Queries use `?` placeholders (converted to $1, $2, …) so the SQL stays close to the original SQLite version.
import { getDatabase } from '@netlify/database';

let conn;
const pool = () => (conn ||= getDatabase()).pool;
const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

const wrap = (runner) => ({
  all: async (sql, ...params) => (await runner().query(toPg(sql), params)).rows,
  get: async (sql, ...params) => (await runner().query(toPg(sql), params)).rows[0],
  run: async (sql, ...params) => runner().query(toPg(sql), params),
});

// Runs fn inside a transaction on a single connection; fn receives the same all/get/run helpers.
async function tx(fn) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(wrap(() => client));
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

const db = { ...wrap(pool), tx };
export default db;
