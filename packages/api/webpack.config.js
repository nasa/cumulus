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
    emsReport: './lambdas/ems-report.js',
    executeMigrations: './lambdas/executeMigrations.js',
    indexer: './es/indexer.js',
    jobs: './lambdas/jobs.js',
    messageConsumer: './lambdas/message-consumer.js',
    payloadLogger: './lambdas/payload-logger.js',
    sfScheduler: './lambdas/sf-scheduler.js',
    sfSnsBroadcast: './lambdas/sf-sns-broadcast.js',
    sfSemaphoreDown: './lambdas/sf-semaphore-down',
    sfStarter: './lambdas/sf-starter.js'
  },
  output: {
    libraryTarget: 'commonjs2',
    filename: '[name]/index.js'
  },
  externals: [
    'aws-sdk',
    'electron',
    { formidable: 'url' }
  ],
  devtool: process.env.PRODUCTION ? false : 'inline-source-map',
  target: 'node'
};
