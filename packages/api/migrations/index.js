'use strict';

const path = require('path');
const log = require('@cumulus/common/log');
const { listS3ObjectsV2, s3 } = require('@cumulus/common/aws');

/**
 * This function compares a list of all migrations against the list of
 * migrations stored on AWS S3 and return the ones that are not executed
 * yet.
 *
 * @param {Array<string>} allMigrations - list of all migrations
 * @param {string} migrationFolder - the folder where migrations are stored on S3
 * @returns {Promise<Array>} an array of migration scripts that are not executed yet
 */
async function findNewMigrations(allMigrations, migrationFolder) {
  // list executed migrations
  const listed = await listS3ObjectsV2({
    Bucket: process.env.system_bucket,
    Prefix: migrationFolder
  });

  const executedMigrations = listed.map((c) => path.basename(c.Key));
  return allMigrations.filter((m) => !executedMigrations.includes(m.name));
}

/**
 * Execute migrations that are specified in this module in sequence.
 * Only migrations that are not executed on a deployment are executed
 *
 * @param {Array} migrations - list of migration modules to run
 * @param {Object} options - options passed to all migrations
 * @returns {Promise<Array>} returns a list of migration outputs
 */
async function runMigrations(migrations, options) {
  const migrationFolder = `${process.env.stackName}/migrations`;

  const newMigrations = await findNewMigrations(migrations, migrationFolder);

  if (findNewMigrations.length === 0) {
    log.info('No migration scripts to be run');
  }

  const outputs = [];

  // we run the migrations in a for loop to make sure
  // they run in sequence
  for (let ctr = 0; ctr < newMigrations.length; ctr += 1) {
    const m = newMigrations[ctr];
    log.info(`Running migration script ${m.name}`);
    outputs.push(await m.run(options)); // eslint-disable-line no-await-in-loop

    // write the migration on s3
    await s3().putObject({ // eslint-disable-line no-await-in-loop
      Bucket: process.env.system_bucket,
      Key: `${migrationFolder}/${m.name}`
    }).promise();
    log.info(`Successfully ran migration script ${m.name}`);
  }

  return outputs;
}

module.exports = runMigrations;
