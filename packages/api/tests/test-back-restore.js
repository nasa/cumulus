'use strict';

const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const test = require('ava');
const { chunk } = require('lodash');
const { randomString } = require('@cumulus/common/test-utils');
const { fakeGranuleFactory } = require('../lib/testUtils');
const models = require('../models');
const restore = require('../bin/restore');
const backup = require('../bin/backup');

let tempFolder;

/**
 * small helper for populating DynamoDB with fake records
 *
 * @param {string} tableName - DynamoDB table anme
 * @param {integer} limit - number of granule records to generate
 * @returns {Promise<Object>} an array of DynamoDB responses
 */
function populateDynamoDB(tableName, limit) {
  const granules = [];
  const model = new models.Granule();
  model.tableName = tableName;

  for (let i = 0; i < limit; i += 1) {
    granules.push(fakeGranuleFactory());
  }

  const chunked = chunk(granules, 25);
  return Promise.all(chunked.map((c) => model.batchWrite(null, c)));
}

test.before(async () => {
  tempFolder = fs.mkdtempSync(`${os.tmpdir()}${path.sep}`);
});

test.after.always(async () => {
  await fs.remove(tempFolder);
});

test.beforeEach(async (t) => {
  t.context.tableName = randomString();
  await models.Manager.createTable(t.context.tableName, { name: 'granuleId', type: 'S' });
});

test.afterEach.always(async (t) => {
  await models.Manager.deleteTable(t.context.tableName);
});

test.serial('backup records from DynamoDB', async (t) => {
  const limit = 12;
  const tempBackupFile = path.join(tempFolder, `${t.context.tableName}.json`);

  await populateDynamoDB(t.context.tableName, limit);

  process.env.GranulesTable = t.context.tableName;
  const gModel = new models.Granule();
  const resp = await gModel.scan(null, null, 0, 'COUNT');
  t.is(resp.Count, limit);

  await backup(t.context.tableName, 'us-east-1', tempFolder);

  const stats = fs.statSync(tempBackupFile);
  t.truthy(stats);
});

test.serial('restore records to DynamoDB', async (t) => {
  const limit = 55;
  const granuleIds = [];
  const tempRestoreFile = path.join(tempFolder, `${t.context.tableName}.json`);

  // create a backup file with 200 records
  let fileContent = '';
  for (let i = 0; i < limit; i += 1) {
    const granule = fakeGranuleFactory();
    fileContent += `${JSON.stringify(granule)}\n`;
    granuleIds.push(granule.granuleId);
  }
  fs.writeFileSync(tempRestoreFile, fileContent);

  await restore(tempRestoreFile, t.context.tableName, 2);

  // count the records
  const gModel = new models.Manager();
  gModel.tableName = t.context.tableName;
  const resp = await gModel.scan(null, null, 0, 'COUNT');
  t.is(resp.Count, limit);
});
