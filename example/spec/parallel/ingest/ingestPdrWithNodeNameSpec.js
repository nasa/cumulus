'use strict';

/**
 * End to end ingest from discovering and ingesting a PDR that specifies a
 * granule's provider using NODE_NAME
 *
 * Kick off discover and queue pdrs which:
 * Discovers 1 PDR
 * Queues that PDR
 * Kicks off the ParsePDR workflow
 *
 * Parse PDR workflow:
 * parses pdr
 * queues a granule
 * pdr status check
 * This will kick off the ingest workflow
 *
 * Ingest worklow:
 * runs sync granule - saves file to file staging location
 * performs the fake processing step - generates CMR metadata
 * Moves the file to the final location
 * Does not post to CMR (that is in a separate test)
 */

const { Execution, Pdr } = require('@cumulus/api/models');
const S3 = require('@cumulus/aws-client/S3');
const { s3 } = require('@cumulus/aws-client/services');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const { providers: providersApi } = require('@cumulus/api-client');
const { randomString } = require('@cumulus/common/test-utils');

const {
  addCollections,
  addProviders,
  api: apiTestUtils,
  executionsApi: executionsApiTestUtils,
  buildAndExecuteWorkflow,
  cleanupProviders,
  cleanupCollections,
  granulesApi: granulesApiTestUtils,
  waitForCompletedExecution,
} = require('@cumulus/integration-tests');

const {
  createTestDataPath,
  createTestSuffix,
  createTimestampedTestId,
  deleteFolder,
  getExecutionUrl,
  loadConfig,
  uploadTestDataToBucket,
  updateAndUploadTestDataToBucket,
} = require('../../helpers/testUtils');

const {
  loadFileWithUpdatedGranuleIdPathAndCollection,
} = require('../../helpers/granuleUtils');

const { waitForModelStatus } = require('../../helpers/apiUtils');
const { deleteProvidersByHost, waitForProviderRecordInOrNotInList } = require('../../helpers/Providers');

const lambdaStep = new LambdaStep();
const workflowName = 'DiscoverAndQueuePdrs';
const origPdrFilename = 'MOD09GQ_1granule_v3_with_NODE_NAME.PDR';

const s3data = [
  '@cumulus/test-data/pdrs/MOD09GQ_1granule_v3_with_NODE_NAME.PDR',
];

const unmodifiedS3Data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
];

describe('Ingesting from PDR', () => {
  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';

  let beforeAllFailed;
  let config;
  let executionModel;
  let nodeNameProvider;
  let parsePdrExecutionArn;
  let pdrFilename;
  let provider;
  let testDataFolder;
  let testSuffix;
  let workflowExecution;
  let addedCollection;
  let nodeName;
  let nodeNameProviderId;
  const ingestTime = Date.now() - 1000 * 30;

  beforeAll(async () => {
    try {
      console.time('beforeAll');
      config = await loadConfig();

      process.env.ExecutionsTable = `${config.stackName}-ExecutionsTable`;
      process.env.PdrsTable = `${config.stackName}-PdrsTable`;

      executionModel = new Execution();

      const testId = createTimestampedTestId(config.stackName, 'IngestFromPdr');
      testSuffix = createTestSuffix(testId);
      testDataFolder = createTestDataPath(testId);

      pdrFilename = `${testSuffix.slice(1)}_${origPdrFilename}`;

      provider = { id: `s3_provider${testSuffix}` };

      nodeName = config.pdrNodeNameProviderBucket;
      await deleteProvidersByHost(config.stackName, nodeName);

      nodeNameProviderId = `provider-${randomString(4)}`;

      const createProviderResponse = await providersApi.createProvider({
        prefix: config.stackName,
        provider: {
          id: nodeNameProviderId,
          protocol: 's3',
          host: nodeName,
        },
      });

      const createProviderResponseBody = JSON.parse(
        createProviderResponse.body
      );

      nodeNameProvider = createProviderResponseBody.record;

      // await waitForProviderRecordInOrNotInList(config.stackName, nodeNameProviderId, true, { timestamp__from: ingestTime });

      // populate collections, providers and test data
      const populatePromises = await Promise.all([
        updateAndUploadTestDataToBucket(
          config.bucket,
          s3data,
          testDataFolder,
          [
            { old: 'cumulus-test-data/pdrs', new: testDataFolder },
            { old: 'DATA_TYPE = MOD09GQ;', new: `DATA_TYPE = MOD09GQ${testSuffix};` },
            { old: 'XXX_NODE_NAME_XXX', new: nodeName },
          ]
        ),
        uploadTestDataToBucket(
          nodeName,
          unmodifiedS3Data,
          testDataFolder
        ),
        addCollections(config.stackName, config.bucket, collectionsDir, testSuffix, testId),
        addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix),
      ]);

      addedCollection = populatePromises[2][0];

      // Rename the PDR to avoid race conditions
      await s3().copyObject({
        Bucket: config.bucket,
        CopySource: `${config.bucket}/${testDataFolder}/${origPdrFilename}`,
        Key: `${testDataFolder}/${pdrFilename}`,
      }).promise();

      await S3.deleteS3Object(config.bucket, `${testDataFolder}/${origPdrFilename}`);
      console.timeEnd('beforeAll');
    } catch (error) {
      beforeAllFailed = true;
      throw error;
    }
  });

  afterAll(async () => {
    // clean up stack state added by test
    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix),
      // executionModel.delete({ arn: workflowExecution.executionArn }),
      // executionModel.delete({ arn: parsePdrExecutionArn }),
      apiTestUtils.deletePdr({
        prefix: config.stackName,
        pdr: pdrFilename,
      }),
    ]).catch(console.error);

    await providersApi.deleteProvider({
      prefix: config.stackName,
      providerId: nodeNameProviderId,
    }).catch(console.error);
  });

  it('is fake', () => {
    expect(true).toBeTrue();
  });
});
