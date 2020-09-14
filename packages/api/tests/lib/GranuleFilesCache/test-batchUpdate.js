'use strict';

// Note: These tests are run in serial to try to reduce the load on LocalStack

const AggregateError = require('aggregate-error');
const get = require('lodash/get');
const range = require('lodash/range');
const test = require('ava');
const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const noop = require('lodash/noop');
const { randomString } = require('@cumulus/common/test-utils');
const GranuleFilesCache = require('../../../lib/GranuleFilesCache');

test.before(async () => {
  process.env.FilesTable = randomString();
  await GranuleFilesCache.createCacheTable();
});

test.after.always(async () => {
  await GranuleFilesCache.deleteCacheTable().catch(noop);
});

test.serial('batchUpdate() can handle no args', async (t) => {
  await t.notThrowsAsync(GranuleFilesCache.batchUpdate());
});

test.serial('batchUpdate() can handle no requested updates', async (t) => {
  await t.notThrowsAsync(
    GranuleFilesCache.batchUpdate({ puts: [], deletes: [] })
  );
});

test.serial('batchUpdate() can create a file record', async (t) => {
  const file = {
    bucket: randomString(),
    key: randomString(),
    granuleId: randomString(),
  };

  await GranuleFilesCache.batchUpdate({ puts: [file] });

  const getResponse = await dynamodbDocClient().get({
    TableName: process.env.FilesTable,
    Key: { bucket: file.bucket, key: file.key },
  }).promise();

  t.is(get(getResponse, 'Item.granuleId'), file.granuleId);
});

test.serial('batchUpdate() can update an existing a file record', async (t) => {
  const originalFile = {
    bucket: randomString(),
    key: randomString(),
    granuleId: randomString(),
  };

  await dynamodbDocClient().put({
    TableName: process.env.FilesTable,
    Item: originalFile,
  }).promise();

  const updatedFile = { ...originalFile, granuleId: randomString() };

  await GranuleFilesCache.batchUpdate({ puts: [updatedFile] });

  const getResponse = await dynamodbDocClient().get({
    TableName: process.env.FilesTable,
    Key: { bucket: updatedFile.bucket, key: updatedFile.key },
  }).promise();

  t.is(get(getResponse, 'Item.granuleId'), updatedFile.granuleId);
});

test.serial('batchUpdate() can delete a file record', async (t) => {
  const file = {
    bucket: randomString(),
    key: randomString(),
    granuleId: randomString(),
  };

  await dynamodbDocClient().put({
    TableName: process.env.FilesTable,
    Item: file,
  }).promise();

  await GranuleFilesCache.batchUpdate({ deletes: [file] });

  const getResponse = await dynamodbDocClient().get({
    TableName: process.env.FilesTable,
    Key: { bucket: file.bucket, key: file.key },
  }).promise();

  t.is(getResponse.Item, undefined);
});

test.serial('batchUpdate() does not throw an exception when attempting to delete a non-existent file', async (t) => {
  await t.notThrowsAsync(
    GranuleFilesCache.batchUpdate({
      deletes: [
        {
          bucket: randomString(),
          key: randomString(),
        },
      ],
    })
  );
});

test.serial('batchUpdate() will throw an exception if a put request does not contain a bucket property', async (t) => {
  const error = await t.throwsAsync(
    GranuleFilesCache.batchUpdate({
      puts: [
        {
          key: randomString(),
          granuleId: randomString(),
        },
      ],
    }),
    { instanceOf: AggregateError }
  );

  const errors = Array.from(error);
  t.is(errors.length, 1);
  t.regex(errors[0].message, /^bucket is required/);
});

test.serial('batchUpdate() will throw an exception if a put request does not contain a key property', async (t) => {
  const error = await t.throwsAsync(
    GranuleFilesCache.batchUpdate({
      puts: [
        {
          bucket: randomString(),
          granuleId: randomString(),
        },
      ],
    }),
    { instanceOf: AggregateError }
  );

  const errors = Array.from(error);
  t.is(errors.length, 1);
  t.regex(errors[0].message, /^key is required/);
});

test.serial('batchUpdate() will throw an exception if a put request does not contain a granuleId property', async (t) => {
  const error = await t.throwsAsync(
    GranuleFilesCache.batchUpdate({
      puts: [
        {
          bucket: randomString(),
          key: randomString(),
        },
      ],
    }),
    { instanceOf: AggregateError }
  );

  const errors = Array.from(error);
  t.is(errors.length, 1);
  t.regex(errors[0].message, /^granuleId is required/);
});

test.serial('batchUpdate() will throw an exception if a delete request does not contain a bucket property', async (t) => {
  const error = await t.throwsAsync(
    GranuleFilesCache.batchUpdate({
      deletes: [
        {
          key: randomString(),
        },
      ],
    }),
    { instanceOf: AggregateError }
  );

  const errors = Array.from(error);
  t.is(errors.length, 1);
  t.regex(errors[0].message, /^bucket is required/);
});

test.serial('batchUpdate() will throw an exception if a delete request does not contain a key property', async (t) => {
  const error = await t.throwsAsync(
    GranuleFilesCache.batchUpdate({
      deletes: [
        {
          bucket: randomString(),
        },
      ],
    }),
    { instanceOf: AggregateError }
  );

  const errors = Array.from(error);
  t.is(errors.length, 1);
  t.regex(errors[0].message, /^key is required/);
});

test.serial('batchUpdate() will ignore extra fields in a put', async (t) => {
  const file = {
    bucket: randomString(),
    key: randomString(),
    granuleId: randomString(),
    name: 'Frank',
  };

  await GranuleFilesCache.batchUpdate({ puts: [file] });

  const getResponse = await dynamodbDocClient().get({
    TableName: process.env.FilesTable,
    Key: { bucket: file.bucket, key: file.key },
  }).promise();

  t.deepEqual(
    getResponse.Item,
    {
      bucket: file.bucket,
      key: file.key,
      granuleId: file.granuleId,
    }
  );
});

test.serial('batchUpdate() will ignore extra fields in a delete', async (t) => {
  const file = {
    bucket: randomString(),
    key: randomString(),
    name: 'Frank',
  };

  await GranuleFilesCache.batchUpdate({ deletes: [file] });

  const getResponse = await dynamodbDocClient().get({
    TableName: process.env.FilesTable,
    Key: { bucket: file.bucket, key: file.key },
  }).promise();

  t.is(getResponse.Item, undefined);
});

// Dynamo's batchWriteItem method can only handle 25 updates at a time
// https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB.html#batchWriteItem-property
test.serial('batchUpdate() can handle more than 25 updates', async (t) => {
  const files = range(26).map(() => ({
    bucket: randomString(),
    key: randomString(),
    granuleId: randomString(),
  }));

  await GranuleFilesCache.batchUpdate({ puts: files });

  await Promise.all(
    files.map(async (file) => {
      const getResponse = await dynamodbDocClient().get({
        TableName: process.env.FilesTable,
        Key: { bucket: file.bucket, key: file.key },
      }).promise();

      t.is(get(getResponse, 'Item.granuleId'), file.granuleId);
    })
  );
});
