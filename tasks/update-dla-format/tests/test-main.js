const test = require('ava');
const lodash = require('lodash')

const { randomString } = require('@cumulus/common/test-utils');
const {
  putJsonS3Object,
  createBucket,
  recursivelyDeleteS3Bucket,
  getJsonS3Object,
  listS3Objects,
} = require('@cumulus/aws-client/S3');
const {
  manipulateTrailingSlash,
  parseS3Directory,
  updateDLAFile,
  updateDLABatch,
} = require('../dist/main');
function storeEnvironment() {
  return lodash.clone(process.env);
}
function restoreEnvironment(storedEnvironment) {
  process.env = storedEnvironment;
}
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

test.serial('parseS3Directory parses a string as the nearest valid directory found in the bucket', async (t) => {
  const storedEnvironment = storeEnvironment();
  const bucketName = randomString(12);
  process.env.INTERNAL_BUCKET = bucketName;
  await createBucket(bucketName);
  await putJsonS3Object(bucketName, 'a/b', '{}');
  await putJsonS3Object(bucketName, 'a/c/d', '{}');
  t.is(await parseS3Directory('a'), 'a/');
  t.is(await parseS3Directory('a/b'), 'a/');
  t.is(await parseS3Directory('/'), '');


  await putJsonS3Object(bucketName, 'a/b/c', '{}');
  /* interpret 'a/b' as the directory 'a/' if it exists */
  t.is(await parseS3Directory('a/b'), 'a/');
  t.throwsAsync(
    parseS3Directory('b'),
    { message: `cannot find contents of bucket ${bucketName} under prefix 'b'` }
  );
  t.throwsAsync(
    parseS3Directory('a/c/e'),
    { message: `cannot find contents of bucket ${bucketName} under prefix 'a/c/e'` }
  );

  await recursivelyDeleteS3Bucket(bucketName);
  restoreEnvironment(storedEnvironment);
});

test.serial('updateDLAFile', async (t) => {
  const bucket = randomString(12);
  const sourcePath = 'a/b';
  const targetPath = 'a_updated/b';
  await createBucket(bucket);
  await putJsonS3Object(
    bucket,
    sourcePath,
    { body: JSON.stringify({ a: 'b' }) }
  );
  await updateDLAFile(bucket, sourcePath, targetPath);
  t.deepEqual(
    await getJsonS3Object(bucket, targetPath),
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
        time: '4Oclock',
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
  t.deepEqual(
    await getJsonS3Object(bucket, targetPath),
    {
      Body: JSON.stringify({
        time: '4Oclock',
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
      time: '4Oclock',
    }
  );

  await recursivelyDeleteS3Bucket(bucket);
});

test.serial('updateDLABatch acts upon a batch of files under a prefix', async (t) => {
  const storedEnvironment = storeEnvironment();
  process.env.DEPLOYMENT = 'test';
  process.env.INTERNAL_BUCKET = 'bucky';
  let expectedCapturedFiles;
  let expectedOutputFiles;
  let fileContents;
  let capturedFiles;
  const sampleObject = {
    time: '4Oclock',
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
    time: '4Oclock',
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
  /* push updated records to a_updated */
  await updateDLABatch(bucket, 'a_updated/', 'a');

  expectedCapturedFiles = [
    'a/1',
    'a/12',
    'a/b',
    'a/b/57',
    'a/b/65',
  ].sort();
  expectedOutputFiles = [
    'a_updated/1',
    'a_updated/12',
    'a_updated/b',
    'a_updated/b/57',
    'a_updated/b/65',
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
  
  /* look under prefix a/1 */
  await updateDLABatch(bucket, 'a_updated_1', 'a/1');
  expectedCapturedFiles = [
    'a/1',
    'a/12',
  ].sort();
  expectedOutputFiles = [
    'a_updated/1',
    'a_updated/12',
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

  /* look under prefix b */
  await updateDLABatch(bucket, 'b_updated', 'b');
  expectedCapturedFiles = [
    'b/1',
    'b/12',
    'b/b',
  ].sort();
  expectedOutputFiles = [
    'b_updated/1',
    'b_updated/12',
    'b_updated/b',
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
  await updateDLABatch(bucket, 'a_b_updated', 'a/b');
  expectedCapturedFiles = [
    'a/b',
    'a/b/57',
    'a/b/65',
  ].sort();
  expectedOutputFiles = [
    'a_b_updated/b',
    'a_b_updated/b/57',
    'a_b_updated/b/65',
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
