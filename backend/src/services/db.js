const { Pool } = require('pg');

const buildPoolConfig = () => {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSLMODE === 'require'
        ? { rejectUnauthorized: false }
        : false,
    };
  }

  return {
    host: process.env.PGHOST,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: process.env.PGSSLMODE === 'require'
      ? { rejectUnauthorized: false }
      : false,
  };
};

let pool = null;

const getPool = () => {
  if (!pool) {
    pool = new Pool(buildPoolConfig());
  }
  return pool;
};

const query = (text, params) => getPool().query(text, params);
const getClient = () => getPool().connect();

const closePool = async () => {
  if (!pool) return;
  const currentPool = pool;
  pool = null;
  await currentPool.end();
};

module.exports = {
  query,
  getClient,
  closePool,
};
