'use strict';

const get = require('lodash/get');
const pick = require('lodash/pick');
const {
  fakeCumulusMessageFactory,
  fakeFileFactory,
  fakeGranuleFactoryV2,
} = require('@cumulus/api/lib/testUtils');
const {
  createCollection, deleteCollection,
} = require('@cumulus/api-client/collections');
const { postRecoverCumulusMessages } = require('@cumulus/api-client/deadLetterArchive');
const { deleteGranule, waitForGranule } = require('@cumulus/api-client/granules');
const { createProvider, deleteProvider } = require('@cumulus/api-client/providers');
const { deleteRule } = require('@cumulus/api-client/rules');
const {
  loadCollection,
} = require('@cumulus/integration-tests');
const { findExecutionArn } = require('@cumulus/integration-tests/Executions');
const { createOneTimeRule } = require('@cumulus/integration-tests/Rules');
const { getStateMachineArnFromExecutionArn } = require('@cumulus/message/Executions');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { randomString } = require('@cumulus/common/test-utils');
const { putJsonS3Object } = require('@cumulus/aws-client/S3');
const { waitForListObjectsV2ResultCount } = require('@cumulus/integration-tests');

const { loadConfig } = require('../../helpers/testUtils');

describe('A dead letter record archive processing operation', () => {
  let beforeAllFailed = false;
  let stackName;
  let systemBucket;
  let testCollection;
  let testProvider;
  let testRule;
  let testGranule;
  let archivePath;
  let messageKey;

  beforeAll(async () => {
    try {
      const ingestTime = Date.now() - 1000 * 30;

      const config = await loadConfig();
      stackName = config.stackName;
      systemBucket = config.bucket;

      let response;
      const testId = randomString();

      testCollection = await loadCollection({
        filename: './data/collections/s3_MOD09GQ_006/s3_MOD09GQ_006.json',
        postfix: testId,
      });
      response = await createCollection({ prefix: stackName, collection: testCollection });
      if (response.statusCode !== 200) {
        throw new Error(`createCollection failed: ${JSON.stringify(response)}`);
      }

      testProvider = {
        id: `s3_provider_${testId}`,
        host: 'cumulus-sandbox-fake-s3-provider',
        protocol: 's3',
        globalConnectionLimit: 1000,
      };
      response = await createProvider({ prefix: stackName, provider: testProvider });
      if (response.statusCode !== 200) {
        throw new Error(`createProvider failed: ${JSON.stringify(response)}`);
      }

      const testFiles = [
        fakeFileFactory({ bucket: systemBucket }),
        fakeFileFactory({ bucket: systemBucket }),
      ];

      testGranule = fakeGranuleFactoryV2({
        granuleId: `MOD09GQ.${randomString()}.hdf`,
        collectionId: constructCollectionId(testCollection.name, testCollection.version),
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

      const executionArn = await findExecutionArn(
        stackName,
        (execution) =>
          get(execution, 'originalPayload.testId') === testId,
        { timestamp__from: ingestTime },
        { timeout: 60 }
      );

      const cumulusMessage = fakeCumulusMessageFactory({
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

      archivePath = `${stackName}/dead-letter-archive-${testId}/sqs`;
      messageKey = `${archivePath}/${cumulusMessage.cumulus_meta.execution_name}`;
      await putJsonS3Object(systemBucket, messageKey, cumulusMessage);

      response = await postRecoverCumulusMessages({
        prefix: stackName,
        payload: {
          bucket: systemBucket,
          path: archivePath,
        },
      });
      if (response.statusCode !== 202) {
        throw new Error(`postRecoverCumulusMessages failed: ${JSON.stringify(response)}`);
      }
    } catch (error) {
      beforeAllFailed = true;
      console.log('beforeAll() failed, error:', error);
    }
  });

  afterAll(async () => {
    const ruleName = get(testRule, 'name');
    if (testGranule) await deleteGranule({ prefix: stackName, granuleId: testGranule.granuleId });
    if (ruleName) await deleteRule({ prefix: stackName, ruleName });
    if (testCollection) {
      await deleteCollection({
        prefix: stackName,
        collectionName: testCollection.name,
        collectionVersion: testCollection.version,
      });
    }
    if (testProvider) await deleteProvider({ prefix: stackName, providerId: testProvider.id });
  });

  it('processes a message to create records', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      await expectAsync(waitForGranule({
        prefix: stackName,
        granuleId: testGranule.granuleId,
        pRetryOptions: {
          interval: 5 * 1000,
          timeout: 30 * 1000,
        },
      })).toBeResolved();
    }
  });

  it('deletes the s3 objects corresponding to successfully processed dead letters', async () => {
    if (beforeAllFailed) fail('beforeAll() failed');
    else {
      await expectAsync(waitForListObjectsV2ResultCount({
        bucket: systemBucket,
        prefix: archivePath,
        desiredCount: 0,
        interval: 5 * 1000,
        timeout: 30 * 1000,
      })).toBeResolved();
    }
  });
});
