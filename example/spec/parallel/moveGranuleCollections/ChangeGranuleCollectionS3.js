'use strict';

const { InvokeCommand } = require('@aws-sdk/client-lambda');
const { lambda } = require('@cumulus/aws-client/services');
const fs = require('fs');
const {
  deleteS3Object,
  s3ObjectExists,
} = require('@cumulus/aws-client/S3');
const { waitForListObjectsV2ResultCount, addCollections, addProviders } = require('@cumulus/integration-tests');

const { getGranule, deleteGranule, removePublishedGranule } = require('@cumulus/api-client/granules');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { deleteExecution } = require('@cumulus/api-client/executions');
const { setupTestGranuleForIngest } = require('../../helpers/granuleUtils');
const { waitForApiStatus } = require('../../helpers/apiUtils');
const { buildAndStartWorkflow } = require('../../helpers/workflowUtils');
const { loadConfig, createTimestampedTestId, createTestSuffix, createTestDataPath, uploadTestDataToBucket } = require('../../helpers/testUtils');

describe('when ChangeGranuleCollectionS3 is called', () => {
  let stackName;
  let config;
  let inputPayload;
  let provider;
  let testDataFolder;
  let granuleId;
  let startingFiles;
  let finalFiles;
  let collection;
  let targetCollection;
  let ingestExecutionArn;
  let cleanupCollectionId;
  afterAll(async () => {
    try {
      await removePublishedGranule({
        prefix: config.stackName,
        granuleId,
        collectionId: cleanupCollectionId,
      });
      let cleanup = finalFiles.map((fileObj) => deleteS3Object(
        fileObj.bucket,
        fileObj.key
      ));
      cleanup.concat(startingFiles.map((fileObj) => deleteS3Object(
        fileObj.bucket,
        fileObj.key
      )));
      cleanup = cleanup.concat([
        deleteExecution({ prefix: config.stackName, executionArn: ingestExecutionArn }),
        deleteGranule({ prefix: config.stackName, granuleId: granuleId }),
      ]);

      await Promise.all(cleanup);
    } catch (error) {
      console.log('cleanup failed with error', error);
    }
  });
  beforeAll(async () => {
    const inputPayloadFilename = './spec/parallel/ingestGranule/IngestGranule.input.payload.json';
    const providersDir = './data/providers/s3/';
    const s3data = [
      '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
      '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
      '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg',
    ];

    const collectionsDir = './data/collections/s3_MOD09GQ_006_full_ingest';
    const targetCollectionsDir = './data/collections/s3_MOD09GQ_007_full_ingest_move';
    const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
    config = await loadConfig();
    stackName = config.stackName;
    const testId = createTimestampedTestId(stackName, 'IngestGranuleSuccess');
    const testSuffix = createTestSuffix(testId);
    testDataFolder = createTestDataPath(testId);

    collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
    targetCollection = { name: `MOD09GQ${testSuffix}`, version: '007' };
    provider = { id: `s3_provider${testSuffix}` };

    // populate collections, providers and test data
    await Promise.all([
      uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
      addCollections(stackName, config.bucket, collectionsDir, testSuffix, testId),
      addCollections(stackName, config.bucket, targetCollectionsDir, testSuffix, testId),
      addProviders(stackName, config.bucket, providersDir, config.bucket, testSuffix),
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

    ingestExecutionArn = await buildAndStartWorkflow(
      stackName,
      config.bucket,
      'IngestAndPublishGranuleWithOrca',
      collection,
      provider,
      inputPayload
    );

    await waitForApiStatus(
      getGranule,
      {
        prefix: stackName,
        granuleId: inputPayload.granules[0].granuleId,
        collectionId: constructCollectionId(collection.name, collection.version),
      },
      'completed'
    );
  });

  describe('under normal circumstances', () => {
    let beforeAllFailed = false;
    beforeAll(async () => {
      startingFiles = (await getGranule({
        prefix: stackName,
        granuleId: granuleId,
      })).files;
      //upload to cumulus
      try {
        const { $metadata, Payload } = await lambda().send(new InvokeCommand({
          FunctionName: `${stackName}-ChangeGranuleCollectionS3`,
          InvocationType: 'RequestResponse',
          Payload: JSON.stringify({
            cma: {
              meta: {
                targetCollection,
                collection,
                buckets: config.buckets,
              },
              task_config: {
                buckets: '{$.meta.buckets}',
                collection: '{$.meta.collection}',
                targetCollection: '{$.meta.targetCollection}',
              },
              event: {
                payload: { granuleIds: [granuleId] },
              },
            },
          }),
        }));
        const outputGranule = JSON.parse(new TextDecoder('utf-8').decode(Payload)).payload.granules[0];
        if ($metadata.httpStatusCode >= 400) {
          console.log(`lambda invocation to set up failed, code ${$metadata.httpStatusCode}`);
        }
        finalFiles = outputGranule.files;
        await Promise.all(finalFiles.map((file) => expectAsync(
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
      await Promise.all(finalFiles.map(async (file) => {
        expect(await s3ObjectExists({ Bucket: file.bucket, Key: file.key })).toEqual(true);
      }));
    });
    it('keeps old s3 files as well', async () => {
      if (beforeAllFailed) fail('beforeAllFailed');
      await Promise.all(startingFiles.map(async (file) => {
        expect(await s3ObjectExists({ Bucket: file.bucket, Key: file.key })).toEqual(true);
      }));
    });
  });
});
