'use strict';

const test = require('ava');
const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');
const GranuleFilesCache = require('../../../lib/GranuleFilesCache');

test.before(async () => {
  process.env.FilesTable = randomString();
  await GranuleFilesCache.createCacheTable();
});

test.after.always(async () => {
  await GranuleFilesCache.deleteCacheTable();
});

test('getGranuleId() returns the correct granuleId if the file exists in the table', async (t) => {
  const bucket = randomString();
  const key = randomString();
  const granuleId = randomString();

  await dynamodbDocClient().put({
    TableName: process.env.FilesTable,
    Item: { bucket, key, granuleId },
  }).promise();

  const fetchedGranuleId = await GranuleFilesCache.getGranuleId(bucket, key);

  t.is(fetchedGranuleId, granuleId);
});

test('getGranuleId() returns undefined if the file does not exist in the table', async (t) => {
  const bucket = randomString();
  const key = randomString();

  const fetchedGranuleId = await GranuleFilesCache.getGranuleId(bucket, key);

  t.is(fetchedGranuleId, undefined);
});
