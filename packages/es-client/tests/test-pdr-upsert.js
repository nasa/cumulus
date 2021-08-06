'use strict';

const test = require('ava');

const { randomString } = require('@cumulus/common/test-utils');

const indexer = require('../indexer');
const { Search } = require('../search');

const { bootstrapElasticSearch } = require('../bootstrap');

const esIndex = randomString();

process.env.system_bucket = randomString();
process.env.stackName = randomString();

let esClient;

test.before(async (t) => {
  // create the tables
  t.context.esAlias = randomString();
  process.env.ES_INDEX = t.context.esAlias;

  // create the elasticsearch index and add mapping
  await bootstrapElasticSearch('fakehost', esIndex, t.context.esAlias);
  esClient = await Search.es();

  t.context.esPdrsClient = new Search(
    {},
    'pdr',
    process.env.ES_INDEX
  );
});

test.after.always(async () => {
  await esClient.indices.delete({ index: esIndex });
});

test('upsertPdr creates a new "running" PDR record', async (t) => {
  const { esAlias } = t.context;

  const pdr = {
    pdrName: randomString(),
    status: 'running',
  };

  await indexer.upsertPdr(esClient, pdr.pdrName, pdr, esAlias);

  const esRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  t.like(esRecord, pdr);
});

test('upsertPdr creates a new "completed" PDR record', async (t) => {
  const { esAlias } = t.context;

  const pdr = {
    pdrName: randomString(),
    status: 'completed',
  };

  await indexer.upsertPdr(esClient, pdr.pdrName, pdr, esAlias);

  const esRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  t.like(esRecord, pdr);
});

test('upsertPdr does update a "running" PDR record if execution is different', async (t) => {
  const { esAlias } = t.context;

  const pdr = {
    pdrName: randomString(),
    status: 'running',
    execution: randomString(),
  };

  await indexer.upsertPdr(esClient, pdr.pdrName, pdr, esAlias);

  const esRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  t.like(esRecord, pdr);

  const updates = {
    ...pdr,
    execution: randomString(),
  };
  await indexer.upsertPdr(esClient, updates.pdrName, updates, esAlias);
  const updatedEsRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  t.like(updatedEsRecord, updates);
});

test('upsertPdr does not update PDR record with an older createdAt value', async (t) => {
  const { esAlias } = t.context;

  const createdAt = Date.now();
  const pdr = {
    pdrName: randomString(),
    status: 'completed',
    createdAt,
  };

  await indexer.upsertPdr(esClient, pdr.pdrName, pdr, esAlias);

  const esRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  t.like(esRecord, pdr);

  const updates = {
    ...pdr,
    status: 'running',
    createdAt: createdAt - 1,
  };
  await indexer.upsertPdr(esClient, updates.pdrName, updates, esAlias);
  const updatedEsRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  // updates should NOT have been applied
  t.like(updatedEsRecord, pdr);
});

test('upsertPdr does not update PDR record with same execution if progress is less than current', async (t) => {
  const { esAlias } = t.context;

  const execution = randomString();
  const pdr = {
    pdrName: randomString(),
    status: 'completed',
    stats: {
      completed: 3,
      total: 3,
    },
    progress: 100,
    execution,
  };

  await indexer.upsertPdr(esClient, pdr.pdrName, pdr, esAlias);

  const esRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  t.like(esRecord, pdr);

  const updates = {
    ...pdr,
    status: 'running',
    stats: {
      processing: 3,
      total: 3,
    },
    progress: 0,
  };
  await indexer.upsertPdr(esClient, updates.pdrName, updates, esAlias);
  const updatedEsRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  // updates should NOT have been applied
  t.like(updatedEsRecord, pdr);
});

test('upsertPdr does not update PDR record from different execution with older createdAt value', async (t) => {
  const { esAlias } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const pdr = {
    pdrName: randomString(),
    status: 'completed',
    stats: {
      completed: 3,
      total: 3,
    },
    progress: 100,
    execution,
    createdAt,
  };

  await indexer.upsertPdr(esClient, pdr.pdrName, pdr, esAlias);

  const esRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  t.like(esRecord, pdr);

  const updatedExecution = randomString();
  const updates = {
    ...pdr,
    status: 'failed',
    stats: {
      failed: 2,
      total: 2,
    },
    createdAt: createdAt - 1,
    execution: updatedExecution,
  };
  await indexer.upsertPdr(esClient, updates.pdrName, updates, esAlias);
  const updatedEsRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  // updates should NOT have been applied
  t.like(updatedEsRecord, pdr);
});

test('upsertPdr does not update PDR record from same execution with older createdAt value', async (t) => {
  const { esAlias } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const pdr = {
    pdrName: randomString(),
    status: 'completed',
    stats: {
      completed: 3,
      total: 3,
    },
    progress: 100,
    execution,
    createdAt,
  };

  await indexer.upsertPdr(esClient, pdr.pdrName, pdr, esAlias);

  const esRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  t.like(esRecord, pdr);

  const updates = {
    ...pdr,
    status: 'failed',
    stats: {
      failed: 2,
      total: 2,
    },
    createdAt: createdAt - 1,
  };
  await indexer.upsertPdr(esClient, updates.pdrName, updates, esAlias);
  const updatedEsRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  // updates should NOT have been applied
  t.like(updatedEsRecord, pdr);
});

test('upsertPdr does update PDR record from same execution if progress was made', async (t) => {
  const { esAlias } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const pdr = {
    pdrName: randomString(),
    status: 'running',
    stats: {
      processing: 5,
      total: 5,
    },
    progress: 0,
    execution,
    createdAt,
  };

  await indexer.upsertPdr(esClient, pdr.pdrName, pdr, esAlias);

  const esRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  t.like(esRecord, pdr);

  const updates = {
    ...pdr,
    status: 'running',
    stats: {
      processing: 1,
      completed: 4,
      total: 5,
    },
    progress: 20,
  };
  await indexer.upsertPdr(esClient, updates.pdrName, updates, esAlias);
  const updatedEsRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  // updates should have been applied
  t.like(updatedEsRecord, updates);
});
