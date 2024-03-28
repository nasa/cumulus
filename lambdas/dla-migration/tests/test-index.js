const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const moment = require('moment');

const pMap = require('p-map');
const range = require('lodash/range');
const { createBucket, putJsonS3Object, listS3ObjectsV2, recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');

// eslint-disable-next-line unicorn/import-index
const { handler } = require('../dist/lambda/index');

test.before(async (t) => {
  t.context.stackName = `stack${cryptoRandomString({ length: 5 })}`;
  process.env.stackName = t.context.stackName;
  t.context.systemBucket = `stack${cryptoRandomString({ length: 5 })}`;
  process.env.system_bucket = t.context.systemBucket;
  t.context.dlaPath = `${t.context.stackName}/dead-letter-archive/sqs/`;
  t.context.dlaPath2 = `${t.context.stackName}/dead-letter-archive/sqs2/`;

  await createBucket(process.env.system_bucket);
  const jsonObjects = range(1005).map((i) => ({
    key: `${t.context.dlaPath}${cryptoRandomString({ length: 10 })}.json`,
    body: {
      time: i % 10 === 0 ? moment.utc().subtract(i, 'days') : undefined,
      foo: 'bar',
    },
  }));

  t.context.expectedJsonObjectKeys = jsonObjects.map((jsonObject) => {
    const dateString = moment.utc(jsonObject.body.time).format('YYYY-MM-DD');
    return jsonObject.key.replace(t.context.dlaPath, `${t.context.dlaPath}${dateString}/`);
  });

  await pMap(
    jsonObjects,
    (jsonObject) => putJsonS3Object(t.context.systemBucket, jsonObject.key, jsonObject.body),
    { concurrency: 10 }
  );

  const jsonObjects2 = range(15).map((i) => ({
    key: `${t.context.dlaPath2}${cryptoRandomString({ length: 10 })}.json`,
    body: {
      time: i % 10 === 0 ? moment.utc().subtract(i, 'days') : undefined,
      foo: 'bar',
    },
  }));

  t.context.expectedJsonObjectKeys2 = jsonObjects2.map((jsonObject) => {
    const dateString = moment.utc(jsonObject.body.time).format('YYYY-MM-DD');
    return jsonObject.key.replace(t.context.dlaPath2, `${t.context.dlaPath2}${dateString}/`);
  });

  await pMap(
    jsonObjects2,
    (jsonObject) => putJsonS3Object(t.context.systemBucket, jsonObject.key, jsonObject.body),
    { concurrency: 10 }
  );
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.systemBucket);
});

test('handler successfully migrates files', async (t) => {
  const handlerOutput = await handler({});
  t.is(handlerOutput.migrated, 1005);
  const s3list = await listS3ObjectsV2({
    Bucket: t.context.systemBucket,
    Prefix: t.context.dlaPath,
  });
  t.deepEqual(s3list.map((object) => object.Key).sort(), t.context.expectedJsonObjectKeys.sort());

  const handlerOutput2 = await handler({});
  t.is(handlerOutput2.migrated, 0);
});

test('handler successfully migrates files in non-default location when dlaPath is provided', async (t) => {
  const handlerOutput = await handler({ dlaPath: t.context.dlaPath2 });
  t.is(handlerOutput.migrated, 15);
  const s3list = await listS3ObjectsV2({
    Bucket: t.context.systemBucket,
    Prefix: t.context.dlaPath2,
  });
  t.deepEqual(s3list.map((object) => object.Key).sort(), t.context.expectedJsonObjectKeys2.sort());

  const handlerOutput2 = await handler({ dlaPath: t.context.dlaPath2 });
  t.is(handlerOutput2.migrated, 0);
});
