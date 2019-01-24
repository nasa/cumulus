// this is a temporary lambda function until we implement a mechanism for running
// time consuming migrations

'use strict';

const migrations = require('../migrations');
const migration1 = require('../migrations/migration_1');
const migration2 = require('../migrations/migration_2');
const migration3 = require('../migrations/migration_3');
const migration4 = require('../migrations/migration_4');

const mappings = {
  migration1: migration1,
  migration2: migration2,
  migration3: migration3,
  migration4: migration4
};

/**
 * Lambda function handler for running migrations
 *
 * @param {Object} event - aws lambda function event object
 * @param {Object} context - aws lambda function context object
 * @param {Function} cb - aws lambda function callback object
 * @returns {Promise<undefined>} undefined
 */
function handler(event, context, cb) {
  const eventMigrations = event.migrations.map((m) => mappings[m]);
  return migrations(eventMigrations, {
    // Used by migration1
    tables: [
      process.env.GranulesTable,
      process.env.ExecutionsTable,
      process.env.PdrsTable
    ],
    elasticsearch_host: process.env.ES_HOST,

    // Used by migration2
    granulesTable: process.env.GranulesTable,
    filesTable: process.env.FilesTable,

    // Used by Migration_3
    bucket: process.env.system_bucket,
    stackName: process.env.stackName
  })
    .then((r) => cb(null, r))
    .catch(cb);
}

module.exports.handler = handler;
