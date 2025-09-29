'use strict';

const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const { addCollections, waitForAsyncOperationStatus } = require('@cumulus/integration-tests');
const {
  bulkArchiveGranules,
  createGranule,
  getGranule,
  deleteGranule,
} = require('@cumulus/api-client/granules');
const { deleteCollection } = require('@cumulus/api-client/collections');
const { constructCollectionId, deconstructCollectionId } = require('@cumulus/message/Collections');
const { fakeExecutionFactoryV2, fakeGranuleFactoryV2 } = require('@cumulus/api/lib/testUtils');
const { createExecution, getExecution, bulkArchiveExecutions, deleteExecution } = require('@cumulus/api-client/executions');
const {
  loadConfig,
  createTimestampedTestId,
  createTestSuffix,
} = require('../../helpers/testUtils');

describe('when ArchiveGranules is called', () => {
  let testSetupFailed;
  let stackName;
  let config;
  let granuleId;
  let executionArn;
  let collectionId;

  beforeAll(async () => {
    try {
      const collectionsDir = './data/collections/s3_MOD09GQ_006_full_ingest';
      config = await loadConfig();
      stackName = config.stackName;
      const testId = createTimestampedTestId(stackName, 'archiveGranules');
      const testSuffix = createTestSuffix(testId);

      // populate collections, providers and test data
      const [collection] = await addCollections(
        stackName, config.bucket, collectionsDir, testSuffix, testId
      );
      collectionId = constructCollectionId(collection.name, collection.version);

      const executionObject = fakeExecutionFactoryV2({
        executionId: uuidv4(),
        collectionId,
        status: 'completed',
        updatedAt: moment().subtract(1, 'year').subtract(1, 'month').toDate().getTime(), // more than a year ago
      });
      executionArn = executionObject.arn;
      await createExecution({
        prefix: config.stackName,
        body: executionObject,
      });
      const granuleObject = fakeGranuleFactoryV2({
        collectionId,
        published: false,
        updatedAt: moment().subtract(1, 'year').subtract(1, 'month').toDate().getTime(), // more than a year ago
        execution: executionObject.execution,
      });
      granuleId = granuleObject.granuleId;
      await createGranule({
        prefix: config.stackName,
        body: granuleObject,
      });
    } catch (error) {
      console.log('setup test failed with', error);
      testSetupFailed = true;
    }
  });

  afterAll(async () => {
    const { name: collectionName, version: collectionVersion } = deconstructCollectionId(collectionId);
    const cleanup = [
      deleteGranule({ prefix: config.stackName, granuleId }),
      deleteExecution({ prefix: config.stackName, executionArn }),
      deleteCollection({ prefix: config.stackName, collectionName, collectionVersion }),
    ];
    await Promise.all(cleanup);
  });

  describe('The lambda, when invoked with an expected payload', () => {
    it('does archive records older than expirationDays', async () => {
      if (testSetupFailed) fail('test setup failed');
      let res = await bulkArchiveGranules({
        prefix: stackName,
        body: {
          expirationDays: 365,
        },
      });

      await waitForAsyncOperationStatus({
        id: JSON.parse(res.body).id,
        status: 'SUCCEEDED',
        stackName: config.stackName,
        retryOptions: {
          retries: 70,
          factor: 1.041,
        },
      });
      const granuleDetails = await getGranule({
        prefix: stackName,
        granuleId: granuleId,
      });
      expect(granuleDetails.archived).toEqual(true);
      res = await bulkArchiveExecutions({
        prefix: stackName,
        body: {
          expirationDays: 365,
        },
      });
      await waitForAsyncOperationStatus({
        id: JSON.parse(res.body).id,
        status: 'SUCCEEDED',
        stackName: config.stackName,
        retryOptions: {
          retries: 70,
          factor: 1.041,
        },
      });

      const executionDetails = await getExecution({
        prefix: stackName,
        arn: executionArn,
      });
      expect(executionDetails.archived).toEqual(true);
    });
  });
});
