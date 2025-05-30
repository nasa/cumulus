'use strict';

const get = require('lodash/get');
const path = require('path');

const { createCollection } = require('@cumulus/integration-tests/Collections');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { deleteExecution } = require('@cumulus/api-client/executions');
const { putFile } = require('@cumulus/aws-client/S3');
const { waitForCompletedExecution } = require('@cumulus/integration-tests');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const { randomString } = require('@cumulus/common/test-utils');

const { loadConfig, createTimestampedTestId, createTestSuffix } = require('../../helpers/testUtils');
const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');

describe('The Lzards Backup workflow ', () => {
  let beforeAllFailed = false;
  let collection;
  let config;
  let ingestBucket;
  let ingestPath;
  let lambdaOutput;
  let prefix;
  let testId;
  let testSuffix;
  let workflowExecution;
  let provider;

  const lzardsBackupTestWorkflowName = 'LzardsBackupTest';
  const lzardsBackupFailTestWorkflowName = 'LzardsBackupFailTest';
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

      // Setup files for workflow
      await putFile(ingestBucket, `${ingestPath}/testGranule.dat`, path.join(__dirname, 'test_data', 'testGranule.dat'));
      await putFile(ingestBucket, `${ingestPath}/testGranule.jpg`, path.join(__dirname, 'test_data', 'testGranule.jpg'));
      await putFile(ingestBucket, `${ingestPath}/testGranuleFail.jpg`, path.join(__dirname, 'test_data', 'testGranule.jpg'));

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

  describe('works when task config failTaskWhenFileBackupFail is not set, one of the file backup fails, and payload contains collectionId', () => {
    beforeAll(async () => {
      try {
        const payload = {
          granules: [
            {
              granuleId: 'FakeGranule1',
              collectionId: `${collection.name}___${collection.version}`,
              provider,
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
                  fileName: 'testGranuleFail.jpg',
                  bucket: ingestBucket,
                  key: `${ingestPath}/testGranuleFail.jpg`,
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

    it('executes succesfully when the payload granule contains collectionId', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      expect(workflowExecution.status).toEqual('completed');
    });

    it('has the expected step output', () => {
      const backupStatus = lambdaOutput.meta.backupStatus;
      expect(backupStatus.length).toEqual(2);
      for (let i = 0; i < backupStatus.length; i += 1) {
        if (backupStatus[i].filename.endsWith('testGranule.jpg')) {
          expect(backupStatus[i].status).toEqual('COMPLETED');
        } else if (backupStatus[i].filename.endsWith('testGranuleFail.jpg')) {
          expect(backupStatus[i].status).toEqual('FAILED');
        } else {
          fail(`unexpected backup file ${backupStatus[i].filename}`);
        }
      }
      expect(lambdaOutput.payload.granules[0].granuleId).toEqual('FakeGranule1');
    });
  });

  describe('works with a payload that contains dataType and version and not collectionId', () => {
    beforeAll(async () => {
      const payload = {
        granules: [
          {
            granuleId: 'FakeGranule1',
            dataType: collection.name,
            version: collection.version,
            provider,
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
      expect(lambdaOutput.payload.granules[0].granuleId).toEqual('FakeGranule1');
    });
  });

  describe('works with a payload that contains dataType and version and collectionId', () => {
    beforeAll(async () => {
      const payload = {
        granules: [
          {
            granuleId: 'FakeGranule1',
            collectionId: `${collection.name}___${collection.version}`,
            dataType: collection.name,
            version: collection.version,
            provider,
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
      expect(lambdaOutput.payload.granules[0].granuleId).toEqual('FakeGranule1');
    });
  });

  describe('fails when dataType and version or collectionId is missing from the payload', () => {
    beforeAll(async () => {
      const payload = {
        granules: [
          {
            granuleId: 'FakeGranule1',
            provider,
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
        lambdaOutput = await lambdaStep.getStepOutput(executionArn, 'LzardsBackup', 'failure');
      } catch (error) {
        beforeAllFailed = error;
      }
    });

    afterAll(async () => {
      await deleteExecution({ prefix, executionArn: workflowExecution.executionArn });
    });

    it('throws an error and fails', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      const errorCause = JSON.parse(lambdaOutput.cause);
      const [message] = JSON.parse(errorCause.errorMessage);
      expect(workflowExecution.status).toEqual('failed');
      expect(message.reason.name).toEqual('CollectionIdentifiersNotProvidedError');
    });
  });

  describe('fails when task config failTaskWhenFileBackupFail is true and one of the file backup fails ', () => {
    beforeAll(async () => {
      try {
        const payload = {
          granules: [
            {
              granuleId: 'FakeGranule1',
              collectionId: `${collection.name}___${collection.version}`,
              provider,
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
                  fileName: 'testGranuleFail.jpg',
                  bucket: ingestBucket,
                  key: `${ingestPath}/testGranuleFail.jpg`,
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
        workflowExecution = await buildAndExecuteWorkflow(
          prefix,
          config.bucket,
          lzardsBackupFailTestWorkflowName,
          collection,
          undefined,
          payload,
          { urlType: 's3' }
        );
        const executionArn = workflowExecution.executionArn;
        console.log(`Wait for completed execution ${executionArn}`);

        await waitForCompletedExecution(executionArn);
        const lambdaStep = new LambdaStep();
        lambdaOutput = await lambdaStep.getStepOutput(executionArn, 'LzardsBackup', 'failure');
      } catch (error) {
        beforeAllFailed = error;
      }
    });

    afterAll(async () => {
      await deleteExecution({ prefix, executionArn: workflowExecution.executionArn });
    });

    it('throws an error and fails', () => {
      if (beforeAllFailed) fail(beforeAllFailed);
      const errorCause = JSON.parse(lambdaOutput.cause);
      expect(workflowExecution.status).toEqual('failed');
      expect(errorCause.errorMessage).toContain('testGranuleFail.jpg did not have a checksum or checksumType defined');
    });
  });
});

// TODO
// describe('works with duplicate granule with a uniquified granuleId', () => {
//   it('executes successfully when the payload granule contains dataType and version', () => {});
//   it('has the expected step output', () => {});
// });
