'use strict';

const fs = require('fs');
const path = require('path');
const sinon = require('sinon');
const test = require('ava');
const range = require('lodash/range');
const { s3 } = require('@cumulus/aws-client/services');

const {
  buildS3Uri,
  listS3ObjectsV2,
  recursivelyDeleteS3Bucket,
  putJsonS3Object,
  s3ObjectExists,
  promiseS3Upload,
  headObject,
  parseS3Uri,
} = require('@cumulus/aws-client/S3');
const { InvalidArgument } = require('@cumulus/errors');
const { isCMRFile } = require('@cumulus/cmrjs');
const cloneDeep = require('lodash/cloneDeep');
const set = require('lodash/set');
const errors = require('@cumulus/errors');
const S3 = require('@cumulus/aws-client/S3');
const {
  randomString, randomId, validateConfig, validateInput, validateOutput,
} = require('@cumulus/common/test-utils');
const { getDistributionBucketMapKey } = require('@cumulus/distribution-utils');
const { isECHO10Filename, isISOFilename } = require('@cumulus/cmrjs/cmr-utils');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { moveGranules } = require('..');
// eslint-disable-next-line max-len
const InvalidArgumentErrorRegex = /^File already exists in bucket .+ with key .+ for collection .+ and granuleId: .+, but is being moved for collection .+\.$/;

async function uploadFiles(files, bucket) {
  await Promise.all(files.map((file) => {
    let body;
    if (isECHO10Filename(file)) {
      body = fs.createReadStream('tests/data/meta.xml');
    } else if (isISOFilename(file)) {
      body = fs.createReadStream('tests/data/meta.iso.xml');
    } else {
      body = parseS3Uri(file).Key;
    }

    return promiseS3Upload({
      params:
      {
        Bucket: bucket,
        Key: parseS3Uri(file).Key,
        Body: body,
      },
    });
  }));
}

function buildPayload(t) {
  const newPayload = t.context.payload;

  newPayload.config.bucket = t.context.stagingBucket;
  newPayload.config.buckets.internal.name = t.context.stagingBucket;
  newPayload.config.buckets.public.name = t.context.publicBucket;
  newPayload.config.buckets.protected.name = t.context.protectedBucket;

  newPayload.input.granules.forEach((gran) => {
    gran.files.forEach((file) => {
      file.bucket = t.context.stagingBucket;
    });
  });

  const configOverrides = t.context.configOverride || {};
  newPayload.config = { ...newPayload.config, ...configOverrides };
  return newPayload;
}

// duplicateHandling has default value 'error' if it's not provided in task configuration and
// collection configuration
async function duplicateHandlingErrorTest({
  t,
  duplicateHandling,
  testOverrides = {},
  errorType = errors.DuplicateFile,
  expectedErrorMessage,
}) {
  const newPayload = buildPayload(t);
  const filesToUpload = cloneDeep(t.context.filesToUpload);

  if (duplicateHandling) newPayload.config.duplicateHandling = duplicateHandling;

  await uploadFiles(filesToUpload, t.context.stagingBucket);

  try {
    await validateConfig(t, newPayload.config);
    await validateInput(t, newPayload.input);

    // payload could be modified
    const newPayloadOrig = cloneDeep(newPayload);

    const output = await moveGranules(newPayload);
    await validateOutput(t, output);

    expectedErrorMessage = expectedErrorMessage || /.+ already exists in .+ bucket/;

    await uploadFiles(filesToUpload, t.context.stagingBucket);
    await moveGranules({ ...newPayloadOrig, testOverrides });
    t.fail('Expected a DuplicateFile error to be thrown');
  } catch (error) {
    t.true(error instanceof errorType);
    t.regex(error.message, expectedErrorMessage);
  }
}

async function overwriteGranuleFilesTest(t, testOverrides) {
  const filename = 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg';
  const sourceKey = `file-staging/${filename}`;
  const destKey = `jpg/example/${filename}`;

  const newPayload = buildPayload(t);
  newPayload.config.duplicateHandling = 'replace';

  newPayload.input.granules[0].files = [{
    bucket: t.context.stagingBucket,
    key: sourceKey,
  }];

  const uploadParams = {
    params: {
      Bucket: t.context.stagingBucket,
      Key: sourceKey,
      Body: 'Something',
    },
  };

  t.log(`CUMULUS-970 debugging: start s3 upload. params: ${JSON.stringify(uploadParams)}`);

  await promiseS3Upload(uploadParams);

  t.log(`CUMULUS-970 debugging: start move granules. params: ${JSON.stringify(newPayload)}`);

  let output = await moveGranules(newPayload);

  t.log('CUMULUS-970 debugging: move granules complete');

  await validateOutput(t, output);

  t.log(`CUMULUS-970 debugging: head object destKey ${destKey}`);

  const existingFile = await headObject(
    t.context.publicBucket,
    destKey
  );

  t.log('CUMULUS-970 debugging: headobject complete');

  // re-stage source jpg file with different content
  const content = randomString();

  uploadParams.Body = content;

  t.log(`CUMULUS-970 debugging: start s3 upload. params: ${JSON.stringify(uploadParams)}`);

  await promiseS3Upload({
    params: {
      Bucket: t.context.stagingBucket,
      Key: sourceKey,
      Body: content,
    },
  });

  t.log(`CUMULUS-970 debugging: start move granules. params: ${JSON.stringify(newPayload)}`);

  output = await moveGranules({ ...newPayload, testOverrides });

  t.log('CUMULUS-970 debugging:  move granules complete');

  const updatedFile = await headObject(
    t.context.publicBucket,
    destKey
  );

  t.log(`CUMULUS-970 debugging: start list objects. params: ${JSON.stringify({ Bucket: t.context.publicBucket })}`);

  const objects = await s3().listObjects({ Bucket: t.context.publicBucket });

  t.log('CUMULUS-970 debugging: list objects complete');
  return { existingFile, updatedFile, objects, output, destKey, content };
}

function updateCmrFileType(payload) {
  payload.input.granules.forEach(
    (g) => {
      g.files.filter(isCMRFile).forEach((cmrFile) => {
        cmrFile.type = 'userSetType';
      });
    }
  );
}

function granulesToFileURIs(stagingBucket, granules) {
  const files = granules.reduce((arr, g) => arr.concat(g.files), []);
  return files.map((file) => buildS3Uri(stagingBucket, file.key));
}

function getExpectedOutputFileKeys() {
  return [
    'example/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
    'jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
    'example/2003/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
    'example/2003/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
  ];
}
/**
 * Get file metadata for a set of files.
 * headObject from localstack doesn't return LastModified with millisecond,
 * use listObjectsV2 instead
 *
 * @param {Array<Object>} files - array of file objects
 * @returns {Promise<Array>} - file detail responses
 */
async function getFilesMetadata(files) {
  const getFileRequests = files.map(async (f) => {
    const s3list = await listS3ObjectsV2(
      { Bucket: f.bucket, Prefix: f.Key }
    );
    const s3object = s3list.filter((s3file) => s3file.Key === f.key);

    return {
      key: f.key,
      size: s3object[0].Size,
      LastModified: s3object[0].LastModified,
    };
  });
  return await Promise.all(getFileRequests);
}

test.beforeEach(async (t) => {
  t.context.stagingBucket = randomId('staging');
  t.context.publicBucket = randomId('public');
  t.context.protectedBucket = randomId('protected');
  t.context.systemBucket = randomId('system');
  t.context.stackName = 'moveGranulesTestStack';

  await Promise.all([
    s3().createBucket({ Bucket: t.context.stagingBucket }),
    s3().createBucket({ Bucket: t.context.publicBucket }),
    s3().createBucket({ Bucket: t.context.protectedBucket }),
    s3().createBucket({ Bucket: t.context.systemBucket }),
  ]);
  process.env.system_bucket = t.context.systemBucket;
  process.env.stackName = t.context.stackName;
  putJsonS3Object(
    t.context.systemBucket,
    getDistributionBucketMapKey(t.context.stackName),
    {
      [t.context.stagingBucket]: t.context.stagingBucket,
      [t.context.publicBucket]: t.context.publicBucket,
      [t.context.protectedBucket]: t.context.protectedBucket,
      [t.context.systemBucket]: t.context.systemBucket,
    }
  );

  const payloadPath = path.join(__dirname, 'data', 'payload.json');
  const rawPayload = fs.readFileSync(payloadPath, 'utf8');
  t.context.payload = JSON.parse(rawPayload);
  const filesToUpload = granulesToFileURIs(
    t.context.stagingBucket,
    t.context.payload.input.granules
  );
  t.context.filesToUpload = filesToUpload;
  process.env.REINGEST_GRANULE = false;

  t.context.checkCrossCollectionCollisionStub = sinon
    .stub()
    .returns({
      body: JSON.stringify({
        granuleId: 'granuleId',
        collectionId: 'totallyDifferentCollection',
      }),
    });

  t.context.overrideCollisionObject = {
    getFileGranuleAndCollectionByBucketAndKeyMethod:
    t.context.checkCrossCollectionCollisionStub,
  };

  t.context.checkCrossCollectionNoCollisionStub = sinon.stub().returns({
    body: JSON.stringify({
      granuleId: 'granuleId',
      collectionId: constructCollectionId(
        t.context.payload.config.collection.name,
        t.context.payload.config.collection.version
      ),
    }),
  });

  t.context.overrideNoCollisionObject = {
    getFileGranuleAndCollectionByBucketAndKeyMethod:
    t.context.checkCrossCollectionNoCollisionStub,
  };
});

test.afterEach.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.publicBucket);
  await recursivelyDeleteS3Bucket(t.context.stagingBucket);
  await recursivelyDeleteS3Bucket(t.context.protectedBucket);
  await recursivelyDeleteS3Bucket(t.context.systemBucket);
});

test.serial('Should move files to final location.', async (t) => {
  const newPayload = buildPayload(t);
  const filesToUpload = cloneDeep(t.context.filesToUpload);
  await uploadFiles(filesToUpload, t.context.stagingBucket);

  const output = await moveGranules(newPayload);
  await validateOutput(t, output);

  const check = await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
  });

  t.true(check);
});

test.serial('should not move files when event.moveStagedFiles is false', async (t) => {
  const newPayload = buildPayload(t);
  newPayload.config.moveStagedFiles = false;
  const filesToUpload = cloneDeep(t.context.filesToUpload);

  await uploadFiles(filesToUpload, t.context.stagingBucket);

  const output = await moveGranules(newPayload);
  await validateOutput(t, output);

  const check = await s3ObjectExists({
    Bucket: t.context.publicBucket,
    Key: 'jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
  });

  t.false(check);
});

test.serial('should add input files to returned granule event.moveStagedFiles is false', async (t) => {
  const newPayload = buildPayload(t);
  const filesToUpload = cloneDeep(t.context.filesToUpload);

  await uploadFiles(filesToUpload, t.context.stagingBucket);
  newPayload.config.moveStagedFiles = false;

  const inputFiles = newPayload.input.granules[0].files.map((f) => f.key);

  const output = await moveGranules(newPayload);
  await validateOutput(t, output);

  const outputFileKeys = output.granules[0].files.map((f) => f.key);

  t.true(output.granules[0].files.length === 4);
  inputFiles.forEach((newFile) => t.true(outputFileKeys.includes(newFile), `${newFile} not found in ${JSON.stringify(output.granules[0].files)}`));
});

test.serial('Should move renamed files in staging area to final location.', async (t) => {
  const newPayload = buildPayload(t);
  const filesToUpload = cloneDeep(t.context.filesToUpload);

  const renamedFile = `s3://${t.context.stagingBucket}/file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.hdf.v20180926T131408705`;
  filesToUpload.push(renamedFile);
  await uploadFiles(filesToUpload, t.context.stagingBucket);
  newPayload.input.granules[0].files.push({
    bucket: t.context.stagingBucket,
    key: 'file-staging/subdir/MOD11A1.A2017200.h19v04.006.2017201090724.hdf.v20180926T131408705',
  });

  const output = await moveGranules(newPayload);
  await validateOutput(t, output);

  const check = await s3ObjectExists({
    Bucket: t.context.protectedBucket,
    Key: 'example/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf.v20180926T131408705',
  });
  t.true(check);
});

test.serial('Should add metadata type to CMR granule files.', async (t) => {
  const newPayload = buildPayload(t);
  const filesToUpload = cloneDeep(t.context.filesToUpload);

  await uploadFiles(filesToUpload, t.context.stagingBucket);
  const output = await moveGranules(newPayload);

  const outputFiles = output.granules[0].files;
  const cmrOutputFiles = outputFiles.filter(isCMRFile);
  cmrOutputFiles.forEach((file) => {
    t.is('metadata', file.type);
  });
  t.is(1, cmrOutputFiles.length);
});

test.serial('Should update filenames with updated S3 URLs.', async (t) => {
  const newPayload = buildPayload(t);
  const expectedFileKeys = getExpectedOutputFileKeys(t);
  const filesToUpload = cloneDeep(t.context.filesToUpload);

  await uploadFiles(filesToUpload, t.context.stagingBucket);

  const output = await moveGranules(newPayload);
  const outputFileKeys = output.granules[0].files.map((f) => f.key);
  t.deepEqual(expectedFileKeys.sort(), outputFileKeys.sort());
});

test.serial('Should overwrite files when duplicateHandling is set to "replace" and "checkCrossCollectionCollisions" is set to "false"', async (t) => {
  t.context.configOverride = { checkCrossCollectionCollisions: false };
  const {
    objects,
    existingFile,
    updatedFile,
    output,
    destKey,
    content,
  } = await overwriteGranuleFilesTest(t);

  t.is(objects.Contents.length, 1);

  const item = objects.Contents[0];
  t.is(item.Key, destKey);

  const existingModified = new Date(existingFile.LastModified).getTime();
  const itemModified = new Date(item.LastModified).getTime();
  t.true(itemModified >= existingModified);

  t.is(updatedFile.ContentLength, content.length);
  t.true(
    output.granuleDuplicates[output.granules[0].granuleId].files.includes(
      output.granules[0].files[0]
    )
  );
});

test.serial('Should overwrite files when duplicateHandling is set to "replace" and "checkCrossCollectionCollisions" is set to default and no collision is present', async (t) => {
  const {
    objects,
    existingFile,
    updatedFile,
    output,
    destKey,
    content,
  } = await overwriteGranuleFilesTest(t, t.context.overrideNoCollisionObject);

  t.is(objects.Contents.length, 1);

  const item = objects.Contents[0];
  t.is(item.Key, destKey);

  const existingModified = new Date(existingFile.LastModified).getTime();
  const itemModified = new Date(item.LastModified).getTime();
  t.true(itemModified >= existingModified);

  t.is(updatedFile.ContentLength, content.length);
  t.true(
    output.granuleDuplicates[output.granules[0].granuleId].files.includes(
      output.granules[0].files[0]
    )
  );
});

test.serial('Should throw InvalidArgument when duplicateHandling is set to "replace" and "crossCheckCollections" is set to default with a collision', async (t) => {
  await t.throwsAsync(
    overwriteGranuleFilesTest(
      t,
      t.context.overrideCollisionObject
    ),
    { instanceOf: InvalidArgument }
  );
});

test.serial('Should not overwrite CMR file type if already explicitly set', async (t) => {
  const newPayload = buildPayload(t);
  updateCmrFileType(newPayload);

  const filesToUpload = cloneDeep(t.context.filesToUpload);

  await uploadFiles(filesToUpload, t.context.stagingBucket);

  const output = await moveGranules(newPayload);
  const cmrFile = output.granules[0].files.filter(isCMRFile);
  t.is('userSetType', cmrFile[0].type);
});

test.serial('when duplicateHandling is not specified, and "crossCheckCollections" is set to "false", throw correct error on duplicate', async (t) => {
  t.context.configOverride = { checkCrossCollectionCollisions: false };
  await duplicateHandlingErrorTest({ t });
});

test.serial('when duplicateHandling is not specified, and "crossCheckCollections" is set to default without a duplicate throw correct error on duplicate', async (t) => {
  t.context.configOverride = { checkCrossCollectionCollisions: false };
  await duplicateHandlingErrorTest({ t, testOverrides: t.context.overrideNoCollisionObject });
});

test.serial('when duplicateHandling is not specified, and "crossCheckCollections" is set to default with duplicate, throw correct error on duplicate', async (t) => {
  await duplicateHandlingErrorTest({
    t,
    testOverrides: t.context.overrideCollisionObject,
    errorType: InvalidArgument,
    expectedErrorMessage: InvalidArgumentErrorRegex,
  });
});

test.serial('when duplicateHandling is "error", and "crossCheckCollections" is set to "false" throw correct error on duplicate', async (t) => {
  t.context.configOverride = { checkCrossCollectionCollisions: false };
  await duplicateHandlingErrorTest({ t, duplicateHandling: 'error' });
});

test.serial('when duplicateHandling is "error", and "crossCheckCollections" is set to default with no collision throw correct error on duplicate', async (t) => {
  t.context.configOverride = { checkCrossCollectionCollisions: false };
  await duplicateHandlingErrorTest({ t, duplicateHandling: 'error', testOverrides: t.context.overrideNoCollisionObject });
});

test.serial('when duplicateHandling is "error", and "crossCheckCollections" is set to default with a collision, throw correct error on duplicate', async (t) => {
  await duplicateHandlingErrorTest({
    t,
    duplicateHandling: 'error',
    testOverrides: t.context.overrideCollisionObject,
    errorType: InvalidArgument,
    expectedErrorMessage: InvalidArgumentErrorRegex,
  });
});

test.serial('when duplicateHandling is "version", and "crossCheckCollections" is set to "false" with a cross granule duplicate, keep both data if different', async (t) => {
  t.context.configOverride = { checkCrossCollectionCollisions: false };

  let newPayload = buildPayload(t);
  const filesToUpload = cloneDeep(t.context.filesToUpload);

  newPayload.config.duplicateHandling = 'version';

  // payload could be modified
  const newPayloadOrig = cloneDeep(newPayload);

  const expectedFileKeys = getExpectedOutputFileKeys(t);

  await uploadFiles(filesToUpload, t.context.stagingBucket);
  let output = await moveGranules(newPayload);
  const existingFileKeys = output.granules[0].files.map((f) => f.key);
  t.deepEqual(expectedFileKeys.sort(), existingFileKeys.sort());

  const outputHdfFile = output.granules[0].files.filter((f) => f.key.endsWith('.hdf'))[0];
  const existingHdfFileInfo = await headObject(outputHdfFile.bucket, outputHdfFile.key);

  // When it encounters data with a duplicated filename with duplicate checksum,
  // it does not create a copy of the file.

  // When it encounters data with a dupliated filename with different checksum,
  // it moves the existing data to a file with a suffix to distinguish it from the new file

  // run 'moveGranules' again with one of the input files updated
  newPayload = cloneDeep(newPayloadOrig);
  await uploadFiles(filesToUpload, t.context.stagingBucket);

  const inputHdfFile = filesToUpload.filter((f) => f.endsWith('.hdf'))[0];
  const updatedBody = randomString();
  const params = {
    Bucket: t.context.stagingBucket, Key: parseS3Uri(inputHdfFile).Key, Body: updatedBody,
  };
  await s3().putObject(params);

  output = await moveGranules(newPayload);
  const currentFileKeys = output.granules[0].files.map((f) => f.key);
  t.is(currentFileKeys.length, 5);

  // the extra file is the renamed hdf file
  let extraFiles = currentFileKeys.filter((f) => !existingFileKeys.includes(f));
  t.is(extraFiles.length, 1);
  t.true(extraFiles[0].includes(`${path.basename(outputHdfFile.key)}.v`));

  // the existing hdf file gets renamed
  const renamedFile = output.granules[0].files.find((f) => f.key === extraFiles[0]);
  const renamedHdfFileInfo = await headObject(renamedFile.bucket, renamedFile.key);

  t.deepEqual(
    renamedHdfFileInfo,
    {
      ...existingHdfFileInfo,
      LastModified: renamedHdfFileInfo.LastModified,
      $metadata: renamedHdfFileInfo.$metadata,
    }
  );

  // new hdf file is moved to destination
  const newHdfFileInfo = await headObject(outputHdfFile.bucket, outputHdfFile.key);

  t.is(newHdfFileInfo.ContentLength, updatedBody.length);

  // run 'moveGranules' the third time with the same input file updated
  newPayload = cloneDeep(newPayloadOrig);
  await uploadFiles(filesToUpload, t.context.stagingBucket);

  params.Body = randomString();
  await s3().putObject(params);

  output = await moveGranules(newPayload);
  const lastFileKeys = output.granules[0].files.map((f) => f.key);
  t.is(lastFileKeys.length, 6);

  // the extra files are the renamed hdf files
  extraFiles = lastFileKeys.filter((f) => !existingFileKeys.includes(f));
  t.is(extraFiles.length, 2);
  extraFiles.forEach((f) => t.true(f.includes(`${path.basename(outputHdfFile.key)}.v`)));

  output.granules[0].files.forEach((f) => {
    if (f.key.includes(`${path.basename(outputHdfFile.key)}.v`) || isCMRFile(f)) {
      t.false(output.granuleDuplicates[output.granules[0].granuleId].files.includes(f));
    } else {
      t.true(output.granuleDuplicates[output.granules[0].granuleId].files.includes(f));
    }
  });
});

test.serial('when duplicateHandling is "version", and "crossCheckCollections" is set to default with a collision, keep both data if different', async (t) => {
  let newPayload = buildPayload(t);
  const filesToUpload = cloneDeep(t.context.filesToUpload);

  newPayload.config.duplicateHandling = 'version';

  // payload could be modified
  const newPayloadOrig = cloneDeep(newPayload);

  const expectedFileKeys = getExpectedOutputFileKeys(t);

  await uploadFiles(filesToUpload, t.context.stagingBucket);
  let output = await moveGranules(newPayload);
  const existingFileKeys = output.granules[0].files.map((f) => f.key);
  t.deepEqual(expectedFileKeys.sort(), existingFileKeys.sort());

  const outputHdfFile = output.granules[0].files.filter((f) => f.key.endsWith('.hdf'))[0];
  const existingHdfFileInfo = await headObject(outputHdfFile.bucket, outputHdfFile.key);

  // When it encounters data with a duplicated filename with duplicate checksum,
  // it does not create a copy of the file.

  // When it encounters data with a dupliated filename with different checksum,
  // it moves the existing data to a file with a suffix to distinguish it from the new file

  // run 'moveGranules' again with one of the input files updated
  newPayload = cloneDeep(newPayloadOrig);
  await uploadFiles(filesToUpload, t.context.stagingBucket);

  const inputHdfFile = filesToUpload.filter((f) => f.endsWith('.hdf'))[0];
  const updatedBody = randomString();
  const params = {
    Bucket: t.context.stagingBucket, Key: parseS3Uri(inputHdfFile).Key, Body: updatedBody,
  };
  await s3().putObject(params);

  output = await moveGranules({
    ...newPayload,
    testOverrides: t.context.overrideNoCollisionObject,
  });
  const currentFileKeys = output.granules[0].files.map((f) => f.key);
  t.is(currentFileKeys.length, 5);

  // the extra file is the renamed hdf file
  let extraFiles = currentFileKeys.filter((f) => !existingFileKeys.includes(f));
  t.is(extraFiles.length, 1);
  t.true(extraFiles[0].includes(`${path.basename(outputHdfFile.key)}.v`));

  // the existing hdf file gets renamed
  const renamedFile = output.granules[0].files.find((f) => f.key === extraFiles[0]);
  const renamedHdfFileInfo = await headObject(renamedFile.bucket, renamedFile.key);

  t.deepEqual(
    renamedHdfFileInfo,
    {
      ...existingHdfFileInfo,
      LastModified: renamedHdfFileInfo.LastModified,
      $metadata: renamedHdfFileInfo.$metadata,
    }
  );

  // new hdf file is moved to destination
  const newHdfFileInfo = await headObject(outputHdfFile.bucket, outputHdfFile.key);

  t.is(newHdfFileInfo.ContentLength, updatedBody.length);

  // run 'moveGranules' the third time with the same input file updated
  newPayload = cloneDeep(newPayloadOrig);
  await uploadFiles(filesToUpload, t.context.stagingBucket);

  params.Body = randomString();
  await s3().putObject(params);

  output = await moveGranules({
    ...newPayload,
    testOverrides: t.context.overrideNoCollisionObject,
  });
  const lastFileKeys = output.granules[0].files.map((f) => f.key);
  t.is(lastFileKeys.length, 6);

  // the extra files are the renamed hdf files
  extraFiles = lastFileKeys.filter((f) => !existingFileKeys.includes(f));
  t.is(extraFiles.length, 2);
  extraFiles.forEach((f) => t.true(f.includes(`${path.basename(outputHdfFile.key)}.v`)));

  output.granules[0].files.forEach((f) => {
    if (f.key.includes(`${path.basename(outputHdfFile.key)}.v`) || isCMRFile(f)) {
      t.false(output.granuleDuplicates[output.granules[0].granuleId].files.includes(f));
    } else {
      t.true(output.granuleDuplicates[output.granules[0].granuleId].files.includes(f));
    }
  });
});

test.serial('when duplicateHandling is "version", and "crossCheckCollections" is set to default with a collision, throw expected error', async (t) => {
  await duplicateHandlingErrorTest({
    t,
    duplicateHandling: 'version',
    testOverrides: {
      getFileGranuleAndCollectionByBucketAndKeyMethod:
        t.context.checkCrossCollectionCollisionStub,
    },
    errorType: InvalidArgument,
    expectedErrorMessage: InvalidArgumentErrorRegex,
  });
});

test.serial('When duplicateHandling is "skip", and "crossCheckCollections" is set to default  without a collision, does not overwrite or create new', async (t) => {
  t.context.configOverride = { checkCrossCollectionCollisions: false };
  let newPayload = buildPayload(t);
  newPayload.config.duplicateHandling = 'skip';
  const filesToUpload = cloneDeep(t.context.filesToUpload);

  // payload could be modified
  const newPayloadOrig = cloneDeep(newPayload);

  const expectedFileKeys = getExpectedOutputFileKeys(t);

  await uploadFiles(filesToUpload, t.context.stagingBucket);
  let output = await moveGranules(newPayload);
  const existingFileKeys = output.granules[0].files.map((f) => f.key);
  t.deepEqual(expectedFileKeys.sort(), existingFileKeys.sort());

  const outputHdfFile = output.granules[0].files.filter((f) => f.key.endsWith('.hdf'))[0];
  const existingHdfFileInfo = await headObject(outputHdfFile.bucket, outputHdfFile.key);

  // run 'moveGranules' again with one of the input files updated
  newPayload = cloneDeep(newPayloadOrig);
  await uploadFiles(filesToUpload, t.context.stagingBucket);

  const inputHdfFile = filesToUpload.filter((f) => f.endsWith('.hdf'))[0];
  const updatedBody = randomString();
  const params = {
    Bucket: t.context.stagingBucket, Key: parseS3Uri(inputHdfFile).Key, Body: updatedBody,
  };
  await s3().putObject(params);

  output = await moveGranules(newPayload);
  const currentFileKeys = output.granules[0].files.map((f) => f.key);
  t.deepEqual(expectedFileKeys.sort(), currentFileKeys.sort());

  // does not overwrite
  const currentHdfFileInfo = await headObject(outputHdfFile.bucket, outputHdfFile.key);

  t.is(existingHdfFileInfo.ContentLength, currentHdfFileInfo.ContentLength);
  t.not(currentHdfFileInfo.ContentLength, updatedBody.length);

  output.granules[0].files.forEach((f) => {
    if (isCMRFile(f)) {
      t.false(output.granuleDuplicates[output.granules[0].granuleId].files.includes(f));
    } else {
      t.true(output.granuleDuplicates[output.granules[0].granuleId].files.includes(f));
    }
  });
});

test.serial('When duplicateHandling is "skip", and "crossCheckCollections" is set to "false", does not overwrite or create new.', async (t) => {
  t.context.configOverride = { checkCrossCollectionCollisions: false };
  let newPayload = buildPayload(t);
  newPayload.config.duplicateHandling = 'skip';
  const filesToUpload = cloneDeep(t.context.filesToUpload);

  // payload could be modified
  const newPayloadOrig = cloneDeep(newPayload);

  const expectedFileKeys = getExpectedOutputFileKeys(t);

  await uploadFiles(filesToUpload, t.context.stagingBucket);
  let output = await moveGranules(newPayload);
  const existingFileKeys = output.granules[0].files.map((f) => f.key);
  t.deepEqual(expectedFileKeys.sort(), existingFileKeys.sort());

  const outputHdfFile = output.granules[0].files.filter((f) => f.key.endsWith('.hdf'))[0];
  const existingHdfFileInfo = await headObject(outputHdfFile.bucket, outputHdfFile.key);

  // run 'moveGranules' again with one of the input files updated
  newPayload = cloneDeep(newPayloadOrig);
  await uploadFiles(filesToUpload, t.context.stagingBucket);

  const inputHdfFile = filesToUpload.filter((f) => f.endsWith('.hdf'))[0];
  const updatedBody = randomString();
  const params = {
    Bucket: t.context.stagingBucket, Key: parseS3Uri(inputHdfFile).Key, Body: updatedBody,
  };
  await s3().putObject(params);

  output = await moveGranules(newPayload);
  const currentFileKeys = output.granules[0].files.map((f) => f.key);
  t.deepEqual(expectedFileKeys.sort(), currentFileKeys.sort());

  // does not overwrite
  const currentHdfFileInfo = await headObject(outputHdfFile.bucket, outputHdfFile.key);

  t.is(existingHdfFileInfo.ContentLength, currentHdfFileInfo.ContentLength);
  t.not(currentHdfFileInfo.ContentLength, updatedBody.length);

  output.granules[0].files.forEach((f) => {
    if (isCMRFile(f)) {
      t.false(output.granuleDuplicates[output.granules[0].granuleId].files.includes(f));
    } else {
      t.true(output.granuleDuplicates[output.granules[0].granuleId].files.includes(f));
    }
  });
});

test.serial('When duplicateHandling is "skip", and "crossCheckCollections" is set to default with no collision, does not overwrite or create new.', async (t) => {
  let newPayload = buildPayload(t);
  newPayload.config.duplicateHandling = 'skip';
  const filesToUpload = cloneDeep(t.context.filesToUpload);

  // payload could be modified
  const newPayloadOrig = cloneDeep(newPayload);

  const expectedFileKeys = getExpectedOutputFileKeys(t);

  await uploadFiles(filesToUpload, t.context.stagingBucket);
  let output = await moveGranules(newPayload);
  const existingFileKeys = output.granules[0].files.map((f) => f.key);
  t.deepEqual(expectedFileKeys.sort(), existingFileKeys.sort());

  const outputHdfFile = output.granules[0].files.filter((f) => f.key.endsWith('.hdf'))[0];
  const existingHdfFileInfo = await headObject(outputHdfFile.bucket, outputHdfFile.key);

  // run 'moveGranules' again with one of the input files updated
  newPayload = cloneDeep(newPayloadOrig);
  await uploadFiles(filesToUpload, t.context.stagingBucket);

  const inputHdfFile = filesToUpload.filter((f) => f.endsWith('.hdf'))[0];
  const updatedBody = randomString();
  const params = {
    Bucket: t.context.stagingBucket, Key: parseS3Uri(inputHdfFile).Key, Body: updatedBody,
  };
  await s3().putObject(params);

  output = await moveGranules({
    ...newPayload,
    testOverrides: t.context.overrideNoCollisionObject,
  });
  const currentFileKeys = output.granules[0].files.map((f) => f.key);
  t.deepEqual(expectedFileKeys.sort(), currentFileKeys.sort());

  // does not overwrite
  const currentHdfFileInfo = await headObject(outputHdfFile.bucket, outputHdfFile.key);

  t.is(existingHdfFileInfo.ContentLength, currentHdfFileInfo.ContentLength);
  t.not(currentHdfFileInfo.ContentLength, updatedBody.length);

  output.granules[0].files.forEach((f) => {
    if (isCMRFile(f)) {
      t.false(output.granuleDuplicates[output.granules[0].granuleId].files.includes(f));
    } else {
      t.true(output.granuleDuplicates[output.granules[0].granuleId].files.includes(f));
    }
  });
});

function setupDuplicateHandlingConfig(t, duplicateHandling, forceDuplicateOverwrite) {
  const payload = buildPayload(t);
  payload.config.duplicateHandling = duplicateHandling;
  set(payload, 'cumulus_config.cumulus_context.forceDuplicateOverwrite', forceDuplicateOverwrite);
  return payload;
}

function setupDuplicateHandlingCollection(t, duplicateHandling) {
  const payload = buildPayload(t);
  set(payload, 'config.collection.duplicateHandling', duplicateHandling);
  return payload;
}

async function granuleFilesOverwrittenTest(t, newPayload, testOverrides = {}) {
  // payload could be modified
  const newPayloadOrig = cloneDeep(newPayload);
  const filesToUpload = cloneDeep(t.context.filesToUpload);

  const expectedFileKeys = getExpectedOutputFileKeys(t);

  await uploadFiles(filesToUpload, t.context.stagingBucket);
  let output = await moveGranules(newPayload);
  await validateOutput(t, output);
  const existingFileKeys = output.granules[0].files.map((f) => f.key);
  t.deepEqual(expectedFileKeys.sort(), existingFileKeys.sort());

  const existingFilesMetadata = await getFilesMetadata(output.granules[0].files);

  const outputHdfFile = existingFileKeys.filter((f) => f.endsWith('.hdf'))[0];

  // run 'moveGranules' again with one of the input files updated
  newPayload = cloneDeep(newPayloadOrig);
  await uploadFiles(filesToUpload, t.context.stagingBucket);

  const inputHdfFile = filesToUpload.filter((f) => f.endsWith('.hdf'))[0];
  const updatedBody = randomString();
  const params = {
    Bucket: t.context.stagingBucket, Key: parseS3Uri(inputHdfFile).Key, Body: updatedBody,
  };
  await s3().putObject(params);

  output = await moveGranules({ ...newPayload, testOverrides });
  const currentFileKeys = output.granules[0].files.map((f) => f.key);
  t.is(currentFileKeys.length, 4);

  const currentFilesMetadata = await getFilesMetadata(output.granules[0].files);

  const currentHdfFileMeta = currentFilesMetadata.filter((f) => f.key === outputHdfFile)[0];
  t.is(currentHdfFileMeta.size, updatedBody.length);

  // check timestamps are updated
  currentFilesMetadata.forEach((f) => {
    const existingFileMeta = existingFilesMetadata.filter((ef) => ef.key === f.key)[0];
    t.true(new Date(f.LastModified).getTime() >= new Date(existingFileMeta.LastModified).getTime());
  });

  output.granules[0].files.forEach((f) => {
    if (f.key.includes(`${path.basename(outputHdfFile)}.v`) || isCMRFile(f)) {
      t.false(output.granuleDuplicates[output.granules[0].granuleId].files.includes(f));
    } else {
      t.true(output.granuleDuplicates[output.granules[0].granuleId].files.includes(f));
    }
  });
}

test.serial('when collection is set as part of the granule instead of in the task configuration, and crossCheckCollections is set, take the expected action', async (t) => {
  t.context.configOverride = { checkCrossCollectionCollisions: false };
  const payload = setupDuplicateHandlingConfig(t, 'replace');
  set(payload, 'input.granules[0].dataType', 'testDataType');
  set(payload, 'input.granules[0].version', 'testVersion');
  delete payload.config.dataType;
  delete payload.config.version;
  await granuleFilesOverwrittenTest(t, payload, t.context.overrideNoCollisionObject);
});

test.serial('when duplicateHandling is "replace", and "crossCheckCollections" is set to "false", do overwrite files', async (t) => {
  t.context.configOverride = { checkCrossCollectionCollisions: false };
  const payload = setupDuplicateHandlingConfig(t, 'replace');
  await granuleFilesOverwrittenTest(t, payload);
});

test.serial('when duplicateHandling is "replace", and "crossCheckCollections" is set to default with a collision, fail with expected error', async (t) => {
  const payload = setupDuplicateHandlingConfig(t, 'replace');
  await t.throwsAsync(granuleFilesOverwrittenTest(t, payload, t.context.overrideCollisionObject), {
    instanceOf: InvalidArgument,
    message: InvalidArgumentErrorRegex,
  });
});

test.serial('when duplicateHandling is "replace", and "crossCheckCollections" is set to default without a collision, do overwrite files', async (t) => {
  const payload = setupDuplicateHandlingConfig(t, 'replace');
  await granuleFilesOverwrittenTest(t, payload, t.context.overrideNoCollisionObject);
});

test.serial('when duplicateHandling is "error" and forceDuplicateOverwrite is true, and "crossCheckCollections" is set to "false", do overwrite files', async (t) => {
  t.context.configOverride = { checkCrossCollectionCollisions: false };
  const payload = setupDuplicateHandlingConfig(t, 'error', true);
  await granuleFilesOverwrittenTest(t, payload);
});

test.serial('when duplicateHandling is "error" and forceDuplicateOverwrite is true,  and "crossCheckCollections" is set to default with a collision throw expected error', async (t) => {
  const payload = setupDuplicateHandlingConfig(t, 'error', true);
  await t.throwsAsync(granuleFilesOverwrittenTest(t, payload, t.context.overrideCollisionObject), {
    instanceOf: InvalidArgument,
    message: InvalidArgumentErrorRegex,
  });
});

test.serial('when duplicateHandling is "error" and forceDuplicateOverwrite is true, and  and "crossCheckCollections" is set to default without a collision, do overwrite files', async (t) => {
  const payload = setupDuplicateHandlingConfig(t, 'error', true);
  await granuleFilesOverwrittenTest(t, payload, t.context.overrideNoCollisionObject);
});

test.serial('when duplicateHandling is "skip" and forceDuplicateOverwrite is true, and "crossCheckCollections" is set to "false", do overwrite files', async (t) => {
  t.context.configOverride = { checkCrossCollectionCollisions: false };
  const payload = setupDuplicateHandlingConfig(t, 'skip', true);
  await granuleFilesOverwrittenTest(t, payload);
});

test.serial('when duplicateHandling is "skip" and forceDuplicateOverwrite is true, and "crossCheckCollections" is set to default with a collision, throw expected error', async (t) => {
  const payload = setupDuplicateHandlingConfig(t, 'skip', true);
  await t.throwsAsync(granuleFilesOverwrittenTest(t, payload, t.context.overrideCollisionObject), {
    instanceOf: InvalidArgument,
    message: InvalidArgumentErrorRegex,
  });
});

test.serial('when duplicateHandling is "skip" and forceDuplicateOverwrite is true, and "crossCheckCollections" is set to default without a collision, do overwrite files', async (t) => {
  const payload = setupDuplicateHandlingConfig(t, 'skip', true);
  await granuleFilesOverwrittenTest(t, payload, t.context.overrideNoCollisionObject);
});

test.serial('when duplicateHandling is "version" and forceDuplicateOverwrite is true, and "crossCheckCollections" is set to "false", do overwrite files', async (t) => {
  t.context.configOverride = { checkCrossCollectionCollisions: false };
  const payload = setupDuplicateHandlingConfig(t, 'version', true);
  await granuleFilesOverwrittenTest(t, payload);
});

test.serial('when duplicateHandling is "version" and forceDuplicateOverwrite is true, and "crossCheckCollections" is set to default with a collision, do overwrite files', async (t) => {
  const payload = setupDuplicateHandlingConfig(t, 'version', true);
  await t.throwsAsync(granuleFilesOverwrittenTest(t, payload, t.context.overrideCollisionObject), {
    instanceOf: InvalidArgument,
    message: InvalidArgumentErrorRegex,
  });
});

test.serial('when duplicateHandling is "version" and forceDuplicateOverwrite is true, and "crossCheckCollections" is set to default without a collision, do overwrite files', async (t) => {
  const payload = setupDuplicateHandlingConfig(t, 'version', true);
  await granuleFilesOverwrittenTest(t, payload, t.context.overrideNoCollisionObject);
});

test.serial('when duplicateHandling is specified as "replace" via collection, and "crossCheckCollections" is set to "false", do overwrite files', async (t) => {
  t.context.configOverride = { checkCrossCollectionCollisions: false };
  const payload = setupDuplicateHandlingCollection(t, 'replace');
  await granuleFilesOverwrittenTest(t, payload);
});

test.serial('url_path is evaluated correctly when the metadata file is ISO', async (t) => {
  t.context.configOverride = { checkCrossCollectionCollisions: false };
  // redo payload initialization from beforeEach, but for the ISO payload
  const payloadPath = path.join(__dirname, 'data', 'payload_iso.json');
  const rawPayload = fs.readFileSync(payloadPath, 'utf8');
  t.context.payload = JSON.parse(rawPayload);
  const filesToUpload = granulesToFileURIs(
    t.context.stagingBucket,
    t.context.payload.input.granules
  );
  t.context.filesToUpload = filesToUpload.map((file) =>
    buildS3Uri(`${t.context.stagingBucket}`, parseS3Uri(file).Key));

  const newPayload = buildPayload(t);
  await uploadFiles(t.context.filesToUpload, t.context.stagingBucket);

  const output = await moveGranules(newPayload);
  await validateOutput(t, output);

  const expectedKey = 'example/2018/12/08/ATL08_20181208064514_10790104_004_01.h5';
  const outputFile = output.granules[0].files.find((f) => f.key === expectedKey);

  t.is(outputFile.key, expectedKey);

  const check = await s3ObjectExists({
    Bucket: t.context.protectedBucket,
    Key: expectedKey,
  });
  t.true(check);
});

test.serial('url_path is evaluated correctly when collection is configured to use .cmr.xml as metadata file', async (t) => {
  // redo payload initialization from beforeEach, the payload has
  // additional configuration and granule metadata file
  const expectedFileKeys = [
    'example/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
    'jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
    'example/2003/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
    'example/2003/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
    'example/2003/MOD11A1.A2017200.h19v04.006.2017201090724.iso.xml',
  ];

  const payloadPath = path.join(__dirname, 'data', 'payload_echo10_metadata.json');
  const rawPayload = fs.readFileSync(payloadPath, 'utf8');
  t.context.payload = JSON.parse(rawPayload);
  const filesToUpload = granulesToFileURIs(
    t.context.stagingBucket,
    t.context.payload.input.granules
  );
  t.context.filesToUpload = filesToUpload.map((file) =>
    buildS3Uri(`${t.context.stagingBucket}`, parseS3Uri(file).Key));

  const newPayload = buildPayload(t);
  await uploadFiles(t.context.filesToUpload, t.context.stagingBucket);

  const output = await moveGranules(newPayload);
  await validateOutput(t, output);

  const outputFileKeys = output.granules[0].files.map((f) => f.key);
  t.deepEqual(expectedFileKeys.sort(), outputFileKeys.sort());

  const check = await s3ObjectExists({
    Bucket: t.context.protectedBucket,
    Key: 'example/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
  });
  t.true(check);
});

test.serial('url_path is evaluated correctly when collection is configured to use .iso.xml as metadata file', async (t) => {
  // redo payload initialization from beforeEach, the payload has
  // additional configuration and granule metadata file
  const expectedFileKeys = [
    'example/2018/12/08/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
    'jpg/example/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
    'example/2018/12/08/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
    'example/2018/12/08/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
    'example/2018/12/08/MOD11A1.A2017200.h19v04.006.2017201090724.iso.xml',
  ];
  const payloadPath = path.join(__dirname, 'data', 'payload_iso_metadata.json');
  const rawPayload = fs.readFileSync(payloadPath, 'utf8');
  t.context.payload = JSON.parse(rawPayload);
  const filesToUpload = granulesToFileURIs(
    t.context.stagingBucket,
    t.context.payload.input.granules
  );
  t.context.filesToUpload = filesToUpload.map((file) =>
    buildS3Uri(`${t.context.stagingBucket}`, parseS3Uri(file).Key));

  const newPayload = buildPayload(t);
  await uploadFiles(t.context.filesToUpload, t.context.stagingBucket);

  const output = await moveGranules(newPayload);
  await validateOutput(t, output);
  const outputFileKeys = output.granules[0].files.map((f) => f.key);
  t.deepEqual(expectedFileKeys.sort(), outputFileKeys.sort());

  const check = await s3ObjectExists({
    Bucket: t.context.protectedBucket,
    Key: 'example/2018/12/08/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
  });
  t.true(check);
});

test.serial('task config s3MultipartChunksizeMb is used for moving s3 files if specified', async (t) => {
  process.env.default_s3_multipart_chunksize_mb = 256;
  const collectionChunkSizeMb = 16;
  const moveObjectStub = sinon.stub(S3, 'moveObject').resolves();

  const newPayload = buildPayload(t);
  set(newPayload, 'config.s3MultipartChunksizeMb', collectionChunkSizeMb);
  const filesToUpload = cloneDeep(t.context.filesToUpload);

  await uploadFiles(filesToUpload, t.context.stagingBucket);
  await moveGranules(newPayload);
  range(4).map((i) => {
    const args = moveObjectStub.getCall(i).firstArg;
    const expectedChunkSize = isCMRFile({ key: args.sourceKey })
      ? undefined : collectionChunkSizeMb * 1024 * 1024;
    t.is(args.chunkSize, expectedChunkSize);
    return args;
  });

  moveObjectStub.restore();
});

test.serial('default_s3_multipart_chunksize_mb is used for moving s3 files if task config s3MultipartChunksizeMb is not specified', async (t) => {
  process.env.default_s3_multipart_chunksize_mb = 256;
  const moveObjectStub = sinon.stub(S3, 'moveObject').resolves();

  const newPayload = buildPayload(t);
  const filesToUpload = cloneDeep(t.context.filesToUpload);

  await uploadFiles(filesToUpload, t.context.stagingBucket);
  await moveGranules(newPayload);
  range(4).map((i) => {
    const args = moveObjectStub.getCall(i).firstArg;
    const expectedChunkSize = isCMRFile({ key: args.sourceKey })
      ? undefined : process.env.default_s3_multipart_chunksize_mb * 1024 * 1024;
    t.is(args.chunkSize, expectedChunkSize);
    return args;
  });

  moveObjectStub.restore();
});

test.serial('moveGranules throws an error if checkCrossCollectionCollisions is set to true and a cross-collection file collision is detected', async (t) => {
  await t.throwsAsync(
    overwriteGranuleFilesTest(t, {
      getFileGranuleAndCollectionByBucketAndKeyMethod: t.context.checkCrossCollectionCollisionStub,
    }), { instanceOf: InvalidArgument }
  );
});

test.serial('moveGranules throws a ValidationError when no collection information can be determined', async (t) => {
  // Build a payload with minimal configuration and remove collection information
  const newPayload = buildPayload(t);
  delete newPayload.input.granules[0].dataType;
  delete newPayload.input.granules[0].version;
  delete newPayload.config.collection.name;
  delete newPayload.config.collection.version;

  const filesToUpload = cloneDeep(t.context.filesToUpload);
  await uploadFiles(filesToUpload, t.context.stagingBucket);

  await t.throwsAsync(
    moveGranules(newPayload),
    {
      instanceOf: errors.ValidationError,
      message: /Unable to determine collection ID for granule/,
    }
  );
});

test.serial('moveGranules throws ValidationError when only partial collection information is available', async (t) => {
  const partialGranulePayload = buildPayload(t);
  partialGranulePayload.input.granules[0].dataType = 'MOD11A1';
  delete partialGranulePayload.input.granules[0].version;
  delete partialGranulePayload.config.collection.name;
  delete partialGranulePayload.config.collection.version;

  const filesToUpload = cloneDeep(t.context.filesToUpload);
  await uploadFiles(filesToUpload, t.context.stagingBucket);

  await t.throwsAsync(
    moveGranules(partialGranulePayload),
    {
      instanceOf: errors.ValidationError,
      message: /Unable to determine collection ID for granule/,
    }
  );

  // Only name in collection config, no version
  const partialConfigPayload = buildPayload(t);
  delete partialConfigPayload.input.granules[0].dataType;
  delete partialConfigPayload.input.granules[0].version;
  partialConfigPayload.config.collection.name = 'MOD11A1';
  delete partialConfigPayload.config.collection.version;

  await t.throwsAsync(
    moveGranules(partialConfigPayload),
    {
      instanceOf: errors.ValidationError,
      message: /Unable to determine collection ID for granule/,
    }
  );
});

test.serial('moveGranules succeeds when collection information is only available in config', async (t) => {
  const newPayload = buildPayload(t);
  delete newPayload.input.granules[0].dataType;
  delete newPayload.input.granules[0].version;
  newPayload.config.collection.name = 'MOD11A1';
  newPayload.config.collection.version = '006';

  const filesToUpload = cloneDeep(t.context.filesToUpload);
  await uploadFiles(filesToUpload, t.context.stagingBucket);

  const output = await moveGranules(newPayload);
  await validateOutput(t, output);

  const expectedFileKeys = getExpectedOutputFileKeys(t);
  const movedFileKeys = output.granules[0].files.map((f) => f.key);
  t.deepEqual(expectedFileKeys.sort(), movedFileKeys.sort());
});

test.serial('moveGranules should assign metadata type to CMR files that do not already have a type', async (t) => {
  const newPayload = buildPayload(t);
  const filesToUpload = cloneDeep(t.context.filesToUpload);

  await uploadFiles(filesToUpload, t.context.stagingBucket);
  const cmrFile = newPayload.input.granules[0].files.find((file) =>
    file.key.endsWith('.cmr.xml'));
  t.truthy(cmrFile, 'Payload should contain a CMR file');
  if (cmrFile.type) {
    delete cmrFile.type;
  }
  const output = await moveGranules(newPayload);
  await validateOutput(t, output);
  const outputCmrFile = output.granules[0].files.find((file) =>
    file.key.includes('.cmr.xml'));
  t.truthy(outputCmrFile, 'Output should contain a CMR file');
  t.is(outputCmrFile.type, 'metadata', 'CMR file should have type set to metadata');
});

test.serial('moveGranules should only assign metadata type to CMR files and not to other files', async (t) => {
  const newPayload = buildPayload(t);
  const filesToUpload = cloneDeep(t.context.filesToUpload);

  await uploadFiles(filesToUpload, t.context.stagingBucket);
  const output = await moveGranules(newPayload);
  await validateOutput(t, output);
  const outputFiles = output.granules[0].files;
  const cmrFiles = outputFiles.filter((file) => file.key.includes('.cmr.xml'));
  t.truthy(cmrFiles.length > 0, 'Output should contain CMR files');
  cmrFiles.forEach((file) => {
    t.is(file.type, 'metadata', `CMR file ${file.key} should have type set to metadata`);
  });
  const nonCmrFiles = outputFiles.filter((file) =>
    !file.key.includes('.cmr.xml') && !file.key.includes('.iso.xml'));
  t.truthy(nonCmrFiles.length > 0, 'Output should contain non-CMR files');
  nonCmrFiles.forEach((file) => {
    t.falsy(file.type === 'metadata', `Non-CMR file ${file.key} should not have type set to metadata`);
  });
});

test.serial('moveGranules should not overwrite existing type on CMR files', async (t) => {
  const newPayload = buildPayload(t);
  const filesToUpload = cloneDeep(t.context.filesToUpload);

  const cmrFile = newPayload.input.granules[0].files.find((file) =>
    file.key.endsWith('.cmr.xml'));
  t.truthy(cmrFile, 'Payload should contain a CMR file');

  const customType = 'custom-metadata-type';
  cmrFile.type = customType;

  await uploadFiles(filesToUpload, t.context.stagingBucket);

  const output = await moveGranules(newPayload);
  await validateOutput(t, output);

  const outputCmrFile = output.granules[0].files.find((file) =>
    file.key.includes('.cmr.xml'));

  t.is(outputCmrFile.type, customType, 'CMR file should keep its custom type');
  t.not(outputCmrFile.type, 'metadata', 'CMR file should not have its type overwritten with metadata');
});
