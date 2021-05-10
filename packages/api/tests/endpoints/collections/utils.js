const {
  translateApiCollectionToPostgresCollection,
} = require('@cumulus/db');
const {
  constructCollectionId,
} = require('@cumulus/message/Collections');

const {
  fakeCollectionFactory,
} = require('../../../lib/testUtils');
const { indexCollection } = require('../../../es/indexer');

const createTestRecords = async (context, collectionParams) => {
  const {
    testKnex,
    collectionModel,
    collectionPgModel,
    esClient,
    esCollectionClient,
  } = context;
  const originalCollection = fakeCollectionFactory(collectionParams);

  const insertPgRecord = await translateApiCollectionToPostgresCollection(originalCollection);
  await collectionModel.create(originalCollection);
  const [collectionCumulusId] = await collectionPgModel.create(testKnex, insertPgRecord);
  const originalPgRecord = await collectionPgModel.get(
    testKnex, { cumulus_id: collectionCumulusId }
  );
  await indexCollection(esClient, originalCollection, process.env.ES_INDEX);
  const originalEsRecord = await esCollectionClient.get(
    constructCollectionId(originalCollection.name, originalCollection.version)
  );
  return {
    originalCollection,
    originalPgRecord,
    originalEsRecord,
  };
};

module.exports = {
  createTestRecords,
};
