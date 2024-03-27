const test = require('ava');
const clone = require('lodash/clone');
const moment = require('moment');
const { randomString } = require('@cumulus/common/test-utils');
const {
  putJsonS3Object,
  createBucket,
  recursivelyDeleteS3Bucket,
  getJsonS3Object,
  s3ObjectExists,
} = require('@cumulus/aws-client/S3');
const {
  getEnvironmentVariable,
  manipulateTrailingSlash,
  updateDLAFile,
  updateDLABatch,
  processArgs,
} = require('../dist');
function storeEnvironment() {
  return clone(process.env);
}
function restoreEnvironment(storedEnvironment) {
  process.env = storedEnvironment;
}

test.serial('getEnvironmentVariable gets your variable or throws trying', (t) => {
  const envStore = storeEnvironment();
  process.env.A = '3';
  t.is(getEnvironmentVariable('A'), '3');
  t.throws(
    () => getEnvironmentVariable('B'),
    { message: 'Environment variable "B" is not set.' }
  );
  restoreEnvironment(envStore);
});

test('manipulateTrailingSlash adds or removes trailing slashes as needed', (t) => {
  /* test 4 expected use cases */
  t.is(manipulateTrailingSlash('a', true), 'a/');
  t.is(manipulateTrailingSlash('a/', true), 'a/');
  t.is(manipulateTrailingSlash('a', false), 'a');
  t.is(manipulateTrailingSlash('a/', false), 'a');
  /* test some potential weird cases */
  t.is(manipulateTrailingSlash('a/sdas/s/dawd//', true), 'a/sdas/s/dawd//');
  t.is(manipulateTrailingSlash('a/sdas/s/dawd//', false), 'a/sdas/s/dawd');
  /* shouldn't append to empty string */
  t.is(manipulateTrailingSlash('', true), '');
});

test.serial('updateDLAFile updates existing files to new structure and skips as requested', async (t) => {
  const bucket = randomString(12);
  const sourcePath = 'a/b';
  const targetPath = 'updated-a/b';
  let actualTargetPath = `updated-a/${moment.utc().format('YYYY-MM-DD')}/b`;
  await createBucket(bucket);
  await putJsonS3Object(
    bucket,
    sourcePath,
    { body: JSON.stringify({ a: 'b' }) }
  );
  t.true(await updateDLAFile(bucket, sourcePath, targetPath, true));
  t.deepEqual(
    await getJsonS3Object(bucket, actualTargetPath),
    {
      body: JSON.stringify({ a: 'b' }),
      collectionId: null,
      error: null,
      executionArn: null,
      granules: null,
      providerId: null,
      stateMachineArn: null,
      status: null,
      time: null,
    }
  );
  await putJsonS3Object(
    bucket,
    sourcePath,
    {
      Body: JSON.stringify({
        time: '2024-03-21T15:09:54Z',
        detail: {
          executionArn: 'abcd',
          stateMachineArn: '1234',
          status: 'RUNNING',
          input: JSON.stringify({
            meta: {
              collection: {
                name: 'A_COLLECTION',
                version: '12',
              },
              provider: {
                id: 'abcd',
                protocol: 'a',
                host: 'b',
              },
            },
            payload: {
              granules: [{ granuleId: 'a' }],
            },
          }),
        },
      }),
    }
  );
  t.true(await updateDLAFile(bucket, sourcePath, targetPath));
  actualTargetPath = 'updated-a/2024-03-21/b';

  t.deepEqual(
    await getJsonS3Object(bucket, actualTargetPath),
    {
      Body: JSON.stringify({
        time: '2024-03-21T15:09:54Z',
        detail: {
          executionArn: 'abcd',
          stateMachineArn: '1234',
          status: 'RUNNING',
          input: JSON.stringify({
            meta: {
              collection: {
                name: 'A_COLLECTION',
                version: '12',
              },
              provider: {
                id: 'abcd',
                protocol: 'a',
                host: 'b',
              },
            },
            payload: {
              granules: [{ granuleId: 'a' }],
            },
          }),
        },
      }),
      collectionId: 'A_COLLECTION___12',
      error: null,
      executionArn: 'abcd',
      granules: ['a'],
      providerId: 'abcd',
      stateMachineArn: '1234',
      status: 'RUNNING',
      time: '2024-03-21T15:09:54Z',
    }
  );
  t.false(await updateDLAFile(bucket, sourcePath, targetPath, true));
  t.true(await updateDLAFile(bucket, sourcePath, targetPath, false));
  await recursivelyDeleteS3Bucket(bucket);
});
test.serial('updateDLAFile identifies whether or not date identifier needs to be added', async (t) => {
  const bucket = randomString(12);
  const sourcePath = 'a/b';
  let targetPath = 'updated-a/b';
  let actualTargetPath = 'updated-a/2024-03-21/b';
  await createBucket(bucket);
  await putJsonS3Object(
    bucket,
    sourcePath,
    {
      Body: JSON.stringify({
        time: '2024-03-21T15:09:54Z',
        detail: {
          executionArn: 'abcd',
          stateMachineArn: '1234',
          status: 'RUNNING',
          input: JSON.stringify({
            meta: {
              collection: {
                name: 'A_COLLECTION',
                version: '12',
              },
              provider: {
                id: 'abcd',
                protocol: 'a',
                host: 'b',
              },
            },
            payload: {
              granules: [{ granuleId: 'a' }],
            },
          }),
        },
      }),
    }
  );
  await updateDLAFile(bucket, sourcePath, targetPath);
  t.true(await s3ObjectExists({ Bucket: bucket, Key: actualTargetPath }));

  targetPath = 'updated-a/2023-04-21/b';
  actualTargetPath = targetPath;
  await updateDLAFile(bucket, sourcePath, targetPath);
  t.true(await s3ObjectExists({ Bucket: bucket, Key: actualTargetPath }));

  await recursivelyDeleteS3Bucket(bucket);
});

test.serial('updateDLABatch acts upon a batch of files under a prefix, and skips only what has already been processed if requested ', async (t) => {
  const storedEnvironment = storeEnvironment();
  process.env.INTERNAL_BUCKET = randomString();
  let expectedCapturedFiles;
  let expectedOutputFiles;
  let fileContents;
  let capturedFiles;
  let filesProcessed;
  const sampleObject = {
    time: '2024-03-21T15:09:54Z',
    detail: {
      executionArn: 'replaceme',
      stateMachineArn: '1234',
      status: 'RUNNING',
      input: JSON.stringify({
        meta: {
          collection: {
            name: 'A_COLLECTION',
            version: '12',
          },
          provider: {
            id: 'abcd',
            protocol: 'a',
            host: 'b',
          },
        },
        payload: {
          granules: [{ granuleId: 'a' }],
        },
      }),
    },
  };
  const stableMetadata = {
    error: null,
    stateMachineArn: '1234',
    status: 'RUNNING',
    collectionId: 'A_COLLECTION___12',
    granules: ['a'],
    providerId: 'abcd',
    time: '2024-03-21T15:09:54Z',
  };
  const bucket = process.env.INTERNAL_BUCKET;
  await createBucket(bucket);

  const filePaths = [
    'a/1',
    'a/12',
    'a/b',
    'b/1',
    'b/12',
    'b/b',
    'a/b/57',
    'a/b/65',
  ];
  await Promise.all(filePaths.map((filePath) => {
    /* setting executionArn to be our file ID for later verification */
    sampleObject.detail.executionArn = filePath;
    return putJsonS3Object(
      bucket,
      filePath,
      { Body: JSON.stringify(sampleObject) }
    );
  }));

  /* update all entries under prefix 'a' */
  /* push updated records to updated-a */
  filesProcessed = await updateDLABatch(bucket, 'updated-a/', 'a');
  t.is(filesProcessed.filter(Boolean).length, 5);
  expectedCapturedFiles = [
    'a/1',
    'a/12',
    'a/b',
    'a/b/57',
    'a/b/65',
  ].sort();
  expectedOutputFiles = [
    'updated-a/2024-03-21/1',
    'updated-a/2024-03-21/12',
    'updated-a/2024-03-21/b',
    'updated-a/b/2024-03-21/57',
    'updated-a/b/2024-03-21/65',
  ];
  /* pull these updated as we expect to find them */
  fileContents = await Promise.all(
    expectedOutputFiles.map((filePath) => getJsonS3Object(bucket, filePath))
  );

  capturedFiles = fileContents.map((content) => JSON.parse(content.Body).detail.executionArn).sort();
  /* we've set executionArn to be our file ID, that these come from the expected input files */
  t.deepEqual(expectedCapturedFiles, fileContents.map((content) => JSON.parse(content.Body).detail.executionArn).sort());

  /* check that metadata has been captured and hoisted */
  fileContents.forEach((content) => {
    t.like(
      content,
      stableMetadata
    );
    t.is(
      JSON.parse(content.Body).detail.executionArn,
      content.executionArn
    );
  });

  /* look under prefix b */
  filesProcessed = await updateDLABatch(bucket, 'updated-b', 'b');

  t.is(filesProcessed.filter(Boolean).length, 3);
  expectedCapturedFiles = [
    'b/1',
    'b/12',
    'b/b',
  ].sort();
  expectedOutputFiles = [
    'updated-b/2024-03-21/1',
    'updated-b/2024-03-21/12',
    'updated-b/2024-03-21/b',
  ];
  fileContents = await Promise.all(
    expectedOutputFiles.map((filePath) => getJsonS3Object(bucket, filePath))
  );
  capturedFiles = fileContents.map((content) => JSON.parse(content.Body).detail.executionArn).sort();
  t.deepEqual(expectedCapturedFiles, capturedFiles);

  fileContents.forEach((content) => {
    t.like(
      content,
      stableMetadata
    );
    t.is(
      JSON.parse(content.Body).detail.executionArn,
      content.executionArn
    );
  });

  /* look under prefix a/b */
  await updateDLABatch(bucket, 'updated-a/b', 'a/b');
  expectedCapturedFiles = [
    'a/b',
    'a/b/57',
    'a/b/65',
  ].sort();
  expectedOutputFiles = [
    'updated-a/2024-03-21/b',
    'updated-a/b/2024-03-21/57',
    'updated-a/b/2024-03-21/65',
  ];
  fileContents = await Promise.all(
    expectedOutputFiles.map((filePath) => getJsonS3Object(bucket, filePath))
  );
  capturedFiles = fileContents.map((content) => JSON.parse(content.Body).detail.executionArn).sort();

  t.deepEqual(expectedCapturedFiles, capturedFiles);

  fileContents.forEach((content) => {
    t.like(
      content,
      stableMetadata
    );
    t.is(
      JSON.parse(content.Body).detail.executionArn,
      content.executionArn
    );
  });

  await recursivelyDeleteS3Bucket(bucket);
  restoreEnvironment(storedEnvironment);
});

test('processArgs captures, massages and/or sets defaults for process args', async (t) => {
  const storedEnv = storeEnvironment();
  const baseArgs = clone(process.argv);
  process.argv = baseArgs.concat([
    '--prefix=a',
    '--targetPath=b/',
    '--skip',
  ]);

  t.deepEqual(
    await processArgs(),
    {
      prefix: 'a',
      targetPath: 'b/',
      skip: true,
    }
  );

  restoreEnvironment(storedEnv);
});
