const fs = require('fs');
const difference = require('lodash/difference');
const path = require('path');

const {
  getKnexClient,
  CollectionPgModel,
  translatePostgresGranuleToApiGranule,
} = require('@cumulus/db');
const {
  addCollections,
  addProviders,
  cleanupCollections,
  cleanupProviders,
  waitForCompletedExecution,
  waitForTestExecutionStart,
} = require('@cumulus/integration-tests');
const { updateCollection } = require('@cumulus/integration-tests/api/api');
const { deleteExecution } = require('@cumulus/api-client/executions');
const { getGranule, reingestGranule } = require('@cumulus/api-client/granules');
const { s3 } = require('@cumulus/aws-client/services');
const {
  s3GetObjectTagging,
  s3Join,
  s3ObjectExists,
} = require('@cumulus/aws-client/S3');
const { LambdaStep } = require('@cumulus/integration-tests/sfnStep');
const { getExecution } = require('@cumulus/api-client/executions');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { buildAndExecuteWorkflow } = require('../../helpers/workflowUtils');
const { waitForApiStatus } = require('../../helpers/apiUtils');
const {
  loadConfig,
  templateFile,
  uploadTestDataToBucket,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix,
  deleteFolder,
  getFilesMetadata,
} = require('../../helpers/testUtils');
const {
  setupTestGranuleForIngest,
  loadFileWithUpdatedGranuleIdPathAndCollection,
  waitForGranuleAndDelete,
} = require('../../helpers/granuleUtils');
const { isReingestExecutionForGranuleId } = require('../../helpers/workflowUtils');

const workflowName = 'SyncGranule';
const providersDir = './data/providers/s3/';
const collectionsDir = './data/collections/s3_MOD09GQ_006';
const getGranuleBatch = async (
  knex,
  collectionCumulusId,
  startAt,
  batchSize,
) => {
  return await knex('granules')
    .where({collection_cumulus_id: collectionCumulusId})
    .andWhere('cumulus_id', '>', startAt)
    .orderBy('cumulus_id')
    .limit(batchSize);
}
base_collection = { name: `MOD11A1`, version: '000' };
process.env.DISABLE_PG_SSL = 'true';
describe('The Sync Granules workflow', () => {
  let collection;
  let config;
  let expectedPayload;
  let expectedS3TagSet;
  let failingExecutionArn;
  let inputPayload;
  let lambdaStep;
  let provider;
  let reingestGranuleExecutionArn;
  let syncGranuleExecutionArn;
  let testDataFolder;
  let testSuffix;
  let workflowExecution;
  let newGranuleId;

  beforeAll(async () => {
    config = await loadConfig();
    lambdaStep = new LambdaStep();
    const testId = createTimestampedTestId(config.stackName, 'SyncGranuleSuccess');
    testSuffix = createTestSuffix(testId)
  });


  it('has a checksum to test', async () => {
    const knex = await getKnexClient();
    const collectionModel = new CollectionPgModel();
    collection = await collectionModel.get(knex, base_collection);

    // const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
    // update test data filepaths
    // inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, granuleRegex, testSuffix, testDataFolder);
    let cursor = 0;
    let granules = []

    provider = { id: `s3_provider${testSuffix}` };

    // populate collections, providers and test data
    await addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix);
    do {
      granules = await getGranuleBatch(
        knex,
        collection.cumulus_id,
        cursor, 1
      );
      console.log(granules)
      apiGranules = await Promise.all(granules.map((granulePgRecord) => translatePostgresGranuleToApiGranule(
        {
          granulePgRecord,
          collectionPgRecord: collection,
          knexOrTransaction: knex,
          providerPgRecord: provider
        }
      )))
      console.log(JSON.stringify(apiGranules))
      break
      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName, config.bucket, workflowName, collection, provider, {granules: apiGranules}
      );
      console.log(workflowExecution)
      // await Promise.all(granules.map(async (granule) => putUpFiles(knex, granule, collection)));
      console.log(cursor)
      cursor = granules.length ? granules[granules.length-1].cumulus_id : 0
    } while (granules.length);
  });
});
