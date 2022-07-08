'use strict';

const get = require('lodash/get');
const path = require('path');

const { createCollection } = require('@cumulus/integration-tests/Collections');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteExecution } = require('@cumulus/api-client/executions');
const { deleteProvider } = require('@cumulus/api-client/providers');
const { putFile } = require('@cumulus/aws-client/S3');
const {
  waitForCompletedExecution,
} = require('@cumulus/integration-tests');

const { loadConfig, createTimestampedTestId, createTestSuffix } = require('../../helpers/testUtils');
const { buildHttpOrHttpsProvider, createProvider } = require('../../helpers/Providers');
const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');

describe('The Lzards Backup workflow ', () => {
  let activityOutput;
  let beforeAllFailed = false;
  let collection;
  let prefix;
  let provider;
  let ingestBucket;
  let ingestPath;
  let testId;
  let testSuffix;
  let workflowExecution;

  beforeAll(async () => {
    try {
      const config = await loadConfig();
      prefix = config.stackName;
      testId = createTimestampedTestId(config.stackName, 'LzardsBackupWorkflow');
      testSuffix = createTestSuffix(testId);
      ingestBucket = config.buckets.protected.name;
      ingestPath = `${prefix}/lzardsBackupSpec`;
      provider = await buildHttpOrHttpsProvider(testSuffix, config.bucket, 'https');
      await putFile(ingestBucket, `${ingestPath}/testGranule.dat`, path.join(__dirname, 'test_data', 'testGranule.dat'));
      await putFile(ingestBucket, `${ingestPath}/testGranule.jpg`, path.join(__dirname, 'test_data', 'testGranule.jpg'));
      const FunctionName = `${prefix}-LzardsBackup`;

      // Create the collection
      collection = await createCollection(
        prefix,
        {
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
      await createProvider(config.stackName, provider);

      const payload = {
        granules: [
          {
            granuleId: 'FakeGranule2',
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
          config.stackName,
          config.bucket,
          'LzardsBackupTest',
          collection,
          provider,
          payload,
          { urlType: 's3'}
        )
        const executionArn = workflowExecution.executionArn;
        console.log(`Wait for completed execution ${executionArn}`);
  
        await waitForCompletedExecution(executionArn);
        const lambdaOutput = await lambdaStep.getStepOutput(executionArn, 'LzardsBackup');
        console.log('LAMBDA OUTPUT', lambdaOutput);
      } catch (error) {
        beforeAllFailed = error;
      }

      activityOutput = await activityStep.getStepOutput(
        workflowExecution.executionArn,
        'LzardsBackup'
      );

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
    expect(activityOutput.payload).toEqual({});
  });

  afterAll(async () => {
    await deleteExecution({ prefix: config.stackName, executionArn: workflowExecution.executionArn });
    await deleteCollection({
      prefix,
      collectionName: get(collection, 'name'),
      collectionVersion: get(collection, 'version'),
    });
    await deleteProvider({ prefix: stackName, providerId: provider.id });
  });
});
