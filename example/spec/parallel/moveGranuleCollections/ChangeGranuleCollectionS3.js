'use strict';

const { InvokeCommand } = require('@aws-sdk/client-lambda');
const { lambda } = require('@cumulus/aws-client/services');
const fs = require('fs');
const {
  deleteS3Object,
  s3ObjectExists,
} = require('@cumulus/aws-client/S3');
const { waitForListObjectsV2ResultCount, addCollections, addProviders } = require('@cumulus/integration-tests');

const { v4: uuidv4 } = require('uuid');
const { loadConfig, createTimestampedTestId, createTestSuffix, createTestDataPath, uploadTestDataToBucket } = require('../../helpers/testUtils');
const { getProcessGranule, setupInitialState, getPayload, getTargetFiles } = require('./move-granule-collection-spec-utils');
const { setupTestGranuleForIngest } = require('../../helpers/granuleUtils');
const { waitForApiStatus } = require('../../helpers/apiUtils');
const { buildAndStartWorkflow } = require('../../helpers/workflowUtils');
const { getGranule } = require('@cumulus/api-client/granules');
const { constructCollectionId } = require('@cumulus/message/Collections');

const workflowName = 'IngestAndPublishGranuleWithOrca';

const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg',
];

const providersDir = './data/providers/s3/';
const collectionsDir = './data/collections/s3_MOD09GQ_006_full_ingest';
const targetCollectionsDir = './data/collections/s3_MOD09GQ_007_full_ingest_move';
let collection;
let targetCollection;
const inputPayloadFilename = './spec/parallel/ingestGranule/IngestGranule.input.payload.json';


describe('when moveGranulesCollection is called', () => {
  let stackName;
  const sourceUrlPrefix = `source_path/${uuidv4()}`;
  const targetUrlPrefix = `target_path/${uuidv4()}`;
  let processGranule;
  let config;
  let inputPayload;
  let provider;
  let testDataFolder;
  let workflowExecutionArn;
  let granuleId;
  let filesCopiedToOrca;
  beforeAll(async () => {
    config = await loadConfig();
    stackName = config.stackName;
    processGranule = getProcessGranule(sourceUrlPrefix, config);
    const testId = createTimestampedTestId(config.stackName, 'OrcaBackupAndRecovery');
    const testSuffix = createTestSuffix(testId);
    testDataFolder = createTestDataPath(testId);

    collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
    targetCollection = { name: `MOD09GQ${testSuffix}`, version: '007' };
    provider = { id: `s3_provider${testSuffix}` };

    // populate collections, providers and test data
    await Promise.all([
      uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
      addCollections(config.stackName, config.bucket, collectionsDir, testSuffix, testId),
      addCollections(config.stackName, config.bucket, targetCollectionsDir, testSuffix, testId),
      addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix),
    ]);

    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    // update test data filepaths
    inputPayload = await setupTestGranuleForIngest(
      config.bucket,
      JSON.stringify({ ...JSON.parse(inputPayloadJson), pdr: undefined }),
      granuleRegex,
      testSuffix,
      testDataFolder
    );
    granuleId = inputPayload.granules[0].granuleId;

    workflowExecutionArn = await buildAndStartWorkflow(
      config.stackName, config.bucket, workflowName, collection, provider, inputPayload
    );

    await waitForApiStatus(
      getGranule,
      {
        prefix: config.stackName,
        granuleId: inputPayload.granules[0].granuleId,
        collectionId: constructCollectionId(collection.name, collection.version),
      },
      'completed'
    );
  });

  describe('under normal circumstances', () => {
    let beforeAllFailed = false;
    let finalFiles;
    afterAll(async () => {
      await Promise.all(inputPayload.granules[0].files.map((fileObj) => deleteS3Object(
        fileObj.bucket,
        fileObj.key
      )));
    });
    beforeAll(async () => {
      const payload = getPayload(sourceUrlPrefix, targetUrlPrefix, config);
      //upload to cumulus
      try {
        await setupInitialState(stackName, sourceUrlPrefix, targetUrlPrefix, config);
        const { $metadata } = await lambda().send(new InvokeCommand({
          FunctionName: `${stackName}-ChangeGranuleCollectionS3`,
          InvocationType: 'RequestResponse',
          Payload: JSON.stringify({
            cma: {
              meta: {
                targetCollection,
                collection,
                buckets: config.buckets
              },
              task_config: {
                buckets: '{$.meta.buckets}',
                collection: '{$.meta.collection}',
                targetCollection: '{$.meta.targetCollection}',
              },
              event: {
                payload: {granuleIds: [granuleId]}
              },
            },
          }),
        }));
        if ($metadata.httpStatusCode >= 400) {
          console.log(`lambda invocation to set up failed, code ${$metadata.httpStatusCode}`);
          beforeAllFailed = true;
        }
        await Promise.all(inputPayload.granules[0].files.map((file) => expectAsync(
          waitForListObjectsV2ResultCount({
            bucket: file.bucket,
            prefix: file.key,
            desiredCount: 1,
            interval: 5 * 1000,
            timeout: 60 * 1000,
          })
        ).toBeResolved()));
      } catch (error) {
        console.log(`files do not appear to have been moved: error: ${error}`);
        beforeAllFailed = true;
      }
    });
    it('updates the granule data in s3', async () => {
      if (beforeAllFailed) fail('beforeAllFailed');
      await Promise.all(load.granules[0].files.map(async (file) => {
        expect(await s3ObjectExists({ Bucket: file.bucket, Key: file.key })).toEqual(true);
      }));
    });
    // it('keeps old s3 files as well', async () => {
    //   if (beforeAllFailed) fail('beforeAllFailed');
    //   await Promise.all(processGranule.files.map(async (file) => {
    //     expect(await s3ObjectExists({ Bucket: file.bucket, Key: file.key })).toEqual(true);
    //   }));
    // });
  });
});
