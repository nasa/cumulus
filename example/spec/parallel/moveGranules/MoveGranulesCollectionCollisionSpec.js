'use strict';

const pAll = require('p-all');
const pRetry = require('p-retry');
const pTimeout = require('p-timeout');

const {
  InvokeCommand,
  GetFunctionConfigurationCommand,
} = require('@aws-sdk/client-lambda');

const { constructCollectionId } = require('@cumulus/message/Collections');
const { createCollection } = require('@cumulus/integration-tests/Collections');
const { createGranule } = require('@cumulus/api-client/granules');
const { deleteS3Object, s3PutObject, getObject, getObjectStreamContents } = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');
const { s3 } = require('@cumulus/aws-client/services');

const { lambda } = require('@cumulus/aws-client/services');
const { loadConfig } = require('../../helpers/testUtils');
const { removeCollectionAndAllDependencies } = require('../../helpers/Collections');

describe('The MoveGranules task', () => {
  let collection;
  let collisionCollection;
  let config;
  let prefix;
  let sourceBucket;

  async function setupTest({
    collisionFromSameCollection = false,
    crossCollectionThrowOnFileNotFound,
    orphanTest = false,
  } = {}) {
    config = await loadConfig();
    prefix = config.stackName;
    sourceBucket = config.bucket;

    const FunctionName = `${prefix}-MoveGranules`;
    const functionConfig = await lambda().send(new GetFunctionConfigurationCommand({
      FunctionName,
    }));

    process.env.stackName = config.stackName;
    process.env.system_bucket = config.buckets.internal.name;

    // Create the collection
    collection = await pRetry(
      () => createCollection(
        prefix,
        {
          duplicateHandling: 'replace',
        }
      ),
      {
        retries: 3,
        onFailedAttempt: (error) => {
          console.log(`Attempt to create main collection failed, retrying: ${error.message}`);
        },
      }
    );

    collisionCollection = await pRetry(
      () => createCollection(
        prefix,
        {
          duplicateHandling: 'error',
        }
      ),
      {
        retries: 3,
        onFailedAttempt: (error) => {
          console.log(`Attempt to create collision collection failed, retrying: ${error.message}`);
        },
      }
    );

    const granuleId = randomId('granule-id-');

    // Stage a granule file to S3
    const stagingDir = 'file-staging';
    const stagedFileName = `${randomId('file-')}.dat`;
    const sourceKey = `${stagingDir}/${stagedFileName}`;
    const targetKey = `${collection.url_path}/${stagedFileName}`;
    await s3PutObject({
      Bucket: sourceBucket,
      Key: sourceKey,
      Body: 'fakeGranuleForSpecTesting',
    });

    await s3PutObject({
      Bucket: config.buckets.protected.name,
      Key: targetKey,
      Body: 'collisionGranuleForSpecTesting',
    });

    let collisionGranuleObject;
    if (!orphanTest) {
      // Create a granule in the database with the staged file but in another collection
      const collisionGranuleCollectionId = collisionFromSameCollection ?
        constructCollectionId(collection.name, collection.version) :
        constructCollectionId(
          collisionCollection.name,
          collisionCollection.version
        );
      collisionGranuleObject = {
        granuleId,
        producerGranuleId: granuleId,
        collectionId: collisionGranuleCollectionId,
        status: 'completed',
        files: [
          {
            bucket: config.buckets.protected.name,
            key: targetKey,
          },
        ],
      };
      await pRetry(
        () => createGranule({
          prefix: config.stackName,
          body: collisionGranuleObject,
        }),
        {
          retries: 3,
          onFailedAttempt: (error) => {
            console.log(`Attempt to create granule failed, retrying: ${error.message}`);
          },
        }
      );
    }

    let taskConfig = {
      buckets: config.buckets,
      collection,
      bucket: config.bucket,
      duplicateHandling: 'replace',
      distribution_endpoint: 'http://www.example.com',
    };

    if (crossCollectionThrowOnFileNotFound !== undefined) {
      taskConfig = { ...taskConfig, crossCollectionThrowOnFileNotFound };
    }
    const Payload = new TextEncoder().encode(JSON.stringify({
      cma: {
        ReplaceConfig: {
          Path: '$.payload',
          TargetPath: '$.payload',
          MaxSize: 1000000,
        },
        task_config: taskConfig,
        event: {
          cumulus_meta: {
            system_bucket: config.bucket,
          },
          payload: {
            granules: [
              {
                granuleId,
                producerGranuleId: granuleId,
                collectionId: constructCollectionId(collection.name, collection.version),
                files: [
                  {
                    bucket: sourceBucket,
                    key: sourceKey,
                    fileName: stagedFileName,
                    size: 0,
                  },
                ],
              },
            ],
          },
        },
      },
    }));
    const moveGranulesOutput = await pTimeout(
      lambda().send(new InvokeCommand({ FunctionName, Payload })),
      (functionConfig.Timeout + 10) * 1000
    );
    const taskOutput = JSON.parse(
      new TextDecoder('utf-8').decode(moveGranulesOutput.Payload)
    );

    return {
      granuleId,
      sourceKey,
      targetKey,
      taskOutput,
    };
  }

  async function cleanupResources({ sourceKey, targetKey }) {
    await pAll(
      [
        () => deleteS3Object(sourceBucket, sourceKey),
        () => deleteS3Object(config.buckets.protected.name, targetKey),
        () => removeCollectionAndAllDependencies({
          prefix,
          collection,
        }),
        () => removeCollectionAndAllDependencies({
          prefix,
          collection: collisionCollection,
        }),
      ],
      { stopOnError: false }
    ).catch(console.error);
  }

  it('Fails to overwrite the object and has expected error', async () => {
    let testResources;
    try {
      // Setup test and get resources
      testResources = await setupTest({ collisionFromSameCollection: false });
      const { granuleId, targetKey, taskOutput } = testResources;

      // Assertions
      const s3ObjectStream = await getObject(s3(), {
        Bucket: config.buckets.protected.name,
        Key: targetKey,
      });
      const objectContents = await getObjectStreamContents(s3ObjectStream.Body);
      const errorMessage = `File already exists in bucket ${config.buckets.protected.name} with key ${targetKey} for collection ${constructCollectionId(collisionCollection.name, collisionCollection.version)} and granuleId: ${granuleId}, but is being moved for collection ${constructCollectionId(collection.name, collection.version)}.`;
      expect(taskOutput.errorType).toEqual('InvalidArgument');
      expect(taskOutput.errorMessage).toMatch(errorMessage);
      expect(objectContents).toEqual('collisionGranuleForSpecTesting');
    } finally {
      // Clean up resources if they were created
      if (testResources) {
        await cleanupResources(testResources);
      }
    }
  });

  it('Handles same-collection file collisions', async () => {
    let testResources;
    try {
      testResources = await setupTest({ collisionFromSameCollection: true });
      const { granuleId, targetKey, taskOutput } = testResources;

      const s3ObjectStream = await getObject(s3(), {
        Bucket: config.buckets.protected.name,
        Key: targetKey,
      });
      const objectContents = await getObjectStreamContents(s3ObjectStream.Body);
      expect(taskOutput.errorType).not.toEqual('InvalidArgument');
      expect(objectContents).toEqual('fakeGranuleForSpecTesting');
      expect(Object.keys(taskOutput.payload.granuleDuplicates)).toEqual([granuleId]);
      expect(Object.keys(taskOutput.payload.granules[0].files[0])).toEqual(['bucket', 'key', 'fileName', 'size']);
    } finally {
      if (testResources) {
        await cleanupResources(testResources);
      }
    }
  });
  it('Handles orphaned file collisions as errors when crossCollectionThrowOnFileNotFound is true', async () => {
    let testResources;
    try {
      testResources = await setupTest({ orphanTest: true, crossCollectionThrowOnFileNotFound: true });
      const { targetKey, taskOutput } = testResources;

      const s3ObjectStream = await getObject(s3(), {
        Bucket: config.buckets.protected.name,
        Key: targetKey,
      });
      const objectContents = await getObjectStreamContents(s3ObjectStream.Body);
      expect(taskOutput.errorType).toEqual('FileNotFound');
      expect(taskOutput.errorMessage).toMatch(/does not exist in the Cumulus database/);
      expect(objectContents).toEqual('collisionGranuleForSpecTesting');
    } finally {
      if (testResources) {
        await cleanupResources(testResources);
      }
    }
  });
  it('Handles orphaned file collisions without error when crossCollectionThrowOnFileNotFound is false', async () => {
    let testResources;
    try {
      testResources = await setupTest({ orphanTest: true, crossCollectionThrowOnFileNotFound: false });
      const { granuleId, targetKey, taskOutput } = testResources;

      const s3ObjectStream = await getObject(s3(), {
        Bucket: config.buckets.protected.name,
        Key: targetKey,
      });
      const objectContents = await getObjectStreamContents(s3ObjectStream.Body);
      expect(taskOutput.errorType).not.toEqual('InvalidArgument');
      expect(objectContents).toEqual('fakeGranuleForSpecTesting');
      expect(Object.keys(taskOutput.payload.granuleDuplicates)).toEqual([granuleId]);
      expect(Object.keys(taskOutput.payload.granules[0].files[0])).toEqual(['bucket', 'key', 'fileName', 'size']);
    } finally {
      if (testResources) {
        await cleanupResources(testResources);
      }
    }
  });
  it('Handles orphaned file collisions without error when crossCollectionThrowOnFileNotFound is default', async () => {
    let testResources;
    try {
      testResources = await setupTest({ orphanTest: true });
      const { granuleId, targetKey, taskOutput } = testResources;

      const s3ObjectStream = await getObject(s3(), {
        Bucket: config.buckets.protected.name,
        Key: targetKey,
      });
      const objectContents = await getObjectStreamContents(s3ObjectStream.Body);
      expect(taskOutput.errorType).not.toEqual('InvalidArgument');
      expect(objectContents).toEqual('fakeGranuleForSpecTesting');
      expect(Object.keys(taskOutput.payload.granuleDuplicates)).toEqual([granuleId]);
      expect(Object.keys(taskOutput.payload.granules[0].files[0])).toEqual(['bucket', 'key', 'fileName', 'size']);
    } finally {
      if (testResources) {
        await cleanupResources(testResources);
      }
    }
  });
});
