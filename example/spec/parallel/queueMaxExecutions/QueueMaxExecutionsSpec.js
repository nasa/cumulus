'use strict';

const fs = require('fs-extra');

const {
  models: {
    Collection,
    Provider
  }
} = require('@cumulus/api');
const {
  aws: {
    s3
  },
  testUtils: {
    randomStringFromRegex
  }
} = require('@cumulus/common');
const {
  api: apiTestUtils,
  buildAndExecuteWorkflow
  // waitForCompletedExecution
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  createTimestampedTestId,
  createTestSuffix,
  createTestDataPath
} = require('../../helpers/testUtils');

const config = loadConfig();
const testId = createTimestampedTestId(config.stackName, 'QueueGranulesMax');
const testSuffix = createTestSuffix(testId);
const testDataFolder = createTestDataPath(testId);

const workflowName = 'QueueGranulesMax';

const stageTestData = (key, bucket, prefix) =>
  s3().putObject({
    Bucket: bucket,
    Key: `${prefix}/${key}`,
    Body: ''
  }).promise();

const uploadGranulesData = async (numberOfGranules, granuleRegex) => {
  const granuleUploadPromises = new Array(numberOfGranules)
    .fill()
    .map(() => `${randomStringFromRegex(granuleRegex)}.hdf`)
    .map((key) => stageTestData(key, config.bucket, testDataFolder));
  await Promise.all(granuleUploadPromises);
};

describe('Queues with maximum executions defined', () => {
  let workflowExecution;

  const providersDir = './data/providers/s3/';
  const collectionsDir = './data/collections/s3_MOD09GQ_006';
  const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
  const provider = { id: `s3_provider${testSuffix}` };

  const numberOfGranules = 6;

  process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
  const collectionModel = new Collection();
  process.env.ProvidersTable = `${config.stackName}-ProvidersTable`;
  const providerModel = new Provider();

  beforeAll(async () => {
    const collectionJson = JSON.parse(fs.readFileSync(`${collectionsDir}/s3_MOD09GQ_006.json`, 'utf8'));
    const granuleRegex = collectionJson.granuleId;
    const collectionData = Object.assign({}, collectionJson, {
      name: collection.name,
      dataType: collectionJson.dataType + testSuffix
    });

    const providerJson = JSON.parse(fs.readFileSync(`${providersDir}/s3_provider.json`, 'utf8'));
    const providerData = Object.assign({}, providerJson, {
      id: provider.id,
      host: config.bucket
    });

    // await uploadGranulesData(numberOfGranules, granuleRegex);

    await Promise.all([
      uploadGranulesData(numberOfGranules, granuleRegex),
      apiTestUtils.addCollectionApi({ prefix: config.stackName, collection: collectionData }),
      apiTestUtils.addProviderApi({ prefix: config.stackName, provider: providerData })
    ]);

    workflowExecution = await buildAndExecuteWorkflow(
      config.stackName,
      config.bucket,
      workflowName,
      collection,
      provider
    );
  });

  afterAll(async () => {
    // clean up stack state added by test
    await Promise.all([
      // cleanupCollections(config.stackName, config.bucket, collectionsDir, testSuffix),
      // cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix)
      collectionModel.delete(collection),
      providerModel.delete(provider)
    ]);
  });

  it('executes successfully', () => {
    expect(workflowExecution.status).toEqual('SUCCEEDED');
  });
});
