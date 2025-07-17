'use strict';

const get = require('lodash/get');
const path = require('path');

const { createCollection } = require('@cumulus/integration-tests/Collections');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteExecution } = require('@cumulus/api-client/executions');
const { putFile } = require('@cumulus/aws-client/S3');
const { waitForCompletedExecution } = require('@cumulus/integration-tests');
const { generateUniqueGranuleId } = require('@cumulus/ingest/granule');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const { randomString } = require('@cumulus/common/test-utils');

const { loadConfig, createTimestampedTestId, createTestSuffix } = require('../../helpers/testUtils');
const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');

describe('The Lzards Backup workflow for duplicate granules with producerGranuleId and uniqified granuleId ', () => {
  let beforeAllFailed = false;
  let collection;
  let config;
  let granuleId;
  let ingestBucket;
  let ingestPath;
  let lambdaOutput;
  let prefix;
  let producerGranuleId;
  let testId;
  let testSuffix;
  let workflowExecution;
  let provider;

  const lzardsBackupTestWorkflowName = 'LzardsBackupTest';
  const now = new Date().getTime();
  const tenMinutesAgo = now - (1000 * 60 * 10);

  beforeAll(async () => {
    try {
      config = await loadConfig();
      prefix = config.stackName;
      testId = createTimestampedTestId(prefix, 'LzardsBackupWorkflow');
      testSuffix = createTestSuffix(testId);
      ingestBucket = config.buckets.protected.name;
      ingestPath = `${prefix}/lzardsBackupWorkflowSpec`;
      provider = `FakeProvider_${randomString()}`;
      producerGranuleId = `FakeProducerGranuleId_${randomString()}`;

      // Setup files for workflow
      await putFile(ingestBucket, `${ingestPath}/testGranule.dat`, path.join(__dirname, 'test_data', 'testGranule.dat'));
      await putFile(ingestBucket, `${ingestPath}/testGranule.jpg`, path.join(__dirname, 'test_data', 'testGranule.jpg'));

      // Create collection
      collection = await createCollection(
        prefix,
        {
          name: `testCollections-${testSuffix}`,
          files: [
            {
              bucket: 'protected',
              regex: '^[^.]+\.jpg$',
              lzards: { backup: true },
              sampleFileName: 'asdf.jpg',
            },
            {
              bucket: 'protected',
              regex: '^[^.]+\.dat$',
              sampleFileName: 'asdf.dat',
            },
          ],
        }
      );

      granuleId = generateUniqueGranuleId({
        id: 'FakeGranule1',
        collectionId: `${collection.name}___${collection.version}`,
        hashLength: 4,
      });
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  afterAll(async () => {
    await deleteCollection({
      prefix,
      collectionName: get(collection, 'name'),
      collectionVersion: get(collection, 'version'),
    });
  });

  describe('works with a payload that contains dataType and version and not collectionId', () => {
    beforeAll(async () => {
      const payload = {
        granules: [
          {
            granuleId,
            dataType: collection.name,
            version: collection.version,
            provider,
            producerGranuleId,
            createdAt: tenMinutesAgo,
            files: [
              {
                fileName: 'testGranule.jpg',
                bucket: ingestBucket,
                key: `${ingestPath}/testGranule.jpg`,
                checksumType: 'md5',
                checksum: '5799f9560b232baf54337d334179caa0',
              },
              {
                fileName: 'testGranule.dat',
                bucket: ingestBucket,
                key: `${ingestPath}/testGranule.dat`,
                checksumType: 'md5',
                checksum: '39a870a194a787550b6b5d1f49629236',
              },
            ],
          },
        ],
      };

      try {
        workflowExecution = await buildAndExecuteWorkflow(
          prefix,
          config.bucket,
          lzardsBackupTestWorkflowName,
          collection,
          undefined,
          payload,
          { urlType: 's3' }
        );
        const executionArn = workflowExecution.executionArn;
        console.log(`Wait for completed execution ${executionArn}`);

        await waitForCompletedExecution(executionArn);
        const lambdaStep = new LambdaStep();
        lambdaOutput = await lambdaStep.getStepOutput(executionArn, 'LzardsBackup');
      } catch (error) {
        beforeAllFailed = error;
      }
    });

    afterAll(async () => {
      await deleteExecution({ prefix, executionArn: workflowExecution.executionArn });
    });

    it('executes successfully when the payload granule contains dataType and version', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      expect(workflowExecution.status).toEqual('completed');
    });

    it('has the expected step output', () => {
      expect(lambdaOutput.payload.granules[0].granuleId).toEqual(granuleId);
      expect(lambdaOutput.payload.granules[0].producerGranuleId).toEqual(producerGranuleId);
    });
  });

  describe('works with a payload that contains dataType and version and collectionId', () => {
    beforeAll(async () => {
      const payload = {
        granules: [
          {
            granuleId,
            collectionId: `${collection.name}___${collection.version}`,
            dataType: collection.name,
            version: collection.version,
            provider,
            producerGranuleId,
            createdAt: tenMinutesAgo,
            files: [
              {
                fileName: 'testGranule.jpg',
                bucket: ingestBucket,
                key: `${ingestPath}/testGranule.jpg`,
                checksumType: 'md5',
                checksum: '5799f9560b232baf54337d334179caa0',
              },
              {
                fileName: 'testGranule.dat',
                bucket: ingestBucket,
                key: `${ingestPath}/testGranule.dat`,
                checksumType: 'md5',
                checksum: '39a870a194a787550b6b5d1f49629236',
              },
            ],
          },
        ],
      };

      try {
        workflowExecution = await buildAndExecuteWorkflow(
          prefix,
          config.bucket,
          lzardsBackupTestWorkflowName,
          collection,
          undefined,
          payload,
          { urlType: 's3' }
        );
        const executionArn = workflowExecution.executionArn;
        console.log(`Wait for completed execution ${executionArn}`);

        await waitForCompletedExecution(executionArn);
        const lambdaStep = new LambdaStep();
        lambdaOutput = await lambdaStep.getStepOutput(executionArn, 'LzardsBackup');
      } catch (error) {
        beforeAllFailed = error;
      }
    });

    afterAll(async () => {
      await deleteExecution({ prefix, executionArn: workflowExecution.executionArn });
    });

    it('executes successfully when the payload granule contains dataType and version', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      expect(workflowExecution.status).toEqual('completed');
    });

    it('has the expected step output', () => {
      expect(lambdaOutput.payload.granules[0].granuleId).toEqual(granuleId);
      expect(lambdaOutput.payload.granules[0].producerGranuleId).toEqual(producerGranuleId);
    });
  });
});
