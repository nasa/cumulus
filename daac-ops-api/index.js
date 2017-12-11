'use strict';

const token = require('./endpoints/token');
const collections = require('./endpoints/collections');
const granules = require('./endpoints/granules');
const logs = require('./endpoints/logs');
const pdrs = require('./endpoints/pdrs');
const providers = require('./endpoints/providers');
const rules = require('./endpoints/rules');
const workflows = require('./endpoints/workflows');
const executions = require('./endpoints/executions');
const executionStatus = require('./endpoints/execution-status');
const schemas = require('./endpoints/schemas');
const stats = require('./endpoints/stats');
const distribution = require('./endpoints/distribution');

const jobs = require('./lambdas/jobs');
const bootstrap = require('./lambdas/bootstrap');
const scheduler = require('./lambdas/sf-scheduler');
const broadcast = require('./lambdas/sf-sns-broadcast');
const starter = require('./lambdas/sf-starter');
const queue = require('./lambdas/queue');

const indexer = require('./es/indexer');

module.exports = {
  token,
  collections,
  granules,
  logs,
  pdrs,
  providers,
  rules,
  workflows,
  executions,
  executionStatus,
  jobs,
  schemas,
  stats,
  distribution,
  bootstrap,
  broadcast,
  starter,
  queue,
  scheduler: scheduler,
  indexer: indexer.handler,
  logHandler: indexer.logHandler
};
