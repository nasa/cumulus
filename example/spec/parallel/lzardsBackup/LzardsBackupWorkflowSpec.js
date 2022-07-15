'use strict';

const get = require('lodash/get');
const path = require('path');

const { createCollection } = require('@cumulus/integration-tests/Collections');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteExecution } = require('@cumulus/api-client/executions');
const { putFile } = require('@cumulus/aws-client/S3');
const { waitForCompletedExecution } = require('@cumulus/integration-tests');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');

const { loadConfig, createTimestampedTestId, createTestSuffix } = require('../../helpers/testUtils');
const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');

describe('The Lzards Backup workflow ', () => {
  let beforeAllFailed = false;
  let collection;
  let ingestBucket;
  let ingestPath;
  let lambdaOutput;
  let lambdaStep;
  let prefix;
  let testId;
  let testSuffix;
  let workflowExecution;

  beforeAll(async () => {
    try {
      const config = await loadConfig();
      prefix = config.stackName;
      testId = createTimestampedTestId(prefix, 'LzardsBackupWorkflow');
      testSuffix = createTestSuffix(testId);
      ingestBucket = config.buckets.protected.name;
      ingestPath = `${prefix}/lzardsBackupWorkflowSpec`;

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

      const payload = {
        granules: [
          {
            granuleId: 'FakeGranule1',
            collectionId: `${collection.name}___${collection.version}`,
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
          'LzardsBackupTest',
          collection,
          undefined,
          payload,
          { urlType: 's3'}
        )
        const executionArn = workflowExecution.executionArn;
        console.log(`Wait for completed execution ${executionArn}`);
  
        await waitForCompletedExecution(executionArn);
        lambdaStep = new LambdaStep();
        lambdaOutput = await lambdaStep.getStepOutput(executionArn, 'LzardsBackup');
      } catch (error) {
        beforeAllFailed = error;
      }
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  it('executes succesfully', () => {
    if (beforeAllFailed) fail(beforeAllFailed);
    expect(workflowExecution.status).toEqual('completed');
  });

  it('has the expected step output', () => {
    expect(lambdaOutput.payload.granules[0].granuleId).toEqual('FakeGranule1');
  });

  afterAll(async () => {
    await deleteExecution({ prefix, executionArn: workflowExecution.executionArn });
    await deleteCollection({
      prefix,
      collectionName: get(collection, 'name'),
      collectionVersion: get(collection, 'version'),
    });
  });
});
