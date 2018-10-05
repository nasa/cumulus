'use strict';

const fs = require('fs');
const test = require('ava');
const clonedeep = require('lodash.clonedeep');
const set = require('lodash.set');
const aws = require('@cumulus/common/aws');
const errors = require('@cumulus/common/errors');
const {
  randomString, validateConfig, validateInput, validateOutput
} = require('@cumulus/common/test-utils');
const payload = require('./data/payload.json');
const { moveGranules } = require('..');

async function deleteBucket(bucket) {
  const response = await aws.s3().listObjects({ Bucket: bucket }).promise();
  const keys = response.Contents.map((o) => o.Key);
  await Promise.all(keys.map(
    (key) => aws.s3().deleteObject({ Bucket: bucket, Key: key }).promise()
  ));
}

async function uploadFiles(files, bucket) {
  await Promise.all(files.map((file) => aws.promiseS3Upload({
    Bucket: bucket,
    Key: aws.parseS3Uri(file).Key,
    Body: file.endsWith('.cmr.xml') ? fs.createReadStream('tests/data/meta.xml') : randomString()
  })));
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

test.serial('should move files to final location', async (t) => {
  const newPayload = JSON.parse(JSON.stringify(payload));
  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal = {
    name: t.context.stagingBucket,
    type: 'internal'
  };
  newPayload.config.buckets.public.name = t.context.endBucket;
  newPayload.input = [
    `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`,
    `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`
  ];
  newPayload.config.input_granules[0].files[0].filename = newPayload.input[0];
  newPayload.config.input_granules[0].files[1].filename = newPayload.input[1];

  await uploadFiles(newPayload.input, t.context.stagingBucket);

  const output = await moveGranules(newPayload);
  await validateOutput(t, output);

  const check = await aws.s3ObjectExists({
    Bucket: t.context.endBucket,
    Key: 'jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
  });

  t.true(check);
});

test.serial('should update filenames with specific url_path', async (t) => {
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
  newPayload.input = [
    `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`,
    `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`
  ];
  newPayload.config.input_granules[0].files[0].filename = newPayload.input[0];
  newPayload.config.input_granules[0].files[1].filename = newPayload.input[1];

  await uploadFiles(newPayload.input, t.context.stagingBucket);

  const output = await moveGranules(newPayload);
  const files = output.granules[0].files;
  t.is(files[0].filename, newFilename1);
  t.is(files[1].filename, newFilename2);
});

test.serial('should update filenames with metadata fields', async (t) => {
  const newPayload = JSON.parse(JSON.stringify(payload));
  newPayload.config.collection.url_path =
    'example/{extractYear(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}/';
  newPayload.input = [
    `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`,
    `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`,
    `s3://${t.context.stagingBucket}/file-staging/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml`
  ];
  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal = {
    name: t.context.stagingBucket,
    type: 'internal'
  };
  newPayload.config.buckets.public.name = t.context.endBucket;

  newPayload.config.input_granules[0].files[0].filename = newPayload.input[0];
  newPayload.config.input_granules[0].files[1].filename = newPayload.input[1];

  const expectedFilenames = [
    `s3://${t.context.endBucket}/jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`,
    `s3://${t.context.endBucket}/example/2003/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`,
    `s3://${t.context.endBucket}/example/2003/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml`];

  await uploadFiles(newPayload.input, t.context.stagingBucket);

  const output = await moveGranules(newPayload);
  const outputFilenames = output.granules[0].files.map((f) => f.filename);
  t.deepEqual(expectedFilenames, outputFilenames);
});

async function duplicateHandlingErrorTest(t) {
  const newPayload = JSON.parse(JSON.stringify(payload));
  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal = {
    name: t.context.stagingBucket,
    type: 'internal'
  };
  newPayload.config.buckets.public.name = t.context.endBucket;
  const granuleId = 'MOD11A1.A2017200.h19v04.006.2017201090724';
  newPayload.input = [
    `s3://${t.context.stagingBucket}/file-staging/${granuleId}_1.jpg`,
    `s3://${t.context.stagingBucket}/file-staging/${granuleId}_2.jpg`
  ];
  newPayload.config.input_granules[0].files[0].filename = newPayload.input[0];
  newPayload.config.input_granules[0].files[1].filename = newPayload.input[1];

  await uploadFiles(newPayload.input, t.context.stagingBucket);

  let expectedErrorMessages;
  try {
    await validateConfig(t, newPayload.config);
    await validateInput(t, newPayload.input);

    // payload could be modified
    const newPayloadOrig = clonedeep(newPayload);

    const output = await moveGranules(newPayload);
    await validateOutput(t, output);

    expectedErrorMessages = output.granules[0].files.map((file) => {
      const parsed = aws.parseS3Uri(file.filename);
      return `${parsed.Key} already exists in ${parsed.Bucket} bucket`;
    });

    await uploadFiles(newPayload.input, t.context.stagingBucket);
    await moveGranules(newPayloadOrig);
    t.fail();
  }
  catch (err) {
    t.true(err instanceof errors.DuplicateFile);
    t.true(expectedErrorMessages.includes(err.message));
    t.pass();
  }
}

test.serial('when duplicateHandling is not specified, throw an error on duplicate', async (t) => {
  await duplicateHandlingErrorTest(t);
});

test.serial('when duplicateHandling is "error", throw an error on duplicate', async (t) => {
  set(t, 'context.event.config.duplicateHandling', 'error');
  await duplicateHandlingErrorTest(t);
});
