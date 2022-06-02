const { randomString } = require('@cumulus/common/test-utils');

const bootstrap = require('./bootstrap');

const { Search } = require('./search');

const createTestIndex = async () => {
  const esIndex = randomString();
  const esAlias = randomString();
  process.env.ES_INDEX = esIndex;
  await bootstrap.bootstrapElasticSearch({
    host: 'fakehost',
    index: esIndex,
    alias: esAlias,
  });
  const esClient = await Search.es('fakehost');
  return { esIndex, esClient };
};

const cleanupTestIndex = async ({ esClient, esIndex }) => {
  await esClient.indices.delete({ index: esIndex });
};

module.exports = {
  createTestIndex,
  cleanupTestIndex,
};
