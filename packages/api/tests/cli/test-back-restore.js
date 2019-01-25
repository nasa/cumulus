'use strict';

const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const test = require('ava');
const chunk = require('lodash.chunk');
const range = require('lodash.range');
const { randomString } = require('@cumulus/common/test-utils');
const { fakeGranuleFactory } = require('../../lib/testUtils');
const models = require('../../models');
const restore = require('../../bin/restore');
const backup = require('../../bin/backup');

let tempFolder;
let tableName;

/**
 * small helper for populating DynamoDB with fake records
 *
 * @param {Object} granuleModel - an instance of the Granule model
 * @param {integer} limit - number of granule records to generate
 * @returns {Promise<Array>} an array of objects with granuleIds
 */
async function populateDynamoDB(granuleModel, limit) {
  const granules = range(limit).map(() => fakeGranuleFactory());

  const chunkedGranules = chunk(granules, 25);
  await Promise.all(chunkedGranules.map((c) => granuleModel.batchWrite(null, c)));

  return granules.map((granule) => granule.granuleId);
}

let gModel;

test.before(async () => {
  tableName = randomString();
  process.env.GranulesTable = tableName;
  gModel = new models.Granule();
  await gModel.createTable();

  tempFolder = fs.mkdtempSync(`${os.tmpdir()}${path.sep}`);
});

test.after.always(async () => {
  await fs.remove(tempFolder);
  await gModel.deleteTable();
});

test.serial('backup records from DynamoDB', async (t) => {
  const limit = 12;
  const tempBackupFile = path.join(tempFolder, `${tableName}.json`);

  const granuleIds = await populateDynamoDB(gModel, limit);

  const resp = await gModel.scan(null, null, 0, 'COUNT');
  t.is(resp.Count, limit);

  await backup(tableName, 'us-east-1', tempFolder);

  const stats = fs.statSync(tempBackupFile);
  t.truthy(stats);

  // delete records
  await gModel.batchWrite(granuleIds.map((id) => ({ granuleId: id })));
});

// Skipping because this does not provide a schema for the items being
// imported.  Not fixing at this time because this will be removed when we
// move to using a relational database.
test.serial.skip('restore records to DynamoDB', async (t) => {
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
  const resp = await gModel.scan(null, null, 0, 'COUNT');
  t.is(resp.Count, limit);
});
