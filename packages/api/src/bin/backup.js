'use strict';

const fs = require('fs');
const path = require('path');
const Dyno = require('@mapbox/dyno');
const { inTestMode, getLocalstackEndpoint } = require('@cumulus/common/test-utils');
const stream = require('stream');

/**
 * Stores all the records in a given table to a json file named after the table
 * in the directory the function is run from
 *
 * @param {string} table - name of the DynamoDB table
 * @param {string} region - name of the region (default to us-east-1)
 * @param {string} folder - name of the folder to backup files (default to backups)
 * @returns {Promise<string>} returns a string showing the success and
 *                            how many records were backed up
 */
async function backup(table, region = 'us-east-1', folder = 'backups') {
  let count = 0;
  const dynoParams = { table: table, region };
  if (inTestMode()) {
    if (!process.env.LOCALSTACK_HOST) {
      throw new Error('The LOCALSTACK_HOST environment variable is not set.');
    }

    dynoParams.accessKeyId = 'my-access-key-id';
    dynoParams.secretAccessKey = 'my-secret-access-key';
    dynoParams.region = 'us-east-1';
    dynoParams.endpoint = getLocalstackEndpoint('dynamodb');
  }

  const dyno = Dyno(dynoParams);
  const stringify = new stream.Transform({ objectMode: true });
  stringify._transform = function _transform(record, enc, callback) {
    const line = JSON.stringify(record);

    setImmediate(() => {
      stringify.push(`${line}\n`);
      count += 1;
      callback();
    });
  };

  // create a backup folder
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder);
  }

  const backupFile = fs.createWriteStream(path.join(folder, `${table}.json`));
  const data = dyno.scanStream()
    .pipe(stringify)
    .pipe(backupFile);

  console.log(`Starting back up for ${table} ...`);

  return new Promise((resolve, reject) => {
    data.on('err', reject);
    data.on('finish', () => resolve(`Backup completed! ${count} records were backed up.`));
  });
}

module.exports = backup;
