'use strict';

const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const pick = require('lodash/pick');
const {
  deleteS3Object,
} = require('@cumulus/aws-client/S3');

const { addCollections, addProviders, waitForAsyncOperationStatus } = require('@cumulus/integration-tests');

const {
  bulkArchiveGranules,
  createGranule,
  getGranule,
  deleteGranule,
} = require('@cumulus/api-client/granules');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { fakeExecutionFactoryV2 } = require('@cumulus/api/lib/testUtils');
const { createExecution, getExecution, bulkArchiveExecutions } = require('@cumulus/api-client/executions');
const { setupTestGranuleForIngest } = require('../../helpers/granuleUtils');
const {
  loadConfig,
  createTimestampedTestId,
  createTestSuffix,
  uploadTestDataToBucket,
  deleteFolder,
} = require('../../helpers/testUtils');

describe('when ArchiveGranules is called', () => {
  const monthEpoch = 2629743000;
  const yearEpoch = 31556926000;
  let testSetupFailed;
  let stackName;
  let config;
  let inputPayload;
  let granuleId;
  let sourceGranulePath;
  let granuleObject;
  let executionObject;
  let executionId;

  afterAll(async () => {
    // Remove all the setup data - all keys at s3://${config.bucket}/sourceGranulePath
    let cleanup = [];
    cleanup.concat([
      Promise.all(granuleObject.body.files.map((file) => deleteS3Object(file.bucket, file.key))),
    ]);
    cleanup.concat([
      deleteFolder(config.bucket, sourceGranulePath),
    ]);
    cleanup = cleanup.concat([
      deleteGranule({ prefix: config.stackName, granuleId: granuleId }),
    ]);
    await Promise.all(cleanup);
  });

  beforeAll(async () => {
    try {
      const inputPayloadFilename = './data/payloads/IngestGranule.input.payload.json';
      const providersDir = './data/providers/s3/';
      const s3data = [
        '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104607.hdf.met',
        '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104607.hdf',
        '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104607_ndvi.jpg',
      ];

      const collectionsDir = './data/collections/s3_MOD09GQ_006_full_ingest';
      const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
      config = await loadConfig();
      stackName = config.stackName;
      const testId = createTimestampedTestId(stackName, 'archiveGranules');
      const testSuffix = createTestSuffix(testId);

      sourceGranulePath = `${stackName}/${testSuffix}/${testId}`;

      // populate collections, providers and test data
      await Promise.all([
        // Instead of uploading data to a bucket and triggering a workflow, let's just put the object in S3
        // and then call the API directly to write the granule record to the database
        uploadTestDataToBucket(config.bucket, s3data, sourceGranulePath),
        addCollections(stackName, config.bucket, collectionsDir, testSuffix, testId),
        addProviders(stackName, config.bucket, providersDir, config.bucket, testSuffix),
      ]);

      const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
      // update test data filepaths
      inputPayload = await setupTestGranuleForIngest(
        config.bucket,
        JSON.stringify({
          ...JSON.parse(inputPayloadJson),
          pdr: undefined,
        }),
        granuleRegex,
        testSuffix,
        sourceGranulePath
      );
      // Write granule to DB via API
      granuleId = inputPayload.granules[0].granuleId;
      granuleObject = {
        prefix: stackName,
        body: {
          producerGranuleId: inputPayload.granules[0].granuleId,
          ...(pick(inputPayload.granules[0], ['granuleId', 'files'])),
          collectionId: constructCollectionId(inputPayload.granules[0].dataType, inputPayload.granules[0].version),
          status: 'completed',
          updatedAt: Date.now() - yearEpoch - monthEpoch, // more than a year ago
        },
      };
      granuleObject.body.files = granuleObject.body.files.map((file) => ({
        ...pick(file, ['size']),
        key: `${file.path}/${file.name}`,
        bucket: config.bucket,
      }));

      await createGranule({
        prefix: config.stackName,
        body: granuleObject.body,
      });
      executionId = uuidv4();
      executionObject = fakeExecutionFactoryV2({
        executionId,
        collectionId: granuleObject.collectionId,
        status: 'completed',
        updatedAt: Date.now() - yearEpoch - monthEpoch, // more than a year ago
      });
      await createExecution({
        prefix: config.stackName,
        body: executionObject,
      });
    } catch (error) {
      console.log('setup test failed with', error);
      testSetupFailed = true;
    }
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
        granuleId: granuleObject.body.granuleId,
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
        arn: executionObject.arn,
      });
      expect(executionDetails.archived).toEqual(true);
    });
  });
});
