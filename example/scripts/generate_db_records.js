/* eslint-disable node/no-unpublished-require */
/* eslint-disable node/no-extraneous-require */
const { constructCollectionId } = require('@cumulus/message/Collections');
const cryptoRandomString = require('crypto-random-string');
const fs = require('fs-extra');
const {
  addCollections,
} = require('@cumulus/integration-tests');
const apiTestUtils = require('@cumulus/integration-tests/api/api');
const {
  upsertGranuleWithExecutionJoinRecord,
  GranulePgModel,
  CollectionPgModel,
  ProviderPgModel,
  getKnexClient,
  fakeGranuleRecordFactory,
} = require('@cumulus/db');

const createTestSuffix = (prefix) => `_test-${prefix}`;
const apiTestDir = '../packages/api/tests';
const providersDir = `${apiTestDir}/data/providers/s3/`;
const collectionsDir = 'data/collections/s3_MOD09GQ_006_full_ingest/';

const createTimestampedTestId = (stackName, testName) =>
  `${stackName}-${testName}-${Date.now()}`;

function* createGranuleIdGenerator(total) {
  for (let i = 0; i < total; i += 1) {
    yield `${cryptoRandomString({ length: 7 })}.${cryptoRandomString({ length: 20 })}.hdf`;
  }
}

const ingestGranules = async (config) => {
  process.env.dbMaxPool = config.batchSize || 10;
  const knex = await getKnexClient();
  const providerJson = JSON.parse(fs.readFileSync('data/providers/s3/s3_provider.json', 'utf8'));
  const testSuffix = createTestSuffix(config.testId);
  const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
  const collectionId = constructCollectionId(collection.name, collection.version);
  const provider = { id: `s3_provider${testSuffix}` };
  const testId = createTimestampedTestId(config.stackName, 'IngestGranuleSuccess');
  const providerData = {
    ...providerJson,
    id: provider.id,
    host: config.bucket,
  };

  const granulePgModel = new GranulePgModel();
  const totalGranules = 300000;
  const granuleIdGenerator = createGranuleIdGenerator(totalGranules);

  await Promise.all([
    addCollections(
      config.stackName,
      config.bucket,
      collectionsDir,
      testSuffix,
      testId,
      'error'
    ),
    apiTestUtils.addProviderApi({
      prefix: config.stackName,
      provider: providerData,
    }),
  ]);

  console.log(`Collection: ${JSON.stringify(collectionId)} created`);
  console.log(`Provider: ${JSON.stringify(provider)} created`);

  const collectionPgModel = new CollectionPgModel();
  const providerPgModel = new ProviderPgModel();

  const dbCollection = await collectionPgModel.get(knex, { ...collection });
  const dbProvider = await providerPgModel.get(knex, { name: provider.id });

  let promises = [];
  let iter = 1;
  for (const id of granuleIdGenerator) {
    const promise = upsertGranuleWithExecutionJoinRecord({
      knexTransaction: knex,
      granule: fakeGranuleRecordFactory({
        granule_id: id,
        collection_cumulus_id: dbCollection.cumulus_id,
        provider_cumulus_id: dbProvider.cumulus_id,
        status: 'completed',
      }),
      granulePgModel,
      writeConstraints: false,
    });
    console.log(`Pushing granule ${iter} to be ingested`);
    iter += 1;
    promises.push(promise);
    if (promises.length > config.batchSize) {
      // eslint-disable-next-line no-await-in-loop
      await promises[0];
      promises = promises.slice(1);
    }
  }
};

ingestGranules({
  testId: 'jktestrun18',
  stackName: 'ecarton-ci-tf',
  bucket: 'cumulus-test-sandbox-protected',
  batchSize: 350,
})
  .then(() => {
    console.log('Ingest Complete');
    return true;
  })
  .catch((err) => {
    console.error(err);
  });
