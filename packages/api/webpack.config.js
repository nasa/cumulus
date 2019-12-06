'use strict';

const CopyPlugin = require('copy-webpack-plugin');
const path = require('path');
// path to module root
const root = path.resolve(__dirname);

module.exports = {
  mode: process.env.PRODUCTION ? 'production' : 'development',
  entry: {
    app: './app/index.js',
    bootstrap: './lambdas/bootstrap.js',
    bulkDelete: './lambdas/bulk-delete.js',
    bulkOperation: './lambdas/bulk-operation.js',
    cleanExecutions: './lambdas/cleanExecutions.js',
    createReconciliationReport: './lambdas/create-reconciliation-report.js',
    cwSfExecutionEventToDb: './lambdas/cw-sf-execution-event-to-db.js',
    dbIndexer: './lambdas/db-indexer.js',
    distribution: './app/distribution.js',
    emsDistributionReport: './lambdas/ems-distribution-report.js',
    emsIngestReport: './lambdas/ems-ingest-report.js',
    emsProductMetadataReport: './lambdas/ems-metadata-report.js',
    executeMigrations: './lambdas/executeMigrations.js',
    indexer: './es/indexer.js',
    indexFromDatabase: './lambdas/index-from-database.js',
    manualConsumer: './lambdas/manual-consumer.js',
    messageConsumer: './lambdas/message-consumer.js',
    payloadLogger: './lambdas/payload-logger.js',
    publishExecutions: './lambdas/publish-executions.js',
    publishReports: './lambdas/publish-reports.js',
    reportGranules: './lambdas/report-granules.js',
    reportPdrs: './lambdas/report-pdrs.js',
    sfScheduler: './lambdas/sf-scheduler.js',
    sfSemaphoreDown: './lambdas/sf-semaphore-down.js',
    sfStarter: './lambdas/sf-starter.js',
    sqsMessageConsumer: './lambdas/sqs-message-consumer.js',
    sqsMessageRemover: './lambdas/sqs-message-remover.js'
  },
  devtool: 'inline-source-map',
  resolve: {
    alias: {
      'saml2-js': 'saml2-js/lib-js/saml2.js',
      ejs: 'ejs/ejs.min.js',
      handlebars: 'handlebars/dist/handlebars.js'
    }
  },
  plugins: [
    // templates to use saml2.js, dependency problem with xml-encryption package
    new CopyPlugin([
      { from: 'node_modules/xml-encryption/lib/templates', to: 'app/templates' }
    ])
  ],
  output: {
    libraryTarget: 'commonjs2',
    filename: '[name]/index.js',
    devtoolModuleFilenameTemplate: (info) => {
      const relativePath = path.relative(root, info.absoluteResourcePath)
      return `webpack://${relativePath}`;
    }
  },
  externals: [
    'aws-sdk',
    'electron',
    { formidable: 'url' }
  ],
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'babel-loader',
            options: {
              cacheDirectory: true
            },
          },
        ],
      },
    ],
  },
  target: 'node',
  node: {
    __dirname: false,
    __filename: false
  }
};
