'use strict';

const fs = require('fs');
const path = require('path');
const sinon = require('sinon');
const test = require('ava');
const range = require('lodash/range');
const proxyquire = require('proxyquire');
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

const Logger = require('@cumulus/logger');


class FakeLogger extends Logger {
  constructor(options = {}) {
    super({ ...options, console: fakeConsole });
  }
}

const fakeGranulesModule = {
  updateGranule: ({
    granuleId,
    collectionid,
    body: granule,
  }) => {
    return Promise.resolve({
      statusCode: 200,
      body: '{"status": "completed"}',
    });
  }
};

// Import the discover-granules functions that we'll be testing, configuring them to use the fake
// granules module and the fake logger.
const {
  moveGranules,
} = proxyquire(
  '..',
  {
    '@cumulus/api-client/granules': fakeGranulesModule,
    '@cumulus/logger': FakeLogger,
  }
);

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
      params: {
        Bucket: bucket,
        Key: parseS3Uri(file).Key,
        Body: body,
      },
    });
  }));
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

  return newPayload;
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

test.serial('Should overwrite files.', async (t) => {
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

  output = await moveGranules(newPayload);

  t.log('CUMULUS-970 debugging:  move granules complete');

  const updatedFile = await headObject(
    t.context.publicBucket,
    destKey
  );

  t.log(`CUMULUS-970 debugging: start list objects. params: ${JSON.stringify({ Bucket: t.context.publicBucket })}`);

  const objects = await s3().listObjects({ Bucket: t.context.publicBucket });

  t.log('CUMULUS-970 debugging: list objects complete');

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

test.serial('Should not overwrite CMR file type if already explicitly set', async (t) => {
  const newPayload = buildPayload(t);
  updateCmrFileType(newPayload);

  const filesToUpload = cloneDeep(t.context.filesToUpload);

  await uploadFiles(filesToUpload, t.context.stagingBucket);

  const output = await moveGranules(newPayload);
  const cmrFile = output.granules[0].files.filter(isCMRFile);
  t.is('userSetType', cmrFile[0].type);
});

// duplicateHandling has default value 'error' if it's not provided in task configuration and
// collection configuration
async function duplicateHandlingErrorTest(t, duplicateHandling) {
  const newPayload = buildPayload(t);
  const filesToUpload = cloneDeep(t.context.filesToUpload);

  if (duplicateHandling) newPayload.config.duplicateHandling = duplicateHandling;

  await uploadFiles(filesToUpload, t.context.stagingBucket);

  let expectedErrorMessages;
  try {
    await validateConfig(t, newPayload.config);
    await validateInput(t, newPayload.input);

    // payload could be modified
    const newPayloadOrig = cloneDeep(newPayload);

    const output = await moveGranules(newPayload);
    await validateOutput(t, output);

    expectedErrorMessages = output.granules[0].files.map(
      (file) => `${file.key} already exists in ${file.bucket} bucket`
    );

    await uploadFiles(filesToUpload, t.context.stagingBucket);
    await moveGranules(newPayloadOrig);
    t.fail('Expected a DuplicateFile error to be thrown');
  } catch (error) {
    t.true(error instanceof errors.DuplicateFile);
    t.true(expectedErrorMessages.includes(error.message));
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

test.serial('When duplicateHandling is "skip", does not overwrite or create new.', async (t) => {
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

async function granuleFilesOverwrittenTest(t, newPayload) {
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

  output = await moveGranules(newPayload);
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

test.serial('when duplicateHandling is "replace", do overwrite files', async (t) => {
  const payload = setupDuplicateHandlingConfig(t, 'replace');
  await granuleFilesOverwrittenTest(t, payload);
});

test.serial('when duplicateHandling is "error" and forceDuplicateOverwrite is true, do overwrite files', async (t) => {
  const payload = setupDuplicateHandlingConfig(t, 'error', true);
  await granuleFilesOverwrittenTest(t, payload);
});

test.serial('when duplicateHandling is "skip" and forceDuplicateOverwrite is true, do overwrite files', async (t) => {
  const payload = setupDuplicateHandlingConfig(t, 'skip', true);
  await granuleFilesOverwrittenTest(t, payload);
});

test.serial('when duplicateHandling is "version" and forceDuplicateOverwrite is true, do overwrite files', async (t) => {
  const payload = setupDuplicateHandlingConfig(t, 'version', true);
  await granuleFilesOverwrittenTest(t, payload);
});

test.serial('when duplicateHandling is "replace" and forceDuplicateOverwrite is true, do overwrite files', async (t) => {
  const payload = setupDuplicateHandlingConfig(t, 'replace', true);
  await granuleFilesOverwrittenTest(t, payload);
});

test.serial('when duplicateHandling is specified as "replace" via collection, do overwrite files', async (t) => {
  const payload = setupDuplicateHandlingCollection(t, 'replace');
  await granuleFilesOverwrittenTest(t, payload);
});

test.serial('url_path is evaluated correctly when the metadata file is ISO', async (t) => {
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

test.serial('new collection causes granule to move to that collection', async (t) => {
  const newCollection = {
    files: [
      {
        regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
        sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
        bucket: 'protected'
      },
      {
        regex: '^BROWSE\\.MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf$',
        sampleFileName: 'BROWSE.MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
        bucket: 'private'
      },
      {
        regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.hdf\\.met$',
        sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf.met',
        bucket: 'private'
      },
      {
        regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}\\.cmr\\.xml$',
        sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
        bucket: 'public'
      },
      {
        regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_2\\.jpg$',
        sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
        bucket: 'public'
      },
      {
        regex: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}_1\\.jpg$',
        sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
        bucket: 'public',
        url_path: 'jpg/example2/'
      }
    ],
    url_path: 'example2/{extractYear(cmrMetadata.Granule.Temporal.RangeDateTime.BeginningDateTime)}/',
    name: 'MOD11A2',
    granuleId: '^MOD11A1\\.A[\\d]{7}\\.[\\S]{6}\\.006.[\\d]{13}$',
    dataType: 'MOD11A2',
    process: 'modis',
    version: '006',
    sampleFileName: 'MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
    id: 'MOD11A2'
  };
  const filesToUpload = cloneDeep(t.context.filesToUpload);
  await uploadFiles(filesToUpload, t.context.stagingBucket);
  t.context.payload.config.collection = newCollection

  const newPayload = buildPayload(t)
  const expectedFileKeys = [
    'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.hdf',
    'jpg/example2/MOD11A1.A2017200.h19v04.006.2017201090724_1.jpg',
    'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724_2.jpg',
    'example2/2003/MOD11A1.A2017200.h19v04.006.2017201090724.cmr.xml',
  ]


  const output = await moveGranules(newPayload);
  const outputFileKeys = output.granules[0].files.map((f) => f.key);
  t.deepEqual(expectedFileKeys.sort(), outputFileKeys.sort());
  await Promise.all(output.granules[0].files.map(async (fileObj) => {
    t.true(await s3ObjectExists({Bucket: fileObj.bucket, Key: fileObj.key}))
  }))
  
})