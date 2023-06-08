'use strict';

const get = require('lodash/get');
const pick = require('lodash/pick');
const {
  fakeCumulusMessageFactory,
  fakeFileFactory,
  fakeGranuleFactoryV2,
} = require('@cumulus/api/lib/testUtils');
const {
  deleteAsyncOperation,
  getAsyncOperation,
} = require('@cumulus/api-client/asyncOperations');
const {
  createCollection, deleteCollection,
} = require('@cumulus/api-client/collections');
const { postRecoverCumulusMessages } = require('@cumulus/api-client/deadLetterArchive');
const { deleteExecution } = require('@cumulus/api-client/executions');
const { deleteGranule, waitForGranule } = require('@cumulus/api-client/granules');
const { createProvider, deleteProvider } = require('@cumulus/api-client/providers');
const { deleteRule } = require('@cumulus/api-client/rules');

const {
  loadCollection,
} = require('@cumulus/integration-tests');
const { findExecutionArn } = require('@cumulus/integration-tests/Executions');
const { createOneTimeRule } = require('@cumulus/integration-tests/Rules');
const { getStateMachineArnFromExecutionArn } = require('@cumulus/message/Executions');
const { randomString } = require('@cumulus/common/test-utils');
const { putJsonS3Object, s3ObjectExists, deleteS3Object } = require('@cumulus/aws-client/S3');
const { generateNewArchiveKeyForFailedMessage } = require('@cumulus/api/lambdas/process-s3-dead-letter-archive');
const { encodedConstructCollectionId } = require('../../helpers/Collections');

const {
  waitForApiStatus,
} = require('../../helpers/apiUtils');
const {
  createTimestampedTestId,
  loadConfig,
} = require('../../helpers/testUtils');

describe('A dead letter record archive processing operation', () => {
  let archivePath;
  let beforeAllFailed;
  let cumulusMessage;
  let executionArn;
  let failingMessage;
  let failingMessageKey;
  let failingExecutionArn;
  let failingTestRule;
  let messageKey;
  let newArchiveKey;
  let stackName;
  let systemBucket;
  let testCollection;
  let collectionId;
  let testGranule;
  let testProvider;
  let testRule;
  let deadLetterRecoveryAsyncOpId;
  let deadLetterRecoveryAsyncOperation;

  beforeAll(async () => {
    try {
      const ingestTime = Date.now() - 1000 * 30;

      const config = await loadConfig();
      stackName = config.stackName;
      systemBucket = config.bucket;

      const testId = createTimestampedTestId(stackName, 'DeadLetterArchiveProcessing');
      const failingTestId = createTimestampedTestId(stackName, 'DeadLetterArchiveProcessingFailed');

      testCollection = await loadCollection({
        filename: './data/collections/s3_MOD09GQ_006/s3_MOD09GQ_006.json',
        postfix: testId,
      });
      await createCollection(
        { prefix: stackName, collection: testCollection }
      );

      testProvider = {
        id: `s3_provider_${testId}`,
        host: 'cumulus-sandbox-fake-s3-provider',
        protocol: 's3',
        globalConnectionLimit: 1000,
      };
      await createProvider(
        { prefix: stackName, provider: testProvider }
      );

      const testFiles = [
        fakeFileFactory({ bucket: systemBucket }),
        fakeFileFactory({ bucket: systemBucket }),
      ];
      collectionId = encodedConstructCollectionId(testCollection.name, testCollection.version);
      testGranule = fakeGranuleFactoryV2({
        granuleId: `MOD09GQ.${randomString()}.hdf`,
        collectionId,
        files: testFiles,
        published: false,
      });

      testRule = await createOneTimeRule(
        stackName,
        {
          workflow: 'HelloWorldWorkflow',
          collection: pick(testCollection, ['name', 'version']),
          provider: testProvider.id,
          payload: { testId },
        }
      );
      failingTestRule = await createOneTimeRule(
        stackName,
        {
          workflow: 'HelloWorldWorkflow',
          collection: pick(testCollection, ['name', 'version']),
          provider: testProvider.id,
          payload: { testId: failingTestId },
        }
      );

      console.log('originalPayload.testId', testId);
      executionArn = await findExecutionArn(
        stackName,
        (execution) =>
          get(execution, 'originalPayload.testId') === testId,
        {
          timestamp__from: ingestTime,
          'originalPayload.testId': testId,
        },
        { timeout: 60 }
      );
      failingExecutionArn = await findExecutionArn(
        stackName,
        (execution) =>
          get(execution, 'originalPayload.testId') === failingTestId,
        {
          timestamp__from: ingestTime,
          'originalPayload.testId': failingTestId,
        },
        { timeout: 60 }
      );
      cumulusMessage = fakeCumulusMessageFactory({
        cumulus_meta: {
          state_machine: getStateMachineArnFromExecutionArn(executionArn),
          execution_name: executionArn.split(':').pop(),
        },
        meta: {
          provider: testProvider,
          collection: {
            name: testCollection.name,
            version: testCollection.version,
          },
        },
        payload: {
          granules: [testGranule],
        },
      });

      const failingExecutionName = failingExecutionArn.split(':').pop();
      failingMessage = fakeCumulusMessageFactory({
        cumulus_meta: {
          state_machine: getStateMachineArnFromExecutionArn(executionArn),
          execution_name: failingExecutionName,
        },
        meta: {
          status: 'failed',
          collection: 'bad-collection',
          provider: 'fake-provider',
        },
        payload: {
          granules: [testGranule],
        },
      });
      archivePath = `${stackName}/dead-letter-archive-${testId}/sqs`;
      messageKey = `${archivePath}/${cumulusMessage.cumulus_meta.execution_name}`;
      failingMessageKey = `${archivePath}/${failingMessage.cumulus_meta.execution_name}`;

      await Promise.all([
        putJsonS3Object(systemBucket, messageKey, cumulusMessage),
        putJsonS3Object(systemBucket, failingMessageKey, failingMessage),
      ]);

      const postRecoverResponse = await postRecoverCumulusMessages(
        {
          prefix: stackName,
          payload: {
            bucket: systemBucket,
            path: archivePath,
          },
        }
      );
      const postRecoverResponseBody = JSON.parse(postRecoverResponse.body);
      deadLetterRecoveryAsyncOpId = postRecoverResponseBody.id;
      console.log('dead letter recover async operation ID', deadLetterRecoveryAsyncOpId);
    } catch (error) {
      beforeAllFailed = error;
      console.log('beforeAll() failed, error:', error);
    }
  });

  afterAll(async () => {
    const ruleName = get(testRule, 'name');
    const failedRuleName = get(failingTestRule, 'name');
    if (testGranule) {
      await deleteGranule(
        { prefix: stackName, granuleId: testGranule.granuleId, collectionId }
      );
    }
    if (ruleName) {
      await deleteRule({ prefix: stackName, ruleName });
      await deleteRule({ prefix: stackName, ruleName: failedRuleName });
    }

    await deleteAsyncOperation({
      prefix: stackName,
      asyncOperationId: deadLetterRecoveryAsyncOpId,
    });

    await deleteExecution({ prefix: stackName, executionArn });
    await deleteExecution({ prefix: stackName, executionArn: failingExecutionArn });

    if (testCollection) {
      await deleteCollection(
        {
          prefix: stackName,
          collectionName: testCollection.name,
          collectionVersion: testCollection.version,
        }
      );
    }
    if (testProvider) {
      await deleteProvider(
        { prefix: stackName, providerId: testProvider.id }
      );
    }

    await deleteS3Object(systemBucket, newArchiveKey);
  });

  it('starts a successful async operation', async () => {
    if (beforeAllFailed) fail(beforeAllFailed);

    deadLetterRecoveryAsyncOperation = await waitForApiStatus(
      getAsyncOperation,
      {
        prefix: stackName,
        asyncOperationId: deadLetterRecoveryAsyncOpId,
      },
      'SUCCEEDED'
    );
    expect(deadLetterRecoveryAsyncOperation.status).toEqual('SUCCEEDED');
  });

  it('returns the correct output for the async operation', () => {
    if (beforeAllFailed) fail(beforeAllFailed);
    expect(deadLetterRecoveryAsyncOperation.output).toEqual(JSON.stringify({
      processingFailedKeys: [failingMessageKey],
      processingSucceededKeys: [messageKey],
    }));
  });

  it('processes a message to create records', async () => {
    if (beforeAllFailed) fail(beforeAllFailed);
    else {
      await expectAsync(waitForGranule({
        prefix: stackName,
        granuleId: testGranule.granuleId,
        collectionId: testGranule.collectionId,
        pRetryOptions: {
          interval: 5 * 1000,
          timeout: 30 * 1000,
        },
      })).toBeResolved();
    }
  });

  it('deletes the s3 objects corresponding to successfully processed dead letters', async () => {
    if (beforeAllFailed) fail(beforeAllFailed);
    else {
      expect(await s3ObjectExists({ Bucket: systemBucket, Key: messageKey })).toBeFalse();
    }
  });

  it('transfers the s3 objects corresponding to unsuccessfully processed dead letters to a new location in s3', async () => {
    if (beforeAllFailed) fail(beforeAllFailed);
    else {
      // Unsuccessfully processed dead letters should be deleted from old location
      expect(await s3ObjectExists({ Bucket: systemBucket, Key: failingMessageKey })).toBeFalse();

      newArchiveKey = generateNewArchiveKeyForFailedMessage(failingMessageKey);
      expect(await s3ObjectExists({ Bucket: systemBucket, Key: newArchiveKey })).toBeTrue();
    }
  });
});
