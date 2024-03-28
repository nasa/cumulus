const { randomString } = require('@cumulus/common/test-utils');

const bootstrap = require('./bootstrap');

const { EsClient, Search } = require('./search');

const createTestIndex = async () => {
  const esIndex = randomString();
  const esAlias = randomString();
  process.env.ES_INDEX = esIndex;
  await bootstrap.bootstrapElasticSearch({
    host: 'fakehost',
    index: esIndex,
    alias: esAlias,
  });
  const esClient = await new EsClient('fakehost');
  const searchClient = await new Search();
  await searchClient.initializeEsClient('fakehost');
  return {
    esClient,
    esIndex,
    searchClient,
  };
};

const cleanupTestIndex = async ({ esClient, esIndex }) => {
  await esClient.client.indices.delete({ index: esIndex });
};

module.exports = {
  createTestIndex,
  cleanupTestIndex,
};
