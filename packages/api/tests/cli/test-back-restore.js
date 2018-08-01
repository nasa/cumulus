'use strict';

const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const test = require('ava');
const { chunk } = require('lodash');
const { randomString } = require('@cumulus/common/test-utils');
const { fakeGranuleFactory } = require('../../lib/testUtils');
const models = require('../../models');
const restore = require('../../bin/restore');
const backup = require('../../bin/backup');

let tempFolder;
const tableName = randomString();

/**
 * small helper for populating DynamoDB with fake records
 *
 * @param {string} table - DynamoDB table name
 * @param {integer} limit - number of granule records to generate
 * @returns {Promise<Array>} an array of objects with granuleIds
 */
async function populateDynamoDB(table, limit) {
  const granules = [];
  const granuleIds = [];
  const model = new models.Granule();
  model.tableName = table;

  for (let i = 0; i < limit; i += 1) {
    const g = fakeGranuleFactory();
    granules.push(g);
    granuleIds.push({ granuleId: g.granuleId });
  }

  const chunked = chunk(granules, 25);
  await Promise.all(chunked.map((c) => model.batchWrite(null, c)));
  return granuleIds;
}

test.before(async () => {
  tempFolder = fs.mkdtempSync(`${os.tmpdir()}${path.sep}`);
  await models.Manager.createTable(tableName, { name: 'granuleId', type: 'S' });
});

test.after.always(async () => {
  await fs.remove(tempFolder);
  await models.Manager.deleteTable(tableName);
});

test.serial('backup records from DynamoDB', async (t) => {
  const limit = 12;
  const tempBackupFile = path.join(tempFolder, `${tableName}.json`);

  const granuleIds = await populateDynamoDB(tableName, limit);

  process.env.GranulesTable = tableName;
  const gModel = new models.Granule();
  const resp = await gModel.scan(null, null, 0, 'COUNT');
  t.is(resp.Count, limit);

  await backup(tableName, 'us-east-1', tempFolder);

  const stats = fs.statSync(tempBackupFile);
  t.truthy(stats);

  // delete records
  await gModel.batchWrite(granuleIds);
});

test.serial('restore records to DynamoDB', async (t) => {
  const limit = 25;
  const granuleIds = [];
  const tempRestoreFile = path.join(tempFolder, `restore_${tableName}.json`);

  // create a backup file with 200 records
  let fileContent = '';
  for (let i = 0; i < limit; i += 1) {
    const granule = fakeGranuleFactory();
    fileContent += `${JSON.stringify(granule)}\n`;
    granuleIds.push(granule.granuleId);
  }
  fs.writeFileSync(tempRestoreFile, fileContent);

  await restore(tempRestoreFile, tableName, 1);

  // count the records
  const gModel = new models.Manager();
  gModel.tableName = tableName;
  const resp = await gModel.scan(null, null, 0, 'COUNT');
  t.is(resp.Count, limit);
});
