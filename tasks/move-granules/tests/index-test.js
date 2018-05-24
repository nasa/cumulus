'use strict';

const fs = require('fs');
const test = require('ava');
const aws = require('@cumulus/common/aws');
const payload = require('./data/payload.json');
const { moveGranules } = require('../index');
const { randomString } = require('@cumulus/common/test-utils')

// eslint-disable-next-line require-jsdoc
async function deleteBucket(bucket) {
  const response = await aws.s3().listObjects({ Bucket: bucket }).promise();
  const keys = response.Contents.map((o) => o.Key);
  await Promise.all(keys.map(
    (key) => aws.s3().deleteObject({ Bucket: bucket, Key: key }).promise()
  ));
}

test.beforeEach((t) => {
  t.context.stagingBucket = randomString();
  return aws.s3().createBucket({
    Bucket: 'cumulus-public'
  }).promise().then(aws.s3().createBucket({
    Bucket: t.context.stagingBucket
  }).promise());
});

test.afterEach.always(async (t) => {
  deleteBucket('cumulus-public');
  deleteBucket(t.context.stagingBucket);
});

test('should move files to final location', (t) => {
  const newPayload = JSON.parse(JSON.stringify(payload));
  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal = t.context.stagingBucket;
  newPayload.input = [
    `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`,
    `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`
  ];
  newPayload.config.input_granules[0].files[0].filename =
  `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`;
  newPayload.config.input_granules[0].files[1].filename =
  `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`;

  return aws.promiseS3Upload({
    Bucket: t.context.stagingBucket,
    Key: 'file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
    Body: 'Something'
  }).then(aws.promiseS3Upload({
    Bucket: t.context.stagingBucket,
    Key: 'file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
    Body: 'Something'
  })).then(() => {
    return moveGranules(newPayload)
      .then(() => {
        return aws.s3ObjectExists({
          Bucket: 'cumulus-public',
          Key: 'jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
        }).then((check) => {
          t.true(check);
        });
      });
  })
});

test('should update filenames with specific url_path', (t) => {
  const newPayload = JSON.parse(JSON.stringify(payload));
  const newFilename1 =
    's3://cumulus-public/jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg';
  const newFilename2 =
    's3://cumulus-public/example/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg';
  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal = t.context.stagingBucket;
  newPayload.input = [
    `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`,
    `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`
  ];
  newPayload.config.input_granules[0].files[0].filename =
  `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`;
  newPayload.config.input_granules[0].files[1].filename =
  `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`;

  return aws.promiseS3Upload({
    Bucket: t.context.stagingBucket,
    Key: 'file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
    Body: 'Something'
  }).then(aws.promiseS3Upload({
    Bucket: t.context.stagingBucket,
    Key: 'file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
    Body: 'Something'
  })).then(() => {
    return moveGranules(newPayload)
      .then((output) => {
        const files = output.granules[0].files;
        t.is(files[0].filename, newFilename1);
        t.is(files[1].filename, newFilename2);
      });
  });
});

test('should update filenames with metadata fields', (t) => {
  const newPayload = JSON.parse(JSON.stringify(payload));
  newPayload.config.collection.url_path =
    'example/{extractYear(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}/';
  newPayload.input = [
    `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`,
    `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`,
    `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml`
  ];
  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal = t.context.stagingBucket;
  newPayload.config.input_granules[0].files[0].filename =
  `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`;
  newPayload.config.input_granules[0].files[1].filename =
  `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`;
  const expectedFilenames = [
    's3://cumulus-public/jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
    's3://cumulus-public/example/2003/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
    's3://cumulus-public/example/2003/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml'];

  return aws.promiseS3Upload({
    Bucket: t.context.stagingBucket,
    Key: 'file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
    Body: 'Something'
  }).then(aws.promiseS3Upload({
    Bucket: t.context.stagingBucket,
    Key: 'file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
    Body: 'Something'
  })).then(aws.promiseS3Upload({
    Bucket: t.context.stagingBucket,
    Key: 'file-staging/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
    Body: fs.createReadStream('tests/data/meta.xml')
  })).then(() => {
    return moveGranules(newPayload)
      .then((output) => {
        const outputFilenames =
          output.granules[0].files.map((f) =>
            f.filename);
        t.deepEqual(expectedFilenames, outputFilenames);
      });
  });
});
