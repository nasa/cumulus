'use strict';

const test = require('ava');
const { Search } = require('../es/search');
const { bootstrapElasticSearch } = require('../lambdas/bootstrap');
const es = require('../bin/es');
const mappings = require('../models/mappings.json');
const get = require('lodash.get');

const esIndex = 'cumulus-1';
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

  rules.map(async (rule) => {
    await esClient.index({
      index: esIndex,
      type: 'rule',
      id: rule.name,
      body: rule
    });
  });

  await esClient.indices.refresh();
}


test.before(async () => {
  // create the elasticsearch index and add mapping
  await bootstrapElasticSearch('fakehost', esIndex);
  esClient = await Search.es();

  // To do: remove
  //seawait esClient.indices.delete({ index: 'dest-index' });

  await indexData();
});

test.after.always(async () => {
  Promise.all([
    esClient.indices.delete({ index: esIndex })
  ]);
});

test.serial('Reindex - alias does not exist', async (t) => {
  try {
    await es.reindex('fakehost', null, null, 'idx-alias');
  }
  catch (err) {
    t.is(
      err.message,
      'Alias idx-alias does not exist. Before re-indexing, re-deploy your instance of Cumulus.'
    );
  }
});

test.serial('Reindex - multiple aliases found', async(t) => {
  const indexName = 'cumulus-dup';

  await esClient.indices.create({
    index: indexName,
    body: { mappings }
  });

  await esClient.indices.putAlias({
    index: indexName,
    name: 'cumulus-alias'
  });

  try {
    await es.reindex('fakehost');
  }
  catch (err) {
    t.is(
      err.message,
      // eslint-disable-next-line max-len
      'Multiple indices found for alias cumulus-alias. Specify source index as one of [cumulus-dup, cumulus-1].'
    );
  }

  await esClient.indices.delete({ index: indexName });
});

test.serial('Reindex - Specify source index that does not exist', async(t) => {
  try {
    await es.reindex('fakehost', 'source-index');
  }
  catch (err) {
    t.is(
      err.message,
      'Source index source-index does not exist.'
    );
  }
});

test.serial('Reindex - specify a source index that is not aliased', async(t) => {
  const indexName = 'source-index';

  await esClient.indices.create({
    index: indexName,
    body: { mappings }
  });

  try {
    await es.reindex('fakehost', indexName);
  }
  catch (err) {
    t.is(
      err.message,
      'Source index source-index is not aliased with alias cumulus-alias.'
    );
  }

  await esClient.indices.delete({ index: indexName });
});

test.serial('Reindex - destination index exists', async(t) => {
  t.todo('Write test');
});

test.serial('Reindex success', async(t) => {
  await es.reindex('fakehost', esIndex, 'dest-index');
  //const status = await es.getStatus('fakehost');

  // Validate that the destination index was created
  t.is(true, await esClient.indices.exists({ index: 'dest-index' }));

  // Validate destination index mappings are correct
  const fieldMappings = await esClient.indices.getMapping();

  const sourceMapping = get(fieldMappings, esIndex);
  const destMapping = get(fieldMappings, 'dest-index');

  t.deepEqual(sourceMapping.mappings, destMapping.mappings);

  await esClient.indices.refresh();

  const count = await esClient.count({
    index: 'dest-index'
  });

  // Validate that dest-index has the indexed data from the source index
  t.is(3, count.count);

  await esClient.indices.delete({ index: 'dest-index' });
});

