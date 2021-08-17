'use strict';

const cryptoRandomString = require('crypto-random-string');
const test = require('ava');

const { randomString } = require('@cumulus/common/test-utils');

const indexer = require('../indexer');
const { Search } = require('../search');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('../testUtils');

process.env.system_bucket = randomString();
process.env.stackName = randomString();

test.before(async (t) => {
  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;

  t.context.esExecutionsClient = new Search(
    {},
    'execution',
    process.env.ES_INDEX
  );
});

test.after.always(async (t) => {
  await cleanupTestIndex(t.context);
});

test.serial('upsertExecution writes new "running" execution', async (t) => {
  const { esIndex, esClient, esExecutionsClient } = t.context;

  const testRecord = {
    arn: randomString(),
  };
  testRecord.status = 'running';
  await indexer.upsertExecution(
    esClient,
    testRecord,
    esIndex
  );

  const record = await esExecutionsClient.get(testRecord.arn);
  t.like(record, testRecord);
});

test.serial('upsertExecution writes new "completed" execution', async (t) => {
  const { esIndex, esClient, esExecutionsClient } = t.context;

  const testRecord = {
    arn: randomString(),
  };
  testRecord.status = 'completed';
  await indexer.upsertExecution(
    esClient,
    testRecord,
    esIndex
  );

  const record = await esExecutionsClient.get(testRecord.arn);
  t.like(record, testRecord);
});

test.serial('upsertExecution updates "completed" execution', async (t) => {
  const { esIndex, esClient, esExecutionsClient } = t.context;

  const testRecord = {
    arn: randomString(),
    finalPayload: {
      foo: 'bar',
    },
  };
  testRecord.status = 'completed';
  await indexer.upsertExecution(
    esClient,
    testRecord,
    esIndex
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
    updates,
    esIndex
  );

  const updatedRecord = await esExecutionsClient.get(testRecord.arn);
  t.like(updatedRecord, updates);
});

test.serial('upsertExecution updates "running" status to "completed"', async (t) => {
  const { esIndex, esClient, esExecutionsClient } = t.context;

  const updatedAt = Date.now();

  const testRecord = {
    arn: randomString(),
    updatedAt: updatedAt - 1000,
    status: 'running',
  };
  await indexer.upsertExecution(
    esClient,
    testRecord,
    esIndex
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
    updates,
    esIndex
  );

  const updatedRecord = await esExecutionsClient.get(testRecord.arn);
  t.like(updatedRecord, updates);
});

test.serial('upsertExecution does not update "completed" status to "running"', async (t) => {
  const { esIndex, esClient, esExecutionsClient } = t.context;

  const testRecord = {
    arn: randomString(),
    status: 'completed',
  };
  await indexer.upsertExecution(
    esClient,
    testRecord,
    esIndex
  );

  const record = await esExecutionsClient.get(testRecord.arn);
  t.is(record.status, 'completed');

  const updates = {
    ...testRecord,
    status: 'running',
  };
  await indexer.upsertExecution(
    esClient,
    updates,
    esIndex
  );

  const updatedRecord = await esExecutionsClient.get(testRecord.arn);
  t.is(updatedRecord.status, 'completed');
});

test.serial('upsertExecution preserves originalPayload and finalPayload when "completed" event comes after "running" event', async (t) => {
  const { esIndex, esClient, esExecutionsClient } = t.context;

  const testRecord = {
    arn: randomString(),
    status: 'running',
    originalPayload: {
      key: cryptoRandomString({ length: 5 }),
    },
    updatedAt: Date.now(),
    timestamp: Date.now(),
  };
  await indexer.upsertExecution(
    esClient,
    testRecord,
    esIndex
  );

  const record = await esExecutionsClient.get(testRecord.arn);
  t.like(record, {
    ...testRecord,
    timestamp: record.timestamp,
  });

  const updates = {
    ...testRecord,
    status: 'completed',
    finalPayload: {
      key: cryptoRandomString({ length: 5 }),
    },
    updatedAt: Date.now(),
  };
  await indexer.upsertExecution(
    esClient,
    updates,
    esIndex
  );

  const updatedRecord = await esExecutionsClient.get(testRecord.arn);
  t.like(updatedRecord, {
    ...updates,
    timestamp: updatedRecord.timestamp,
  });
});

test.serial('upsertExecution preserves finalPayload and sets originalPayload/updatedAt/timestamp when "running" event comes after "completed" event', async (t) => {
  const { esIndex, esClient, esExecutionsClient } = t.context;

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
    testRecord,
    esIndex
  );

  const record = await esExecutionsClient.get(testRecord.arn);
  t.like(record, {
    ...testRecord,
    timestamp: record.timestamp,
  });

  const updates = {
    ...testRecord,
    status: 'running',
    originalPayload: {
      key: cryptoRandomString({ length: 5 }),
    },
    updatedAt: Date.now(),
  };
  await indexer.upsertExecution(
    esClient,
    updates,
    esIndex
  );

  const updatedRecord = await esExecutionsClient.get(testRecord.arn);
  t.like(updatedRecord, {
    ...updates,
    status: 'completed',
    timestamp: updatedRecord.timestamp,
  });
});
