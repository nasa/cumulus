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

test('put() writes a file to DynamoDB', async (t) => {
  const file = {
    bucket: randomString(),
    key: randomString(),
    granuleId: randomString(),
  };

  await GranuleFilesCache.put(file);

  const getResponse = await dynamodbDocClient().get({
    TableName: GranuleFilesCache.cacheTableName(),
    Key: { bucket: file.bucket, key: file.key },
  }).promise();

  t.deepEqual(getResponse.Item, file);
});
