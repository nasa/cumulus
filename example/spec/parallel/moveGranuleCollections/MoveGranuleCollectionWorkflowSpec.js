const { deleteExecution } = require('@cumulus/api-client/executions');
const fs = require('fs');
const { waitForListObjectsV2ResultCount, addCollections, addProviders } = require('@cumulus/integration-tests');
const {
  deleteS3Object,
  s3ObjectExists,
} = require('@cumulus/aws-client/S3');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { deleteGranule, getGranule, removePublishedGranule } = require('@cumulus/api-client/granules');
const { buildAndStartWorkflow, buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');
const { loadConfig, createTestSuffix, createTimestampedTestId, uploadTestDataToBucket, createTestDataPath } = require('../../helpers/testUtils');
const { waitForApiStatus } = require('../../helpers/apiUtils');
const { setupTestGranuleForIngest } = require('../../helpers/granuleUtils');
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

const inputPayloadFilename = './spec/parallel/ingestGranule/IngestGranule.input.payload.json';

describe('The MoveGranuleCollections workflow', () => {
  let stackName;
  let config;
  let inputPayload;
  let provider;
  let testDataFolder;
  let granuleId;
  let finalFiles;
  let beforeAllFailed = false;
  let ingestExecutionArn;
  let cleanupCollectionId;
  let moveExecutionArn;
  let collection;
  let targetCollection;
  beforeAll(async () => {
    config = await loadConfig();
    stackName = config.stackName;
    const testId = createTimestampedTestId(stackName, 'IngestGranuleSuccess');
    const testSuffix = createTestSuffix(testId);
    testDataFolder = createTestDataPath(testId);

    collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
    targetCollection = { name: `MOD09GQ${testSuffix}`, version: '007' };
    cleanupCollectionId = constructCollectionId(collection.name, collection.version);
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
      stackName, config.bucket, workflowName, collection, provider, inputPayload
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
    const startingGranule = await getGranule({
      prefix: stackName,
      granuleId,
    });
    finalFiles = startingGranule.files.map((file) => ({
      ...file,
      key: `changedCollectionPath/MOD09GQ${testSuffix}___007/${testId}/${file.fileName}`,
    }));
    try {
      await buildAndExecuteWorkflow(
        stackName,
        config.bucket,
        'MoveGranuleCollectionsWorkflow',
        collection,
        provider,
        {
          granuleIds: [granuleId],
        },
        {
          targetCollection,
        }
      )
    } catch (error) {
      console.log(`files do not appear to have been moved: error: ${error}`);
      beforeAllFailed = true;
    }
  });
  afterAll(async () => {
    try {
      await removePublishedGranule({
        prefix: stackName,
        granuleId,
        collectionId: cleanupCollectionId,
      });
      let cleanup = finalFiles.map((fileObj) => deleteS3Object(
        fileObj.bucket,
        fileObj.key
      ));
      cleanup = cleanup.concat([
        deleteExecution({ prefix: stackName, executionArn: ingestExecutionArn }),
        deleteExecution({ prefix: stackName, executionArn: moveExecutionArn }),
        deleteGranule({ prefix: stackName, granuleId: granuleId }),
      ]);
      await Promise.all(cleanup);
    } catch (error) {
      console.log('cleanup failed with error', error);
    }
  });
  it('updates the granule data in s3', async () => {
    if (beforeAllFailed) fail('beforeAllFailed');
    await Promise.all(finalFiles.map(async (file) => {
      expect(await s3ObjectExists({ Bucket: file.bucket, Key: file.key })).toEqual(true);
    }));
  });
  it('updates the granule data in pg', async () => {
    if (beforeAllFailed) fail('beforeAllFailed');
    const pgGranule = await getGranule({
      prefix: stackName,
      granuleId
    });
    expect(pgGranule.collectionId).toEqual(
      constructCollectionId(targetCollection.name, targetCollection.version)
    );
    const finalKeys = finalFiles.map((file) => file.key);
    const finalBuckets = finalFiles.map((file) => file.bucket);
    pgGranule.files.forEach((file) => {
      expect(finalKeys.includes(file.key)).toBeTrue()
      expect(finalBuckets.includes(file.bucket)).toBeTrue()
    })
  });
});
