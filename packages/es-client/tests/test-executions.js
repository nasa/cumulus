'use strict';

const test = require('ava');

const { randomString, randomId } = require('@cumulus/common/test-utils');
const { constructCollectionId } = require('@cumulus/message/Collections');

const indexer = require('../indexer');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('../testUtils');

const { Search } = require('../search');
const { batchDeleteExecutionsByCollection } = require('../executions');

process.env.system_bucket = randomString();
process.env.stackName = randomString();

test.beforeEach(async (t) => {
  t.timeout(1000 * 3000);
  const { esIndex, esClient, searchClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;
  t.context.searchClient = searchClient;
});

test.afterEach.always(async (t) => {
  await cleanupTestIndex(t.context);
});

const addExecutionRecords = async (t, collectionId, count) => {
  const { esIndex, searchClient } = t.context;
  const promises = Array.from({ length: count }, () => {
    const record = {
      arn: randomString(),
      collectionId,
    };
    return indexer.indexExecution(searchClient, record, esIndex, 'execution');
  });
  await Promise.all(promises);
};

const searchAllExecutionsForCollection = async (collectionId, esIndex) => {
  const searchClient = new Search(
    {
      queryStringParameters: {
        collectionId,
      },
    },
    'execution',
    esIndex
  );
  await searchClient.initializeEsClient();
  const response = await searchClient.query();
  return response;
};

test('batchDeleteExecutionsByCollection deletes execution records',
  async (t) => {
    const { esIndex } = t.context;
    const collectionId = constructCollectionId(randomId(), randomId());
    const notDeletedCollectionId = constructCollectionId(
      randomId(),
      randomId()
    );

    const executionRecordCount = 10;
    const deleteableRecordCount = 7;
    await addExecutionRecords(t, collectionId, deleteableRecordCount);
    await addExecutionRecords(t, notDeletedCollectionId, executionRecordCount);

    // TODO fix these names
    const searchResponse = await searchAllExecutionsForCollection(
      collectionId,
      esIndex
    );
    t.is(searchResponse.meta.count, deleteableRecordCount);

    await batchDeleteExecutionsByCollection({
      index: esIndex,
      collectionId,
      batchSize: 3,
    });
    const postDeleteSecondCollectionSearchResponse = await searchAllExecutionsForCollection(
      notDeletedCollectionId,
      esIndex
    );
    t.is(postDeleteSecondCollectionSearchResponse.meta.count, executionRecordCount);
    const postDeleteSearchResponse = await searchAllExecutionsForCollection(
      collectionId,
      esIndex
    );
    t.is(postDeleteSearchResponse.meta.count, 0);
  });

test('batchDeleteExecutionsByCollection handles batch size larger than record count size',
  async (t) => {
    const { esIndex } = t.context;
    const batchSize = 1000;
    const collectionId = constructCollectionId(randomId(), randomId());
    const notDeletedCollectionId = constructCollectionId(
      randomId(),
      randomId()
    );

    const executionRecordCount = 10;
    const deleteableRecordCount = 7;
    await addExecutionRecords(t, collectionId, deleteableRecordCount);
    await addExecutionRecords(t, notDeletedCollectionId, executionRecordCount);

    // TODO fix these names
    const searchResponse = await searchAllExecutionsForCollection(
      collectionId,
      esIndex
    );
    t.is(searchResponse.meta.count, deleteableRecordCount);

    await batchDeleteExecutionsByCollection({
      index: esIndex,
      collectionId,
      batchSize,
    });
    const postDeleteSearchResponse = await searchAllExecutionsForCollection(
      notDeletedCollectionId,
      esIndex
    );
    t.is(postDeleteSearchResponse.meta.count, executionRecordCount);
  });

test('batchDeleteExecutionsByCollection handles 0 record deletion request',
  async (t) => {
    const { esIndex } = t.context;
    const batchSize = 1000;
    const collectionId = constructCollectionId(randomId(), randomId());
    const notDeletedCollectionId = constructCollectionId(
      randomId(),
      randomId()
    );

    const executionRecordCount = 10;
    await addExecutionRecords(t, notDeletedCollectionId, executionRecordCount);

    const searchResponse = await searchAllExecutionsForCollection(
      collectionId,
      esIndex
    );
    t.is(searchResponse.meta.count, 0);

    await batchDeleteExecutionsByCollection({
      index: esIndex,
      collectionId,
      batchSize,
    });
    const postDeleteSearchResponse = await searchAllExecutionsForCollection(
      notDeletedCollectionId,
      esIndex
    );
    t.is(postDeleteSearchResponse.meta.count, executionRecordCount);
  });
