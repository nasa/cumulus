'use strict';

const flatten = require('lodash/flatten');
const { s3PutObject } = require('@cumulus/aws-client/S3');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteExecution } = require('@cumulus/api-client/executions');
const { getGranule } = require('@cumulus/api-client/granules');
const { deleteProvider } = require('@cumulus/api-client/providers');
const { getExecutionInputObject } = require('@cumulus/integration-tests');
const { createCollection } = require('@cumulus/integration-tests/Collections');
const { createProvider } = require('@cumulus/integration-tests/Providers');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');

const { waitForApiStatus } = require('../../helpers/apiUtils');
const { waitForGranuleAndDelete } = require('../../helpers/granuleUtils');
const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');
const {
  createTimestampedTestId,
  deleteFolder,
  loadConfig,
} = require('../../helpers/testUtils');

const buildTestPdrBody = (testId, collection1, collection2, provider) => `TOTAL_FILE_COUNT = 6;
EXPIRATION_TIME = 2017-08-22T20:07:21;
OBJECT=FILE_GROUP;
  DATA_TYPE = ${collection1.name};
  DATA_VERSION = ${collection1.version};
  NODE_NAME = ${provider.host};
  OBJECT = FILE_SPEC;
    DIRECTORY_ID = /${testId}/test-data/;
    FILE_ID = ${testId}-gran1.hdf;
    FILE_TYPE = HDF;
    FILE_SIZE = 12345;
  END_OBJECT = FILE_SPEC;
END_OBJECT = FILE_GROUP;
OBJECT=FILE_GROUP;
  DATA_TYPE = ${collection1.name};
  DATA_VERSION = ${collection1.version};
  NODE_NAME = ${provider.host};
  OBJECT = FILE_SPEC;
    DIRECTORY_ID = /${testId}/test-data/;
    FILE_ID = ${testId}-gran2.hdf;
    FILE_TYPE = HDF;
    FILE_SIZE = 12345;
  END_OBJECT = FILE_SPEC;
END_OBJECT = FILE_GROUP;
OBJECT=FILE_GROUP;
  DATA_TYPE = ${collection2.name};
  DATA_VERSION = ${collection2.version};
  NODE_NAME = ${provider.host};
  OBJECT = FILE_SPEC;
    DDIRECTORY_ID = /${testId}/test-data/;
    FILE_ID = ${testId}-gran3.hdf;
    FILE_TYPE = HDF;
    FILE_SIZE = 12345;
  END_OBJECT = FILE_SPEC;
END_OBJECT = FILE_GROUP;
OBJECT=FILE_GROUP;
  DATA_TYPE = ${collection2.name};
  DATA_VERSION = ${collection2.version};
  NODE_NAME = ${provider.host};
  OBJECT = FILE_SPEC;
    DIRECTORY_ID = /${testId}/test-data/;
    FILE_ID = ${testId}-gran4.hdf;
    FILE_TYPE = HDF;
    FILE_SIZE = 12345;
  END_OBJECT = FILE_SPEC;
END_OBJECT = FILE_GROUP;
OBJECT=FILE_GROUP;
  DATA_TYPE = ${collection1.name};
  DATA_VERSION = ${collection1.version};
  OBJECT = FILE_SPEC;
    DIRECTORY_ID = /${testId}/test-data/;
    FILE_ID = ${testId}-gran5.hdf;
    FILE_TYPE = HDF;
    FILE_SIZE = 12345;
  END_OBJECT = FILE_SPEC;
END_OBJECT = FILE_GROUP;
OBJECT=FILE_GROUP;
  DATA_TYPE = ${collection1.name};
  DATA_VERSION = ${collection1.version};
  OBJECT = FILE_SPEC;
    DIRECTORY_ID = /${testId}/test-data/;
    FILE_ID = ${testId}-gran6.hdf;
    FILE_TYPE = HDF;
    FILE_SIZE = 12345;
  END_OBJECT = FILE_SPEC;
END_OBJECT = FILE_GROUP;
`;

describe('Parsing a PDR with multiple data types and node names', () => {
  let beforeAllError;
  let bucket;
  let config;
  let expectedBatches;
  let nodeNameBucket;
  let nodeNameProvider;
  let parsePdrExecutionArn;
  let parsePdrOutput;
  let queueGranulesOutput;
  let stackName;
  let testDataPath;
  let testCollection1;
  let testCollection2;
  let testGranuleIds;
  let testProvider;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      ({ stackName, bucket } = config);
      nodeNameBucket = config.pdrNodeNameProviderBucket;

      const testId = createTimestampedTestId(stackName, 'ParsePdrBatchQueue');
      testCollection1 = await createCollection(stackName);
      testCollection2 = await createCollection(stackName);
      testProvider = await createProvider(stackName, { host: bucket });
      nodeNameProvider = await createProvider(stackName, { host: nodeNameBucket });

      const pdrName = `${testId}.PDR`;
      testDataPath = `${stackName}/tmp/${testId}/`;

      const parsePdrPayload = {
        testExecutionId: testId,
        pdr: {
          name: pdrName,
          path: testDataPath,
        },
      };

      const pdrBody = buildTestPdrBody(
        testId,
        testCollection1,
        testCollection2,
        testProvider
      );

      expectedBatches = {
        [`${testCollection1.name}_${nodeNameProvider.name}`]: [`${testId}-gran1.hdf`, `${testId}-gran2.hdf`],
        [`${testCollection2.name}_${nodeNameProvider.name}`]: [`${testId}-gran3.hdf`, `${testId}-gran4.hdf`],
        [`${testCollection1.name}_${testProvider.name}`]: [`${testId}-gran5.hdf`, `${testId}-gran6.hdf`],
      };

      testGranuleIds = flatten(Object.values(expectedBatches));

      // populate PDR on S3
      await s3PutObject({
        Bucket: bucket,
        Key: testDataPath,
        Body: pdrBody,
      });

      const nodeNameGranules = [`${testId}-gran1`, `${testId}-gran2`, `${testId}-gran3`, `${testId}-gran4`];
      const internalBucketGranules = [`${testId}-gran5`, `${testId}-gran6`];

      await Promise.all(nodeNameGranules.map((granuleId) => s3PutObject({
        Bucket: nodeNameBucket,
        Key: `${testDataPath}/${granuleId}.hdf`,
        Body: 'abc',
      })));
      await Promise.all(internalBucketGranules.map((granuleId) => s3PutObject({
        Bucket: bucket,
        Key: `${testDataPath}/${granuleId}.hdf`,
        Body: 'abc',
      })));

      parsePdrExecutionArn = (await buildAndExecuteWorkflow(
        stackName,
        bucket,
        'ParsePdr',
        testCollection1,
        testProvider,
        parsePdrPayload
      )).executionArn;

      const lambdaStep = new LambdaStep();

      parsePdrOutput = lambdaStep.getStepOutput(
        parsePdrExecutionArn,
        'ParsePdr'
      );

      queueGranulesOutput = await lambdaStep.getStepOutput(
        parsePdrExecutionArn,
        'QueueGranules'
      );
    } catch (error) {
      beforeAllError = error;
    }
  });

  afterAll(async () => {
    await Promise.all(testGranuleIds.map(
      (granuleId) => waitForGranuleAndDelete(stackName, granuleId, 'completed')
    ));
    await Promise.all(queueGranulesOutput.running.map(
      (executionArn) => deleteExecution({ prefix: stackName, executionArn })
    ));
    await deleteExecution({ prefix: stackName, executionArn: parsePdrExecutionArn });
    await Promise.all([
      deleteFolder(bucket, testDataPath),
      deleteFolder(nodeNameBucket, testDataPath),
      deleteCollection({
        prefix: stackName,
        collectionName: testCollection1.name,
        collectionVersion: testCollection1.version,
      }),
      deleteCollection({
        prefix: stackName,
        collectionName: testCollection2.name,
        collectionVersion: testCollection2.version,
      }),
      deleteProvider({
        prefix: stackName,
        provider: testProvider.id,
      }),
      deleteProvider({
        prefix: stackName,
        provider: nodeNameProvider.id,
      }),
    ]);
  });

  it('yields the expected output of granules in the payload', () => {
    if (beforeAllError) fail(beforeAllError);
    else {
      expect(parsePdrOutput.granulesCount).toEqual(testGranuleIds.length);
      expect(parsePdrOutput.granules.map((g) => g.granuleId)).toEqual(testGranuleIds);
    }
  });

  describe('and the queue-granules task', () => {
    it('queues granules into the expected number of workflows', () => {
      if (beforeAllError) fail(beforeAllError);
      else expect(queueGranulesOutput.payload.running.length).toEqual(3);
    });

    it('creates queued workflow inputs in expected batches', async () => {
      if (beforeAllError) fail(beforeAllError);
      else {
        const executionArns = queueGranulesOutput.payload.running;
        const inputs = await Promise.all(executionArns.map(getExecutionInputObject));
        inputs.forEach((input) => {
          const granules = input.payload.granules;
          const granuleIds = granules.map((g) => g.granuleId);
          const collectionAndProvider = `${input.meta.collection.name}_${input.meta.provider.name}`;
          expect(granuleIds).toEqual(expectedBatches[collectionAndProvider]);
        });
      }
    });

    it('granules become available in the Cumulus API', async () => {
      if (beforeAllError) fail(beforeAllError);
      else {
        const granules = await Promise.all(testGranuleIds.map((granuleId) => waitForApiStatus(
          getGranule,
          { prefix: stackName, granuleId },
          'completed'
        )));
        granules.forEach((g) => {
          expect(g).toBeDefined();
        });
      }
    });
  });
});
