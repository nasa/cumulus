'use strict';

module.exports = {
  mode: process.env.PRODUCTION ? 'production' : 'development',
  entry: {
    app: './app/index.js',
    bootstrap: './lambdas/bootstrap.js',
    bulkDelete: './lambdas/bulk-delete.js',
    cleanExecutions: './lambdas/cleanExecutions.js',
    createReconciliationReport: './lambdas/create-reconciliation-report.js',
    dbIndexer: './lambdas/db-indexer.js',
    distribution: './app/distribution.js',
    emsDistributionReport: './lambdas/ems-distribution-report.js',
    emsIngestReport: './lambdas/ems-ingest-report.js',
    emsProductMetadataReport: './lambdas/ems-metadata-report.js',
    executeMigrations: './lambdas/executeMigrations.js',
    indexer: './es/indexer.js',
    indexFromDatabase: './lambdas/index-from-database.js',
    messageConsumer: './lambdas/message-consumer.js',
    payloadLogger: './lambdas/payload-logger.js',
    reportExecutions: './lambdas/report-executions.js',
    reportGranules: './lambdas/report-granules.js',
    reportPdrs: './lambdas/report-pdrs.js',
    sfScheduler: './lambdas/sf-scheduler.js',
    sfSnsBroadcast: './lambdas/sf-sns-broadcast.js',
    sfSemaphoreDown: './lambdas/sf-semaphore-down.js',
    sfStarter: './lambdas/sf-starter.js'
  },
  output: {
    libraryTarget: 'commonjs2',
    filename: '[name]/index.js'
  },
  node: {
    __dirname: false
  },
  externals: [
    'aws-sdk',
    'electron',
    { formidable: 'url' }
  ],
  devtool: process.env.PRODUCTION ? false : 'inline-source-map',
  target: 'node',
  plugins: [
    // new webpack.ContextReplacementPlugin({
    //   // Definitions...
    // })
  ]
};
