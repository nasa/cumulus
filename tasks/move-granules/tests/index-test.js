'use strict';

/* eslint-disable no-param-reassign */

const fs = require('fs');
const test = require('ava');
const payload = require('./data/payload.json');
const aws = require('@cumulus/common/aws');
const { moveGranules } = require('../index');
const { randomString, validateOutput, validateInput } = require('@cumulus/common/test-utils');

// eslint-disable-next-line require-jsdoc
async function deleteBucket(bucket) {
  const response = await aws.s3().listObjects({ Bucket: bucket }).promise();
  const keys = response.Contents.map((o) => o.Key);
  await Promise.all(keys.map(
    (key) => aws.s3().deleteObject({ Bucket: bucket, Key: key }).promise()
  ));
}

test.beforeEach(async (t) => {
  t.context.stagingBucket = randomString();
  t.context.endBucket = randomString();
  await aws.s3().createBucket({
    Bucket: t.context.endBucket
  }).promise();

  await aws.s3().createBucket({
    Bucket: t.context.stagingBucket
  }).promise();
});

test.afterEach.always(async (t) => {
  await deleteBucket(t.context.endBucket);
  await deleteBucket(t.context.stagingBucket);
});

test('should move files to final location', async (t) => {
  const newPayload = JSON.parse(JSON.stringify(payload));
  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal = {
    name: t.context.stagingBucket,
    type: 'internal'
  };
  newPayload.config.buckets.public.name = t.context.endBucket;
  newPayload.input = {
    granuleId: payload.input.granuleId,
    dataType: payload.input.dataType,
    version: payload.input.version,
    files: [
      `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`,
      `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`
    ]
  };

  process.env.stackName = randomString();
  process.env.internal = randomString();
  const collection = payload.config.collection;

  await aws.s3().createBucket({
    Bucket: process.env.internal
  }).promise();

  // save collection in internal/stackName/collections/collectionId
  const key = `${process.env.stackName}/collections/${collection.dataType}___${parseInt(collection.version)}.json`;
  await aws.promiseS3Upload({
    Bucket: process.env.internal,
    Key: key,
    Body: JSON.stringify(collection),
    ACL: 'public-read'
  });

  newPayload.config.input_granules[0].files[0].filename =
  `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`;
  newPayload.config.input_granules[0].files[1].filename =
  `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`;

  await aws.promiseS3Upload({
    Bucket: t.context.stagingBucket,
    Key: 'file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
    Body: 'Something'
  });

  await aws.promiseS3Upload({
    Bucket: t.context.stagingBucket,
    Key: 'file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
    Body: 'Something'
  });

  await validateInput(t, newPayload.input);
  const output = await moveGranules(newPayload);
  await validateOutput(t, output);

  const check = await aws.s3ObjectExists({
    Bucket: t.context.endBucket,
    Key: 'jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
  });

  t.true(check);
});

test('should update filenames with specific url_path', async (t) => {
  const newPayload = JSON.parse(JSON.stringify(payload));
  const newFilename1 =
    `s3://${t.context.endBucket}/jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`;
  const newFilename2 =
    `s3://${t.context.endBucket}/example/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`;
  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal = {
    name: t.context.stagingBucket,
    type: 'internal'
  };
  newPayload.config.buckets.public.name = t.context.endBucket;
  newPayload.input = {
    granuleId: payload.input.granuleId,
    dataType: payload.input.dataType,
    version: payload.input.version,
    files: [
      `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`,
      `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`
    ]
  };
  newPayload.config.input_granules[0].files[0].filename =
  `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`;
  newPayload.config.input_granules[0].files[1].filename =
  `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`;

  await aws.promiseS3Upload({
    Bucket: t.context.stagingBucket,
    Key: 'file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
    Body: 'Something'
  });

  await aws.promiseS3Upload({
    Bucket: t.context.stagingBucket,
    Key: 'file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
    Body: 'Something'
  });

  await validateInput(t, newPayload.input);
  const output = await moveGranules(newPayload);
  const files = output.granules[0].files;
  t.is(files[0].filename, newFilename1);
  t.is(files[1].filename, newFilename2);
});

test('should update filenames with metadata fields', async (t) => {
  const newPayload = JSON.parse(JSON.stringify(payload));
  newPayload.config.collection.url_path =
    'example/{extractYear(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}/';
  newPayload.input = {
    granuleId: payload.input.granuleId,
    dataType: payload.input.dataType,
    version: payload.input.version,
    files: [
      `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`,
      `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`,
      `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml`
    ]
  }

  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal = {
    name: t.context.stagingBucket,
    type: 'internal'
  };
  newPayload.config.buckets.public.name = t.context.endBucket;
  newPayload.config.input_granules[0].files[0].filename =
  `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`;
  newPayload.config.input_granules[0].files[1].filename =
  `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`;
  const expectedFilenames = [
    `s3://${t.context.endBucket}/jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`,
    `s3://${t.context.endBucket}/example/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`,
    `s3://${t.context.endBucket}/example/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml`];

  await aws.promiseS3Upload({
    Bucket: t.context.stagingBucket,
    Key: 'file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
    Body: 'Something'
  });

  await aws.promiseS3Upload({
    Bucket: t.context.stagingBucket,
    Key: 'file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
    Body: 'Something'
  });

  await aws.promiseS3Upload({
    Bucket: t.context.stagingBucket,
    Key: 'file-staging/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
    Body: fs.createReadStream('tests/data/meta.xml')
  })

  await validateInput(t, newPayload.input);
  const output = await moveGranules(newPayload);
  const outputFilenames = output.granules[0].files.map((f) => f.filename);
  t.deepEqual(expectedFilenames, outputFilenames);
});
