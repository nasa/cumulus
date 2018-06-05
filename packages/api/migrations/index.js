/* eslint-disable no-restricted-syntax,
  no-await-in-loop, import/no-dynamic-require, global-require */

'use strict';

const path = require('path');
const log = require('@cumulus/common/log');
const { listS3ObjectsV2, s3 } = require('@cumulus/common/aws');

const migrations = [
  './migration_0.js'
];

async function findNewMigrations(allMigrations, migrationFolder) {
  // list executed migrations
  const listed = await listS3ObjectsV2({
    Bucket: process.env.internal,
    Prefix: migrationFolder
  });

  const executedMigrations = listed.map((c) => path.basename(c.Key));
  return allMigrations.filter((m) => !executedMigrations.includes(path.basename(m)));
}


async function runMigrations() {
  const migrationFolder = `${process.env.stackName}/migrations`;

  const newMigrations = await findNewMigrations(migrations, migrationFolder);

  if (findNewMigrations.length === 0) {
    log.info('No migration scripts to be run');
  }

  const outputs = [];

  // we run the migrations in a for loop to make sure
  // they run in sequence
  for (const m of newMigrations) { 
    const fileName = path.basename(m);
    log.info(`Running migration script ${fileName}`);
    const func = require(m);
    outputs.push(await func.run());

    // write the migration on s3
    await s3().putObject({
      Bucket: process.env.internal,
      Key: `${migrationFolder}/${fileName}`
    }).promise();
    log.info(`Successfully ran migration script ${fileName}`);
  }

  return outputs;
}

module.exports = runMigrations;
