'use strict';

const collections = require('./endpoints/collections');
const granules = require('./endpoints/granules');
const logs = require('./endpoints/logs');
const pdrs = require('./endpoints/pdrs');
const providers = require('./endpoints/providers');
const schemas = require('./endpoints/schemas');
const stats = require('./endpoints/stats');
const distribution = require('./endpoints/distribution');
const bootstrap = require('./lib/bootstrap');
const indexer = require('./es/indexer');

module.exports = {
  collections,
  granules,
  logs,
  pdrs,
  providers,
  schemas,
  stats,
  distribution,
  bootstrap,
  indexer
};
