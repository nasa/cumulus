'use strict';

const test = require('ava');
const get = require('lodash.get');

const { Search } = require('../../../es/search');
const { bootstrapElasticSearch } = require('../../../lambdas/bootstrap');
const es = require('../../../bin/es');
const mappings = require('../../../models/mappings.json');

const esIndex = 'cumulus-1';
const indexAlias = 'cumulus-1-alias';
process.env.ES_INDEX = esIndex;
let esClient;

/**
 * Index fake data
 *
 * @returns {undefined} - none
 */
async function indexData() {
  const rules = [
    { name: 'Rule1' },
    { name: 'Rule2' },
    { name: 'Rule3' }
  ];

  await Promise.all(rules.map(async (rule) => {
    await esClient.index({
      index: esIndex,
      type: 'rule',
      id: rule.name,
      body: rule
    });
  }));

  await esClient.indices.refresh();
}

/**
 * Create and alias index by going through ES bootstrap
 *
 * @param {string} indexName - index name
 * @param {string} aliasName  - alias name
 * @returns {undefined} - none
 */
async function createIndex(indexName, aliasName) {
  await bootstrapElasticSearch('fakehost', indexName, aliasName);
  esClient = await Search.es();
}

test.before(async () => {
  // create the elasticsearch index and add mapping
  await createIndex(esIndex, indexAlias);

  await indexData();
});

test.after.always(async () => {
  await esClient.indices.delete({ index: esIndex });
});

test.serial('Reindex - alias does not exist', async (t) => {
  try {
    await es.reindex('fakehost', null, null, 'idx-alias');
  } catch (err) {
    t.is(
      err.message,
      'Alias idx-alias does not exist. Before re-indexing, re-deploy your instance of Cumulus.'
    );
  }
});

test.serial('Reindex - multiple aliases found', async (t) => {
  const indexName = 'cumulus-dup';

  await esClient.indices.create({
    index: indexName,
    body: { mappings }
  });

  await esClient.indices.putAlias({
    index: indexName,
    name: indexAlias
  });

  try {
    await es.reindex('fakehost', null, null, indexAlias);
  } catch (err) {
    t.is(
      err.message,
      'Multiple indices found for alias cumulus-1-alias. Specify source index as one of [cumulus-1, cumulus-dup].'
    );
  }

  await esClient.indices.delete({ index: indexName });
});

test.serial('Reindex - Specify source index that does not exist', async (t) => {
  try {
    await es.reindex('fakehost', 'source-index', null, indexAlias);
  } catch (err) {
    t.is(
      err.message,
      'Source index source-index does not exist.'
    );
  }
});

test.serial('Reindex - specify a source index that is not aliased', async (t) => {
  const indexName = 'source-index';

  await esClient.indices.create({
    index: indexName,
    body: { mappings }
  });

  try {
    await es.reindex('fakehost', indexName, null, indexAlias);
  } catch (err) {
    t.is(
      err.message,
      'Source index source-index is not aliased with alias cumulus-1-alias.'
    );
  }

  await esClient.indices.delete({ index: indexName });
});

test.serial('Reindex success', async (t) => {
  const response = await es.reindex('fakehost', esIndex, 'cumulus-dest', indexAlias);

  // Verify the 3 records were created according to the reindex response
  t.is(response.created, 3);

  // Refresh to make sure the records are in the destination index
  await esClient.indices.refresh();

  // Validate that the destination index was created
  t.is(true, await esClient.indices.exists({ index: 'cumulus-dest' }));

  // Validate destination index mappings are correct
  const fieldMappings = await esClient.indices.getMapping();

  const sourceMapping = get(fieldMappings, esIndex);
  const destMapping = get(fieldMappings, 'cumulus-dest');

  t.deepEqual(sourceMapping.mappings, destMapping.mappings);

  const count = await esClient.count({ index: 'cumulus-dest' });

  // Validate that dest-index has the indexed data from the source index
  t.is(3, count.count);

  await esClient.indices.delete({ index: 'cumulus-dest' });
});

test.serial('Reindex - destination index exists', async (t) => {
  try {
    await es.reindex('fakehost', esIndex, esIndex, indexAlias);
  } catch (err) {
    t.is(
      err.message,
      'Destination index cumulus-1 exists. Please specify an index name that does not exist.'
    );
  }
});

test.serial('Complete index - no source', async (t) => {
  try {
    await es.completeReindex('fakehost', null, 'dest-index', esIndex);
  } catch (err) {
    t.is(
      err.message,
      'Please explicity specify a source and destination index.'
    );
  }
});

test.serial('Complete index - no destination', async (t) => {
  try {
    await es.completeReindex('fakehost', 'source-index', null, esIndex);
  } catch (err) {
    t.is(
      err.message,
      'Please explicity specify a source and destination index.'
    );
  }
});

test.serial('Complete index - source index does not exist', async (t) => {
  try {
    await es.completeReindex('fakehost', 'source-index', 'dest-index', esIndex);
  } catch (err) {
    t.is(
      err.message,
      'Source index source-index does not exist.'
    );
  }
});

test.serial('Complete index - no destination', async (t) => {
  try {
    await es.completeReindex('fakehost', 'cumulus-1', 'dest-index', esIndex);
  } catch (err) {
    t.is(
      err.message,
      'Destination index dest-index does not exist.'
    );
  }
});

test.serial('Complete index - source index same as dest index', async (t) => {
  try {
    await es.completeReindex('fakehost', 'source', 'source', esIndex);
  } catch (err) {
    t.is(
      err.message,
      'The source index cannot be the same as the destination index.'
    );
  }
});

test.serial('Complete re-index', async (t) => {
  await createIndex('cumulus-2', 'cumulus-2-alias');

  await es.reindex('fakehost', 'cumulus-2', 'dest-index', 'cumulus-2-alias');

  await es.completeReindex('fakehost', 'cumulus-2', 'dest-index', 'cumulus-2-alias');

  const alias = await esClient.indices.getAlias({ name: 'cumulus-2-alias' });

  t.deepEqual(Object.keys(alias), ['dest-index']);

  await esClient.indices.delete({ index: 'dest-index' });
});

test.serial('Complete re-index and delete source index', async (t) => {
  await createIndex('cumulus-2', 'cumulus-2-alias');

  await es.reindex('fakehost', 'cumulus-2', 'dest-index', 'cumulus-2-alias');

  await es.completeReindex('fakehost', 'cumulus-2', 'dest-index', 'cumulus-2-alias', true);

  t.is(await esClient.indices.exists({ index: 'cumulus-2' }), false);

  await esClient.indices.delete({ index: 'dest-index' });
});
