'use strict';

const cryptoRandomString = require('crypto-random-string');
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

  t.context.esExecutionsClient = new Search(
    {},
    'execution',
    process.env.ES_INDEX
  );
});

test.after.always(async () => {
  await esClient.indices.delete({ index: esIndex });
});

test.serial('upsertExecution writes new "running" execution', async (t) => {
  const { esAlias, esExecutionsClient } = t.context;

  const testRecord = {
    arn: randomString(),
  };
  testRecord.status = 'running';
  await indexer.upsertExecution(
    esClient,
    testRecord.arn,
    testRecord,
    esAlias
  );

  const record = await esExecutionsClient.get(testRecord.arn);
  t.like(record, testRecord);
});

test.serial('upsertExecution writes new "completed" execution', async (t) => {
  const { esAlias, esExecutionsClient } = t.context;

  const testRecord = {
    arn: randomString(),
  };
  testRecord.status = 'completed';
  await indexer.upsertExecution(
    esClient,
    testRecord.arn,
    testRecord,
    esAlias
  );

  const record = await esExecutionsClient.get(testRecord.arn);
  t.like(record, testRecord);
});

test.serial('upsertExecution updates "completed" execution', async (t) => {
  const { esAlias, esExecutionsClient } = t.context;

  const testRecord = {
    arn: randomString(),
    finalPayload: {
      foo: 'bar',
    },
  };
  testRecord.status = 'completed';
  await indexer.upsertExecution(
    esClient,
    testRecord.arn,
    testRecord,
    esAlias
  );

  const record = await esExecutionsClient.get(testRecord.arn);
  t.like(record, testRecord);

  const newFinalPayload = {
    foo2: 'baz',
  };
  const updates = {
    ...testRecord,
    finalPayload: newFinalPayload,
  };
  await indexer.upsertExecution(
    esClient,
    updates.arn,
    updates,
    esAlias
  );

  const updatedRecord = await esExecutionsClient.get(testRecord.arn);
  t.like(updatedRecord, updates);
});

test.serial('upsertExecution updates "running" status to "completed"', async (t) => {
  const { esAlias, esExecutionsClient } = t.context;

  const updatedAt = Date.now();

  const testRecord = {
    arn: randomString(),
    updatedAt: updatedAt - 1000,
    status: 'running',
  };
  await indexer.upsertExecution(
    esClient,
    testRecord.arn,
    testRecord,
    esAlias
  );

  const record = await esExecutionsClient.get(testRecord.arn);
  t.is(record.status, 'running');

  const updates = {
    ...testRecord,
    status: 'completed',
    updatedAt,
  };
  await indexer.upsertExecution(
    esClient,
    updates.arn,
    updates,
    esAlias
  );

  const updatedRecord = await esExecutionsClient.get(testRecord.arn);
  t.like(updatedRecord, updates);
});

test.serial('upsertExecution does not update "completed" status to "running"', async (t) => {
  const { esAlias, esExecutionsClient } = t.context;

  const testRecord = {
    arn: randomString(),
    status: 'completed',
  };
  await indexer.upsertExecution(
    esClient,
    testRecord.arn,
    testRecord,
    esAlias
  );

  const record = await esExecutionsClient.get(testRecord.arn);
  t.is(record.status, 'completed');

  const updates = {
    ...testRecord,
    status: 'running',
  };
  await indexer.upsertExecution(
    esClient,
    updates.arn,
    updates,
    esAlias
  );

  const updatedRecord = await esExecutionsClient.get(testRecord.arn);
  t.is(updatedRecord.status, 'completed');
});

test.serial('upsertExecution preserves finalPayload and sets originalPayload/updatedAt/timestamp when "running" event comes after "completed" event', async (t) => {
  const { esAlias, esExecutionsClient } = t.context;

  const testRecord = {
    arn: randomString(),
    status: 'completed',
    finalPayload: {
      key: cryptoRandomString({ length: 5 }),
    },
    updatedAt: Date.now(),
    timestamp: Date.now(),
  };
  await indexer.upsertExecution(
    esClient,
    testRecord.arn,
    testRecord,
    esAlias
  );

  const record = await esExecutionsClient.get(testRecord.arn);
  t.like(record, {
    ...testRecord,
    timestamp: record.timestamp,
  });

  const updates = {
    ...testRecord,
    originalPayload: {
      key: cryptoRandomString({ length: 5 }),
    },
    updatedAt: Date.now(),
  };
  await indexer.upsertExecution(
    esClient,
    updates.arn,
    updates,
    esAlias
  );

  const updatedRecord = await esExecutionsClient.get(testRecord.arn);
  t.like(updatedRecord, {
    ...updates,
    timestamp: updatedRecord.timestamp,
  });
});
