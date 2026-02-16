const app = require('./app');
const { startReportingRefreshWorker } = require('./workers/reportingRefreshWorker');

const PORT = process.env.PORT || 5000;
if (require.main === module) {
  startReportingRefreshWorker();
  app.listen(PORT, () => {
    console.log(`POS Backend running on port ${PORT}`);
  });
}

module.exports = app;
