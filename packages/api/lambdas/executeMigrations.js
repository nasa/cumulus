// this is a temporary lambda function until we implement a mechanism for running
// time consuming migrations

'use strict';

const migrations = require('../migrations');
const migration1 = require('../migrations/migration_1');
const migration2 = require('../migrations/migration_2');

/**
 * Lambda function handler for running migrations
 *
 * @param {Object} event - aws lambda function event object
 * @param {Object} context - aws lambda function context object
 * @param {Function} cb - aws lambda function callback object
 * @returns {Promise<undefined>} undefined
 */
function handler(event, context, cb) {
  return migrations([migration1, migration2], {
    // Used by migration1
    tables: [
      process.env.GranulesTable,
      process.env.ExecutionsTable,
      process.env.PdrsTable
    ],
    elasticsearch_host: process.env.ES_HOST,
    // Used by migration2
    granulesTable: process.env.GranulesTable,
    filesTable: process.env.FilesTable
  })
    .then((r) => cb(null, r))
    .catch(cb);
}

module.exports.handler = handler;
