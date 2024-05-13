const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const moment = require('moment');

const {
  createBucket,
  putJsonS3Object,
  recursivelyDeleteS3Bucket,
  getJsonS3Object,
} = require('@cumulus/aws-client/S3');

const {
  updateDLABatch,
  updateDLAFile,
} = require('..');

test.before(async (t) => {
  t.context.systemBucket = `stack${cryptoRandomString({ length: 5 })}`;
  await createBucket(t.context.systemBucket);
});

test.after.always(async (t) => {
  await recursivelyDeleteS3Bucket(t.context.systemBucket);
});
test.serial('updateDLAFile updates existing files to new structure', async (t) => {
  const bucket = t.context.systemBucket;
  const sourcePath = 'a/b.json';
  let actualTargetPath = `a/${moment.utc().format('YYYY-MM-DD')}/b.json`;
  t.true(Math.random() < 0.5);
  await putJsonS3Object(
    bucket,
    sourcePath,
    { body: JSON.stringify({ a: 'b' }) }
  );
  t.true(await updateDLAFile(bucket, sourcePath));
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
  t.true(await updateDLAFile(bucket, sourcePath));
  actualTargetPath = 'a/2024-03-21/b.json';

  t.deepEqual(
    await getJsonS3Object(bucket, actualTargetPath),
    {
      body: JSON.stringify({
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
});

test.serial('updateDLAFile handles bad input gracefully', async (t) => {
  const bucket = t.context.systemBucket;
  const sourcePath = 'a/b.json';

  await putJsonS3Object(
    bucket,
    sourcePath,
    { body: '{"sdf: sf}' }
  );
  t.false(await updateDLAFile(bucket, sourcePath));
});

test.serial('updateDLABatch acts upon a batch of files under a prefix, and skips only what has already been processed if requested ', async (t) => {
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
  const bucket = t.context.systemBucket;

  const filePaths = [
    'a/1.json',
    'a/12.json',
    'a/b.json',
    'b/1.json',
    'b/12.json',
    'b/b.json',
    'a/b/57.json',
    'a/b/65.json',
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
  filesProcessed = await updateDLABatch(bucket, 'a');
  t.is(filesProcessed.filter(Boolean).length, 3);
  expectedCapturedFiles = [
    'a/1.json',
    'a/12.json',
    'a/b.json',
  ].sort();
  expectedOutputFiles = [
    'a/2024-03-21/1.json',
    'a/2024-03-21/12.json',
    'a/2024-03-21/b.json',
  ];
  /* pull these updated as we expect to find them */
  fileContents = await Promise.all(
    expectedOutputFiles.map((filePath) => getJsonS3Object(bucket, filePath))
  );

  capturedFiles = fileContents.map((content) => JSON.parse(content.body).detail.executionArn).sort();
  /* we've set executionArn to be our file ID, that these come from the expected input files */
  t.deepEqual(expectedCapturedFiles, fileContents.map((content) => JSON.parse(content.body).detail.executionArn).sort());

  /* check that metadata has been captured and hoisted */
  fileContents.forEach((content) => {
    t.like(
      content,
      stableMetadata
    );
    t.is(
      JSON.parse(content.body).detail.executionArn,
      content.executionArn
    );
  });

  /* look under prefix b */
  filesProcessed = await updateDLABatch(bucket, 'b');

  t.is(filesProcessed.filter(Boolean).length, 3);
  expectedCapturedFiles = [
    'b/1.json',
    'b/12.json',
    'b/b.json',
  ].sort();
  expectedOutputFiles = [
    'b/2024-03-21/1.json',
    'b/2024-03-21/12.json',
    'b/2024-03-21/b.json',
  ];
  fileContents = await Promise.all(
    expectedOutputFiles.map((filePath) => getJsonS3Object(bucket, filePath))
  );
  capturedFiles = fileContents.map((content) => JSON.parse(content.body).detail.executionArn).sort();
  t.deepEqual(expectedCapturedFiles, capturedFiles);

  fileContents.forEach((content) => {
    t.like(
      content,
      stableMetadata
    );
    t.is(
      JSON.parse(content.body).detail.executionArn,
      content.executionArn
    );
  });

  /* look under prefix a/b */
  await updateDLABatch(bucket, 'a/b');
  expectedCapturedFiles = [
    'a/b/57.json',
    'a/b/65.json',
  ].sort();
  expectedOutputFiles = [
    'a/b/2024-03-21/57.json',
    'a/b/2024-03-21/65.json',
  ];
  fileContents = await Promise.all(
    expectedOutputFiles.map((filePath) => getJsonS3Object(bucket, filePath))
  );
  capturedFiles = fileContents.map((content) => JSON.parse(content.body).detail.executionArn).sort();

  t.deepEqual(expectedCapturedFiles, capturedFiles);

  fileContents.forEach((content) => {
    t.like(
      content,
      stableMetadata
    );
    t.is(
      JSON.parse(content.body).detail.executionArn,
      content.executionArn
    );
  });
});

test.serial('updateDLABatch handles bad inputs gracefully', async (t) => {
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

  const bucket = t.context.systemBucket;

  const filePaths = [
    'a/1.json',
    'a/12.json',
    'a/b.json',
  ];
  await Promise.all(filePaths.map((filePath) => {
    /* setting executionArn to be our file ID for later verification */
    sampleObject.detail.executionArn = filePath;
    return putJsonS3Object(
      bucket,
      filePath,
      { body: JSON.stringify(sampleObject) }
    );
  }));
  await putJsonS3Object(
    bucket,
    'a/bad.json',
    { body: '{"jlke:d}' }
  );
  const ret = await updateDLABatch(bucket, 'a');
  t.is(ret.length, 4);
  t.is(ret.filter(Boolean).length, 3);
});
