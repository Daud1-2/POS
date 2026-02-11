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

const pool = new Pool(buildPoolConfig());

const query = (text, params) => pool.query(text, params);
const getClient = () => pool.connect();

module.exports = {
  query,
  getClient,
};
