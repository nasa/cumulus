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

test('backup and restore Granules table', async (t) => {
  const limit = 30;
  const tempBackupFile = path.join(tempFolder, `${tableName}.json`);

  const granuleIds = await populateDynamoDB(gModel, limit);

  const resp = await gModel.scan(null, null, 0, 'COUNT');
  t.is(resp.Count, limit);

  await backup(tableName, 'us-east-1', tempFolder);

  const stats = fs.statSync(tempBackupFile);
  t.truthy(stats);

  await restore(tempBackupFile, tableName, 1);

  // verify records are the same
  const scanResponse = await gModel.scan(null, 'granuleId', 0, 'SPECIFIC_ATTRIBUTES');
  t.is(scanResponse.Count, limit);
  t.deepEqual(scanResponse.Items.map((i) => i.granuleId).sort(), granuleIds.sort());
});
