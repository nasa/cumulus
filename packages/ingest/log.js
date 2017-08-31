/* this is a temporary library for logging. It eventually has to be merged
 * with common/log.js or be replaced by it. It is included here because
 * we need an easier way to stringify JS object logs for ElasticSearch
 * indexing
 */
'use strict';

module.exports = require('pino')({
  name: 'cumulus',
  level: process.env.LOG_LEVEL || 'info',
  prettyPrint: process.env.PRETTY_PRINT || false,
  enabled: process.env.ENABLE_LOGGING || true
});
