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
    Body: file.endsWith('.cmr.xml')
      ? fs.createReadStream('tests/data/meta.xml') : aws.parseS3Uri(file).Key
  })));
}

function buildPayload(t) {
  const newPayload = JSON.parse(JSON.stringify(payload));

  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal.name = t.context.stagingBucket;
  newPayload.config.buckets.public.name = t.context.publicBucket;
  newPayload.config.buckets.protected.name = t.context.protectedBucket;

  newPayload.input = newPayload.input.map((file) =>
    aws.buildS3Uri(`${t.context.stagingBucket}`, aws.parseS3Uri(file).Key));
  newPayload.config.input_granules.forEach((gran) => {
    gran.files.forEach((file) => {
      file.bucket = t.context.stagingBucket;
      file.filename = aws.buildS3Uri(t.context.stagingBucket, aws.parseS3Uri(file.filename).Key);
    });
  });
  return newPayload;
}

test.beforeEach(async (t) => {
  t.context.stagingBucket = randomString();
  t.context.publicBucket = randomString();
  t.context.protectedBucket = randomString();
  await Promise.all([
    aws.s3().createBucket({ Bucket: t.context.stagingBucket }).promise(),
    aws.s3().createBucket({ Bucket: t.context.publicBucket }).promise(),
    aws.s3().createBucket({ Bucket: t.context.protectedBucket }).promise()
  ]);
});

test.afterEach.always(async (t) => {
  await deleteBucket(t.context.publicBucket);
  await deleteBucket(t.context.stagingBucket);
  await deleteBucket(t.context.protectedBucket);
});
/*
test.serial('should move files to final location', async (t) => {
  const newPayload = JSON.parse(JSON.stringify(payload));
  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal = {
    name: t.context.stagingBucket,
    type: 'internal'
  };
  newPayload.config.buckets.public.name = t.context.publicBucket;
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
    Bucket: t.context.publicBucket,
    Key: 'jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
  });

  t.true(check);
});

test.serial('should update filenames with specific url_path', async (t) => {
  const newPayload = JSON.parse(JSON.stringify(payload));
  const newFilename1 =
    `s3://${t.context.publicBucket}/jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`;
  const newFilename2 =
    `s3://${t.context.publicBucket}/example/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`;
  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal = {
    name: t.context.stagingBucket,
    type: 'internal'
  };
  newPayload.config.buckets.public.name = t.context.publicBucket;
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
  newPayload.config.buckets.public.name = t.context.publicBucket;

  newPayload.config.input_granules[0].files[0].filename = newPayload.input[0];
  newPayload.config.input_granules[0].files[1].filename = newPayload.input[1];

  const expectedFilenames = [
    `s3://${t.context.publicBucket}/jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`,
    `s3://${t.context.publicBucket}/example/2003/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`,
    `s3://${t.context.publicBucket}/example/2003/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml`];

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
  newPayload.config.buckets.public.name = t.context.publicBucket;
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
*/
// duplicateHandling is 'skip'?



test.serial('when duplicateHandling is "version", keep both data if different', async (t) => {
  set(t, 'context.event.config.duplicateHandling', 'version');
  let newPayload = buildPayload(t);
  newPayload.config.duplicateHandling = t.context.event.config.duplicateHandling;
  // payload could be modified
  const newPayloadOrig = clonedeep(newPayload);

  const expectedFilenames = [
    `s3://${t.context.protectedBucket}/example/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf`,
    `s3://${t.context.publicBucket}/jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`,
    `s3://${t.context.publicBucket}/example/2003/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`,
    `s3://${t.context.publicBucket}/example/2003/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml`
  ];

  await uploadFiles(newPayload.input, t.context.stagingBucket);
  let output = await moveGranules(newPayload);
  let outputFilenames = output.granules[0].files.map((f) => f.filename);
  t.deepEqual(expectedFilenames, outputFilenames);

  // When it encounters data with a duplicated filename with duplicate checksum,
  // it does not create a copy of the file.

  // run 'moveGranules' on the same files again
  newPayload = clonedeep(newPayloadOrig);
  await uploadFiles(newPayload.input, t.context.stagingBucket);
  output = await moveGranules(newPayload);
  outputFilenames = output.granules[0].files.map((f) => f.filename);
  t.deepEqual(expectedFilenames, outputFilenames);

  // When it encounters data with a dupliated filename with different checksum,
  // it moves the existing data to a file with a suffix to distinguish it from the new file

  // run 'moveGranules' with updated files
  newPayload = clonedeep(newPayloadOrig);
  await uploadFiles(newPayload.input, t.context.stagingBucket);
  
});
