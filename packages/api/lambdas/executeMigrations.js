// this is a temporary lambda function until we implement a mechanism for running
// time consuming migrations

'use strict';

const migrations = require('../migrations');
const migration1 = require('../migrations/migration_1');

/**
 * Lambda function handler for running migrations
 *
 * @param {Object} event - aws lambda function event object
 * @param {Object} context - aws lambda function context object
 * @param {Function} cb - aws lambda function callback object
 * @returns {Promise<undefined>} undefined
 */
function handler(event, context, cb) {
  return migrations([migration1], {
    tables: [
      process.env.GranulesTable,
      process.env.ExecutionsTable,
      process.env.PdrsTable
    ],
    elasticsearch_host: process.env.ES_HOST
  })
    .then((r) => cb(null, r))
    .catch(cb);
}

module.exports.handler = handler;
