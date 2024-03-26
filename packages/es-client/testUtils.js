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
  const esClient = await new Search('fakehost');
  const cumulusEsClient = await esClient.getEsClient(); //TODO - init is a side effect here :( )
  return {
    cumulusEsClient,
    esClient,
    esIndex,
  };
};

const cleanupTestIndex = async ({ esClient, esIndex }) => {
  const cumulusEsClient = await esClient.getEsClient();
  await cumulusEsClient.indices.delete({ index: esIndex });
};

module.exports = {
  createTestIndex,
  cleanupTestIndex,
};
