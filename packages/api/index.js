'use strict';

exports.token = require('./endpoints/token').handler;
exports.collections = require('./endpoints/collections');
exports.granules = require('./endpoints/granules');
exports.logs = require('./endpoints/logs');
exports.pdrs = require('./endpoints/pdrs');
exports.providers = require('./endpoints/providers');
exports.rules = require('./endpoints/rules');
exports.workflows = require('./endpoints/workflows');
exports.executions = require('./endpoints/executions');
exports.executionStatus = require('./endpoints/execution-status');
exports.schemas = require('./endpoints/schemas');
exports.stats = require('./endpoints/stats');
exports.version = require('./endpoints/version');
exports.distribution = require('./endpoints/distribution').handler;
exports.dbIndexer = require('./lambdas/db-indexer');
exports.reconciliationReports = require('./endpoints/reconciliation-reports');

exports.jobs = require('./lambdas/jobs');
exports.executeMigrations = require('./lambdas/executeMigrations').handler;
exports.bootstrap = require('./lambdas/bootstrap').handler;
exports.scheduler = require('./lambdas/sf-scheduler');
exports.starter = require('./lambdas/sf-starter');
exports.kinesisConsumer = require('./lambdas/kinesis-consumer').handler;
exports.inRegionS3Policy = require('./lambdas/in-region-s3-policy').handler;

exports.emsReport = require('./lambdas/ems-report').handler;
exports.emsDistributionReport = require('./lambdas/ems-distribution-report').handler;

exports.createReconciliationReport = require('./lambdas/create-reconciliation-report').handler;

const indexer = require('./es/indexer');
const broadcast = require('./lambdas/sf-sns-broadcast');

exports.sfStart = broadcast.start;
exports.sfEnd = broadcast.end;
exports.indexer = indexer.handler;
exports.logHandler = indexer.logHandler;

exports.models = require('./models');
exports.testUtils = require('./lib/testUtils');
