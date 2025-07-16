/*
this is a heavily clujed runner, that can def be cleaned up a lot *but*
right now if you first run the generate scripts
node generate_db_records.js --concurrency=100 --collections=1 --files=400 --granulesK=80 && node sync_s3_to_db.js --collection=MOD11A1___000 --concurrency=50
and then run this, everything should work right (you need this to have access to rds through an ssh tunnel)
*/

const fs = require('fs');
const difference = require('lodash/difference');
const path = require('path');

const {
  getKnexClient,
  CollectionPgModel,
  translatePostgresGranuleToApiGranule,
  translatePostgresCollectionToApiCollection,
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
    .andWhere('status', '<>', 'completed')
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
    console.log("start addProviders()");
    await addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix);
    console.log("finish addProviders()");

    let _granules = []

    console.log("start getGranuleBatch()");
    _granules = (await getGranuleBatch(
      knex,
      collection.cumulus_id,
      cursor, 1
    ))
    console.log("finish getGranuleBatch()", _granules);

    do {
      console.log('DO LOOP', cursor);

      granules = _granules.filter((granule) => !granule.error).slice(0, 1);
      console.log("granules", granules);
      cursor = _granules.length ? _granules[_granules.length-1].cumulus_id : 0
      _granules.shift();

      if (!granules.length) continue;
      const apiGranules = await Promise.all(granules.map(async (granulePgRecord) => {
        const apiGranule = await translatePostgresGranuleToApiGranule({
          granulePgRecord,
          collectionPgRecord: collection,
          knexOrTransaction: knex,
          providerPgRecord: provider
        })
        apiGranule.files = apiGranule.files.map((file) => ({
          ...file,
          name: file.fileName,
          path: file.key.split('/').slice(0, file.key.split('/').length-1).join('/')
        }));
        return apiGranule;
      }))
      
      console.log('buildAndExecuteWorkflow');
      console.log('config.stackName', config.stackName);
      console.log('config.bucket', config.bucket);
      console.log('workflowName', workflowName);
      console.log('collection', collection);
      console.log('provider', provider);
      console.log('granules',granules);

      // break
      workflowExecution = await buildAndExecuteWorkflow(
        config.stackName,
        config.bucket,
        workflowName,
        collection,
        provider, {granules: apiGranules}
      );
     
      console.log('**** workflowExecution', workflowExecution);


      //cursor = granules.length ? granules[granules.length-1].cumulus_id : 0
    } while (_granules.length);
  });
});
