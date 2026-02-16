const db = require('../services/db');

const MV_LIST = [
  'mv_reporting_outlet_daily',
  'mv_reporting_outlet_hourly',
  'mv_reporting_product_daily',
  'mv_reporting_discount_daily',
];

const LOCK_ID = 11042026;

let workerTimer = null;
let workerRunning = false;

const getIntervalMs = () => {
  const raw = Number(process.env.REPORTING_REFRESH_INTERVAL_MS || 60000);
  if (!Number.isFinite(raw) || raw < 5000) return 60000;
  return raw;
};

const refreshOneView = async (client, viewName) => {
  try {
    await client.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${viewName}`);
  } catch (err) {
    if (err.code === '42P01') {
      // View not found (migration may not be applied yet).
      return;
    }

    if (err.code === '55000' || err.code === '0A000') {
      await client.query(`REFRESH MATERIALIZED VIEW ${viewName}`);
      return;
    }

    throw err;
  }
};

const runWorkerTick = async () => {
  if (workerRunning) return;
  workerRunning = true;
  const client = await db.getClient();

  try {
    const lockResult = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_ID]);
    if (!lockResult.rows[0]?.locked) {
      return;
    }

    for (const viewName of MV_LIST) {
      // eslint-disable-next-line no-await-in-loop
      await refreshOneView(client, viewName);
    }
  } catch (err) {
    console.error('reporting-refresh-worker tick failed:', err.message);
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
    } catch (unlockErr) {
      // ignore unlock failures
    }
    client.release();
    workerRunning = false;
  }
};

const startReportingRefreshWorker = () => {
  if (process.env.REPORTING_WORKER_ENABLED === 'false') {
    return null;
  }
  if (workerTimer) return workerTimer;

  const intervalMs = getIntervalMs();
  workerTimer = setInterval(() => {
    runWorkerTick();
  }, intervalMs);

  if (typeof workerTimer.unref === 'function') {
    workerTimer.unref();
  }

  runWorkerTick();
  return workerTimer;
};

const stopReportingRefreshWorker = () => {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
};

module.exports = {
  startReportingRefreshWorker,
  stopReportingRefreshWorker,
};
