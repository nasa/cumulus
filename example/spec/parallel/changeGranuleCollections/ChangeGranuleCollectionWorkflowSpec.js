const { deleteExecution } = require('@cumulus/api-client/executions');
const { collectionExists } = require('../../helpers/Collections');
const fs = require('fs');
const { addCollections, addProviders } = require('@cumulus/integration-tests');
const { deleteS3Object, s3ObjectExists } = require('@cumulus/aws-client/S3');
const { constructCollectionId } = require('@cumulus/message/Collections');
const {
  getGranule,
  removePublishedGranule,
  bulkChangeCollection,
} = require('@cumulus/api-client/granules');
const { getExecution } = require('@cumulus/api-client/executions');
const { getCmrSettings } = require('@cumulus/cmrjs/cmr-utils');
const { CMR } = require('@cumulus/cmr-client');
const { lambda } = require('@cumulus/aws-client/services');
const { GetFunctionConfigurationCommand } = require('@aws-sdk/client-lambda');
const {
  buildAndStartWorkflow,
} = require('../../helpers/workflowUtils');
const {
  loadConfig,
  createTimestampedTestId,
  uploadTestDataToBucket,
  createTestDataPath,
  createTestSuffix,
} = require('../../helpers/testUtils');
const { waitForApiStatus } = require('../../helpers/apiUtils');
const { setupTestGranuleForIngest } = require('../../helpers/granuleUtils');
const { deleteCollection } = require('@cumulus/api-client/collections');
const workflowName = 'IngestAndPublishGranule';

const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

const s3data = [
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
  '@cumulus/test-data/granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg',
];

const providersDir = './data/providers/s3/';
const collectionsDir = './data/collections/s3_MOD09GQ_006_full_ingest';
const targetCollectionsDir =
  './data/collections/s3_MOD09GQ-AZ_006_full_ingest_move';

const inputPayloadFilename =
  './spec/parallel/ingestGranule/IngestGranule.input.payload.json';

async function getCMRClient(config) {
  const lambdaFunction = `${config.stackName}-CreateReconciliationReport`;
  const lambdaConfig = await lambda().send(new GetFunctionConfigurationCommand({ FunctionName: lambdaFunction }));
  Object.entries(lambdaConfig.Environment.Variables).forEach(([key, value]) => {
    process.env[key] = value;
  });
  return new CMR(await getCmrSettings());
}

describe('The ChangeGranuleCollections workflow', () => {
  let stackName;
  let config;
  let inputPayload;
  let provider;
  let testDataFolder;
  let granuleId;
  let finalFiles;
  let beforeAllFailed = false;
  let ingestExecutionArn;
  let moveExecutionArn;
  let collection;
  let sourceCollectionId;
  let targetCollection;
  let targetCollectionId;
  let startingGranuleFiles;
  let startingCollectionConceptId;
  let cmrClient;
  beforeAll(async () => {
    config = await loadConfig();
    cmrClient = await getCMRClient(config);
    stackName = config.stackName;
    const testId = createTimestampedTestId(stackName, 'changeGranuleCollectionWorkflow');
    const testSuffix = createTestSuffix(testId);
    testDataFolder = createTestDataPath(testId);

    collection = { name: 'MOD09GQ', version: '006' };
    targetCollection = { name: 'MOD09GQ-AZ', version: '006' };
    sourceCollectionId = constructCollectionId(
      collection.name,
      collection.version
    );
    targetCollectionId = constructCollectionId(
      targetCollection.name,
      targetCollection.version
    );
    provider = { id: `s3_provider${testSuffix}` };
    // populate collections if necessary
    if (!(await collectionExists(stackName, collection))) {
      await addCollections(
        stackName,
        config.bucket,
        collectionsDir
      );
    }
    if (!(await collectionExists(stackName, targetCollection))) {
      await addCollections(
        stackName,
        config.bucket,
        collectionsDir
      );
    }
    // providers and test data
    await Promise.all([
      uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
      addProviders(
        stackName,
        config.bucket,
        providersDir,
        config.bucket,
        testSuffix
      ),
    ]);


    const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    // update test data filepaths
    inputPayload = await setupTestGranuleForIngest(
      config.bucket,
      JSON.stringify({ ...JSON.parse(inputPayloadJson), pdr: undefined }),
      granuleRegex,
      '',
      testDataFolder
    );
    granuleId = inputPayload.granules[0].granuleId;
    ingestExecutionArn = await buildAndStartWorkflow(
      stackName,
      config.bucket,
      workflowName,
      collection,
      provider,
      inputPayload
    );

    await waitForApiStatus(
      getGranule,
      {
        prefix: stackName,
        granuleId: inputPayload.granules[0].granuleId,
        collectionId: constructCollectionId(
          collection.name,
          collection.version
        ),
      },
      'completed'
    );
    const { cmrLink } = await getGranule({
      prefix: stackName,
      granuleId: inputPayload.granules[0].granuleId,
    });
    const cmrGranule = await cmrClient.getGranuleMetadata(cmrLink);
    startingCollectionConceptId = cmrGranule.collection_concept_id;
    startingGranuleFiles = (
      await getGranule({
        prefix: stackName,
        granuleId,
      })
    ).files;

    finalFiles = startingGranuleFiles.map((file) => ({
      ...file,
      key: `changedCollectionPath/MOD09GQ-AZ___006/${file.fileName}`,
    }));

    try {
      const bulkMoveResponse = await bulkChangeCollection({
        prefix: stackName,
        body: {
          sourceCollectionId: sourceCollectionId,
          targetCollectionId: targetCollectionId,
        },
      });
      moveExecutionArn = JSON.parse(bulkMoveResponse.body).execution;
      await waitForApiStatus(
        getExecution,
        {
          prefix: stackName,
          arn: moveExecutionArn,
        },
        ['completed', 'failed']
      );
    } catch (error) {
      console.log(`files do not appear to have been moved: error: ${error}`);
      beforeAllFailed = true;
    }
  });

  afterAll(async () => {
    try {
      await Promise.all(
        [].concat(
          finalFiles.map((fileObj) =>
            deleteS3Object(fileObj.bucket, fileObj.key)),
          startingGranuleFiles.map((fileObj) =>
            deleteS3Object(fileObj.bucket, fileObj.key))
        )
      );
    } catch (error) {
      console.log(`Error deleting s3 objects: ${error}`);
    }
    let cleanup = [];
    cleanup = cleanup.concat([
      deleteExecution({ prefix: stackName, executionArn: ingestExecutionArn }),
      deleteExecution({ prefix: stackName, executionArn: moveExecutionArn }),
      deleteCollection({
        prefix: stackName,
        collectionName: collection.name,
        collectioNVersion: collection.version
      }),
      deleteCollection({
        prefix: stackName,
        collectionName: targetCollection.name,
        collectioNVersion: targetCollection.version
      }),
      removePublishedGranule({
        prefix: stackName,
        granuleId,
      }),
    ]);
    await Promise.all(cleanup);
  });

  it('updates the granule data in s3', async () => {
    if (beforeAllFailed) fail('beforeAllFailed');
    await Promise.all(
      finalFiles.map(async (file) => {
        expect(
          await s3ObjectExists({ Bucket: file.bucket, Key: file.key })
        ).toEqual(true);
      })
    );
  });

  it('updates the granule data in pg', async () => {
    if (beforeAllFailed) fail('beforeAllFailed');
    const pgGranule = await getGranule({
      prefix: stackName,
      granuleId,
    });
    expect(pgGranule.collectionId).toEqual(
      constructCollectionId(targetCollection.name, targetCollection.version)
    );
    const finalKeys = finalFiles.map((file) => file.key);
    const finalBuckets = finalFiles.map((file) => file.bucket);
    pgGranule.files.forEach((file) => {
      expect(finalKeys.includes(file.key)).toBeTrue();
      expect(finalBuckets.includes(file.bucket)).toBeTrue();
    });
  });
  it('updates the granule data in cmr', async () => {
    const pgGranule = await getGranule({
      prefix: stackName,
      granuleId,
    });
    const cmrMetadata = await cmrClient.getGranuleMetadata(pgGranule.cmrLink);
    expect(cmrMetadata.collection_concept_id === startingCollectionConceptId).toBeFalse();
    const metadataLinks = cmrMetadata.links.map((linkObj) => linkObj.href);
    finalFiles.forEach((finalFile) => {
      if (!finalFile.bucket.includes('private')) {
        expect(metadataLinks).toContain(`s3://${finalFile.bucket}/${finalFile.key}`);
      }
    });
  });
  it('cleans up old files in s3', async () => {
    if (beforeAllFailed) fail('beforeAllFailed');
    await Promise.all(
      startingGranuleFiles.map(async (file) => {
        expect(
          await s3ObjectExists({ Bucket: file.bucket, Key: file.key })
        ).toEqual(false);
      })
    );
  });
});
