const { loadConfig } = require('../helpers/testUtils');
const { aws: { deleteS3Files, listS3ObjectsV2 } } = require('@cumulus/common');
const {
  deleteCollections,
  deleteProviders,
  listCollections,
  listProviders
} = require('@cumulus/integration-tests');
const testConfig = loadConfig();

const collectionsDirectory = './data/collections';
const providersDirectory = './data/providers';

jasmine.DEFAULT_TIMEOUT_INTERVAL = 550000;

describe('Cleans up Test Resources', () => {
  it('removes the test output', async () => {
    const params = {
      Bucket: testConfig.bucket,
      Prefix: `${testConfig.stackName}/test-output/`
    };
    const s3list = await listS3ObjectsV2(params);
    const s3objects = s3list.map((obj) => ({ Bucket: testConfig.bucket, Key: obj.Key }));
    console.log(`\nDeleting ${s3objects.length} objects`);
    await deleteS3Files(s3objects);
  });

  it('cleans up providers and collections added for the test', async () => {
    const collections = await listCollections(testConfig.stackName, testConfig.bucket, collectionsDirectory);
    const deletedCollections = await deleteCollections(testConfig.stackName, testConfig.bucket, collections);
    expect(deletedCollections).toEqual(4);

    const providers = await listProviders(testConfig.stackName, testConfig.bucket, providersDirectory);
    const deletedProviders = await deleteProviders(testConfig.stackName, testConfig.bucket, providers);
    expect(deletedProviders).toEqual(5);
  });
});
