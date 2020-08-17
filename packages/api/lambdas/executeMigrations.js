// this is a temporary lambda function until we implement a mechanism for running
// time consuming migrations

'use strict';

const migrations = require('../migrations');
const migration5 = require('../migrations/migration_5');

const mappings = {
  migration5: migration5,
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
  return migrations(eventMigrations, {})
    .then((r) => cb(null, r))
    .catch(cb);
}

module.exports.handler = handler;
