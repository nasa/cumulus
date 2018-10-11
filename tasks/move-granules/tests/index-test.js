'use strict';

const fs = require('fs');
const test = require('ava');
const {
  buildS3Uri,
  recursivelyDeleteS3Bucket,
  s3ObjectExists,
  s3,
  promiseS3Upload,
  headObject,
  parseS3Uri
} = require('@cumulus/common/aws');
const clonedeep = require('lodash.clonedeep');
const errors = require('@cumulus/common/errors');
const {
  randomString, validateConfig, validateInput, validateOutput
} = require('@cumulus/common/test-utils');
const payload = require('./data/payload.json');
const { moveGranules } = require('..');

async function uploadFiles(files, bucket) {
  await Promise.all(files.map((file) => promiseS3Upload({
    Bucket: bucket,
    Key: parseS3Uri(file).Key,
    Body: file.endsWith('.cmr.xml')
      ? fs.createReadStream('tests/data/meta.xml') : parseS3Uri(file).Key
  })));
}

function buildPayload(t) {
  const newPayload = JSON.parse(JSON.stringify(payload));

  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal.name = t.context.stagingBucket;
  newPayload.config.buckets.public.name = t.context.publicBucket;
  newPayload.config.buckets.protected.name = t.context.protectedBucket;

  newPayload.input = newPayload.input.map((file) =>
    buildS3Uri(`${t.context.stagingBucket}`, parseS3Uri(file).Key));
  newPayload.config.input_granules.forEach((gran) => {
    gran.files.forEach((file) => {
      file.bucket = t.context.stagingBucket;
      file.filename = buildS3Uri(t.context.stagingBucket, parseS3Uri(file.filename).Key);
    });
  });
  return newPayload;
}

function getExpectedOuputFileNames(t) {
  return [
    `s3://${t.context.protectedBucket}/example/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf`,
    `s3://${t.context.publicBucket}/jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg`,
    `s3://${t.context.publicBucket}/example/2003/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg`,
    `s3://${t.context.publicBucket}/example/2003/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml`
  ];
}

test.beforeEach(async (t) => {
  t.context.stagingBucket = randomString();
  t.context.publicBucket = randomString();
  t.context.protectedBucket = randomString();
  await Promise.all([
    s3().createBucket({ Bucket: t.context.stagingBucket }).promise(),
    s3().createBucket({ Bucket: t.context.publicBucket }).promise(),
    s3().createBucket({ Bucket: t.context.protectedBucket }).promise()
  ]);
});

test.afterEach.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.publicBucket);
  await recursivelyDeleteS3Bucket(t.context.stagingBucket);
  await recursivelyDeleteS3Bucket(t.context.protectedBucket);
});

test.serial('should move files to final location', async (t) => {
  const newPayload = buildPayload(t);
  await uploadFiles(newPayload.input, t.context.stagingBucket);

  const output = await moveGranules(newPayload);
  await validateOutput(t, output);

  const check = await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg'
  });

  t.true(check);
});

test.serial('should update filenames with metadata fields', async (t) => {
  const newPayload = buildPayload(t);
  const expectedFilenames = getExpectedOuputFileNames(t);

  await uploadFiles(newPayload.input, t.context.stagingBucket);

  const output = await moveGranules(newPayload);
  const outputFilenames = output.granules[0].files.map((f) => f.filename);
  t.deepEqual(expectedFilenames, outputFilenames);
});

test.serial('should overwrite files', async (t) => {
  const filename = 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg';
  const sourceKey = `file-staging/${filename}`;
  const destKey = `jpg/example/${filename}`;

  const newPayload = buildPayload(t);
  newPayload.config.duplicateHandling = 'replace';
  newPayload.input = [
    `s3://${t.context.stagingBucket}/${sourceKey}`
  ];
  newPayload.config.input_granules[0].files = [{
    filename: `s3://${t.context.stagingBucket}/${sourceKey}`,
    name: filename
  }];

  await promiseS3Upload({
    Bucket: t.context.stagingBucket,
    Key: sourceKey,
    Body: 'Something'
  });

  const output = await moveGranules(newPayload);
  await validateOutput(t, output);
  const existingFile = await headObject(
    t.context.publicBucket,
    destKey
  );

  // re-stage source jpg file with different content
  const content = randomString();
  await promiseS3Upload({
    Bucket: t.context.stagingBucket,
    Key: sourceKey,
    Body: content
  });

  try {
    await moveGranules(newPayload);
  }
  catch (err) {
    t.fail();
  }
  finally {
    const updatedFile = await headObject(
      t.context.publicBucket,
      destKey
    );
    const objects = await s3().listObjects({ Bucket: t.context.publicBucket }).promise();
    t.is(objects.Contents.length, 1);

    const item = objects.Contents[0];
    t.is(item.Key, destKey);

    const existingModified = new Date(existingFile.LastModified).getTime();
    const itemModified = new Date(item.LastModified).getTime();
    t.true(itemModified > existingModified);

    t.is(updatedFile.ContentLength, content.length);
  }
});

// duplicateHandling has default value 'error' if it's not provided in task configuration and
// collection configuration
async function duplicateHandlingErrorTest(t, duplicateHandling) {
  const newPayload = buildPayload(t);
  if (duplicateHandling) newPayload.config.duplicateHandling = duplicateHandling;

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
      const parsed = parseS3Uri(file.filename);
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
  await duplicateHandlingErrorTest(t, 'error');
});

test.serial('when duplicateHandling is "version", keep both data if different', async (t) => {
  let newPayload = buildPayload(t);
  newPayload.config.duplicateHandling = 'version';

  // payload could be modified
  const newPayloadOrig = clonedeep(newPayload);

  const expectedFilenames = getExpectedOuputFileNames(t);

  await uploadFiles(newPayload.input, t.context.stagingBucket);
  let output = await moveGranules(newPayload);
  const existingFileNames = output.granules[0].files.map((f) => f.filename);
  t.deepEqual(expectedFilenames, existingFileNames);

  const outputHdfFile = existingFileNames.filter((f) => f.endsWith('.hdf'))[0];
  const existingHdfFileInfo = await headObject(
    parseS3Uri(outputHdfFile).Bucket, parseS3Uri(outputHdfFile).Key
  );

  // When it encounters data with a duplicated filename with duplicate checksum,
  // it does not create a copy of the file.

  // When it encounters data with a dupliated filename with different checksum,
  // it moves the existing data to a file with a suffix to distinguish it from the new file

  // run 'moveGranules' again with one of the input files updated
  newPayload = clonedeep(newPayloadOrig);
  await uploadFiles(newPayload.input, t.context.stagingBucket);

  const inputHdfFile = newPayload.input.filter((f) => f.endsWith('.hdf'))[0];
  const params = {
    Bucket: t.context.stagingBucket, Key: parseS3Uri(inputHdfFile).Key, Body: randomString()
  };
  await s3().putObject(params).promise();

  output = await moveGranules(newPayload);
  const currentFileNames = output.granules[0].files.map((f) => f.filename);
  t.is(currentFileNames.length, 5);

  // the extra file is the renamed hdf file
  let extraFiles = currentFileNames.filter((f) => !existingFileNames.includes(f));
  t.is(extraFiles.length, 1);
  t.true(extraFiles[0].startsWith(`${outputHdfFile}.v`));

  // the existing hdf file gets renamed
  const renamedFile = extraFiles[0];
  const renamedHdfFileInfo = await headObject(
    parseS3Uri(renamedFile).Bucket, parseS3Uri(renamedFile).Key
  );
  t.deepEqual(existingHdfFileInfo, renamedHdfFileInfo);

  // new hdf file is moved to destination
  const newHdfFileInfo = await headObject(
    parseS3Uri(outputHdfFile).Bucket, parseS3Uri(outputHdfFile).Key
  );

  t.is(newHdfFileInfo.ContentLength, randomString().length);

  // run 'moveGranules' the third time with the same input file updated
  newPayload = clonedeep(newPayloadOrig);
  await uploadFiles(newPayload.input, t.context.stagingBucket);

  params.Body = randomString();
  await s3().putObject(params).promise();

  output = await moveGranules(newPayload);
  const lastFileNames = output.granules[0].files.map((f) => f.filename);
  t.is(lastFileNames.length, 6);

  // the extra files are the renamed hdf files
  extraFiles = lastFileNames.filter((f) => !existingFileNames.includes(f));
  t.is(extraFiles.length, 2);
  t.true(extraFiles[0].startsWith(`${outputHdfFile}.v`));
});

test.serial('when duplicateHandling is "skip", does not overwrite or create new', async (t) => {
  let newPayload = buildPayload(t);
  newPayload.config.duplicateHandling = 'skip';

  // payload could be modified
  const newPayloadOrig = clonedeep(newPayload);

  const expectedFilenames = getExpectedOuputFileNames(t);

  await uploadFiles(newPayload.input, t.context.stagingBucket);
  let output = await moveGranules(newPayload);
  const existingFileNames = output.granules[0].files.map((f) => f.filename);
  t.deepEqual(expectedFilenames, existingFileNames);

  const outputHdfFile = existingFileNames.filter((f) => f.endsWith('.hdf'))[0];
  const existingHdfFileInfo = await headObject(
    parseS3Uri(outputHdfFile).Bucket, parseS3Uri(outputHdfFile).Key
  );

  // run 'moveGranules' again with one of the input files updated
  newPayload = clonedeep(newPayloadOrig);
  await uploadFiles(newPayload.input, t.context.stagingBucket);

  const inputHdfFile = newPayload.input.filter((f) => f.endsWith('.hdf'))[0];
  const params = {
    Bucket: t.context.stagingBucket, Key: parseS3Uri(inputHdfFile).Key, Body: randomString()
  };
  await s3().putObject(params).promise();

  output = await moveGranules(newPayload);
  const currentFileNames = output.granules[0].files.map((f) => f.filename);
  t.deepEqual(expectedFilenames, currentFileNames);

  // does not overwrite
  const currentHdfFileInfo = await headObject(
    parseS3Uri(outputHdfFile).Bucket, parseS3Uri(outputHdfFile).Key
  );

  t.is(existingHdfFileInfo.ContentLength, currentHdfFileInfo.ContentLength);
  t.not(currentHdfFileInfo.ContentLength, randomString().length);
});
