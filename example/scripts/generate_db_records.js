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

const addCollection = async (stackName, bucket, testSuffix) => {
  const testId = createTimestampedTestId(stackName, 'IngestGranuleSuccess');
  await addCollections(
    stackName,
    bucket,
    collectionsDir,
    testSuffix,
    testId,
    'replace'
  );
};
const addProvider = async (stackName, bucket, testSuffix) => {
  const providerId = `s3_provider${testSuffix}`;
  const providerJson = JSON.parse(fs.readFileSync('data/providers/s3/s3_provider.json', 'utf8'));
  const providerData = {
    ...providerJson,
    id: providerId,
    host: bucket,
  };
  try {
    await apiTestUtils.addProviderApi({
      prefix: stackName,
      provider: providerData,
    });
  } catch (error) {
    if (error.statusCode === 409) {
      return;
    }
    throw error;
  }
};
const uploadDBGranules = async (config) => {
  process.env.dbMaxPool = config.batchSize || 10;
  const knex = await getKnexClient();
  const testSuffix = createTestSuffix(config.testId);
  const collection = { name: `MOD09GQ${testSuffix}`, version: '006' };
  const collectionId = constructCollectionId(collection.name, collection.version);
  const provider = { id: `s3_provider${testSuffix}` };

  const granulePgModel = new GranulePgModel();
  const totalGranules = 300000;
  const granuleIdGenerator = createGranuleIdGenerator(totalGranules);

  console.log(`Collection: ${JSON.stringify(collectionId)} created`);
  console.log(`Provider: ${JSON.stringify(provider)} created`);

  const collectionPgModel = new CollectionPgModel();
  const providerPgModel = new ProviderPgModel();

  const dbCollection = await collectionPgModel.get(knex, { ...collection });
  const dbProvider = await providerPgModel.get(knex, { name: provider.id });

  let promises = [];
  let iter = 1;
  for (const id of granuleIdGenerator) {
    const gran = fakeGranuleRecordFactory({
      granule_id: id,
      collection_cumulus_id: dbCollection.cumulus_id,
      provider_cumulus_id: dbProvider.cumulus_id,
      status: 'completed',
    });
    console.log(iter);
    const promise = upsertGranuleWithExecutionJoinRecord({
      knexTransaction: knex,
      granule: gran,
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

const main = async () => {
  const stackName = 'ecarton-ci-tf';
  const internalBucket = 'cumulus-test-sandbox-protected';
  const testId = '_test-abc';
  await Promise.all([
    addProvider(stackName, internalBucket, testId),
    addCollection(stackName, internalBucket, testId),
  ]);
};
// addProvider('ecarton-ci-tf', 'cumulus-test-sandbox-protected', '_test-abc');
// uploadDBGranules({
//   testId: 'abc',
//   stackName: 'ecarton-ci-tf',
//   bucket: 'cumulus-test-sandbox-protected',
//   batchSize: 350,
// })
main()
  .then(() => {
    console.log('Ingest Complete');
    return true;
  })
  .catch((err) => {
    console.error(err);
  });
if (require.main === module) {
    main(
    ).then(
      (ret) => ret
    ).catch((error) => {
      console.log(`failed: ${error}`);
      throw error;
    });
  }
  