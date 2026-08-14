import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// A dropped idle connection is routine on cloud Postgres and the pool replaces it
// automatically — exiting the process here would take the whole server down for
// every connected user over a single transient blip. Just log it.
pool.on('error', (err) => {
  console.error('Unexpected DB pool error (connection dropped, pool will recover):', err.message);
});

export default pool;
