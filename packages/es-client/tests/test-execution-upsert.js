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
  const { esIndex, esClient, cumulusEsClient } = await createTestIndex();
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

test.only('upsertExecution writes new "running" execution with null fields omitted', async (t) => {
  const { esIndex, esClient, esExecutionsClient } = t.context;

  const testRecord = {
    arn: randomString(),
    randomKey: null,
  };
  testRecord.status = 'running';
  await indexer.upsertExecution({
    esClient,
    updates: testRecord,
    index: esIndex,
  });

  delete testRecord.randomKey;
  const record = await esExecutionsClient.get(testRecord.arn);
  t.like(record, testRecord);
});

test.serial('upsertExecution writes new "completed" execution with null fields omitted', async (t) => {
  const { esIndex, esClient, esExecutionsClient } = t.context;

  const testRecord = {
    arn: randomString(),
    randomKey: null,
  };
  testRecord.status = 'completed';
  await indexer.upsertExecution({
    esClient,
    updates: testRecord,
    index: esIndex,
  });

  delete testRecord.randomKey;
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
  await indexer.upsertExecution({
    esClient,
    updates: testRecord,
    index: esIndex,
  });

  const record = await esExecutionsClient.get(testRecord.arn);
  t.like(record, testRecord);

  const newFinalPayload = {
    foo2: 'baz',
  };
  const updates = {
    ...testRecord,
    finalPayload: newFinalPayload,
  };
  await indexer.upsertExecution({
    esClient,
    updates,
    index: esIndex,
  });

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
  await indexer.upsertExecution({
    esClient,
    updates: testRecord,
    index: esIndex,
  });

  const record = await esExecutionsClient.get(testRecord.arn);
  t.is(record.status, 'running');

  const updates = {
    ...testRecord,
    status: 'completed',
    updatedAt,
  };
  await indexer.upsertExecution({
    esClient,
    updates,
    index: esIndex,
  });

  const updatedRecord = await esExecutionsClient.get(testRecord.arn);
  t.like(updatedRecord, updates);
});

test.serial('upsertExecution does not update "completed" status to "running"', async (t) => {
  const { esIndex, esClient, esExecutionsClient } = t.context;

  const testRecord = {
    arn: randomString(),
    status: 'completed',
  };
  await indexer.upsertExecution({
    esClient,
    updates: testRecord,
    index: esIndex,
  });

  const record = await esExecutionsClient.get(testRecord.arn);
  t.is(record.status, 'completed');

  const updates = {
    ...testRecord,
    status: 'running',
  };
  await indexer.upsertExecution({
    esClient,
    updates,
    index: esIndex,
  });

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
  await indexer.upsertExecution({
    esClient,
    updates: testRecord,
    index: esIndex,
  });

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
  await indexer.upsertExecution({
    esClient,
    updates,
    index: esIndex,
  });

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
  await indexer.upsertExecution({
    esClient,
    updates: testRecord,
    index: esIndex,
  });

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
  await indexer.upsertExecution({
    esClient,
    updates,
    index: esIndex,
  });

  const updatedRecord = await esExecutionsClient.get(testRecord.arn);
  t.like(updatedRecord, {
    ...updates,
    status: 'completed',
    timestamp: updatedRecord.timestamp,
  });
});

test.serial('upsertExecution preserves existing fields not provided in the upsert for "completed" record', async (t) => {
  const { esIndex, esClient, esExecutionsClient } = t.context;

  const execution = {
    arn: randomString(),
    status: 'running',
    collectionId: 'collection1',
  };
  await indexer.upsertExecution({
    esClient,
    updates: execution,
    index: esIndex,
  });

  const record = await esExecutionsClient.get(execution.arn);
  t.like(record, {
    ...execution,
    timestamp: record.timestamp,
  });

  const updates = {
    ...execution,
    status: 'completed',
  };
  delete updates.collectionId;
  await indexer.upsertExecution({
    esClient,
    updates,
    index: esIndex,
  });

  const updatedRecord = await esExecutionsClient.get(execution.arn);
  t.true(updatedRecord.timestamp > record.timestamp);
  // Value still exists in updated record even though it wasn't sent in the
  // body of the second upsert request
  t.is(updatedRecord.collectionId, execution.collectionId);
});

test('upsertExecution handles version conflict on parallel updates', async (t) => {
  const { esIndex, esClient, esExecutionsClient } = t.context;

  const testRecord = {
    arn: randomString(),
    status: 'running',
    originalPayload: {
      key: cryptoRandomString({ length: 5 }),
    },
  };

  const recordUpdates = {
    ...testRecord,
    status: 'completed',
    finalPayload: {
      key: cryptoRandomString({ length: 5 }),
    },
  };

  await Promise.all([
    indexer.upsertExecution({
      esClient,
      updates: testRecord,
      index: esIndex,
      refresh: false,
    }),
    indexer.upsertExecution({
      esClient,
      updates: recordUpdates,
      index: esIndex,
      refresh: false,
    }),
  ]);

  // Manually refresh index
  await esClient.indices.refresh({
    index: esIndex,
  });
  const updatedRecord = await esExecutionsClient.get(testRecord.arn);
  t.like(updatedRecord, recordUpdates);
});

test.serial('upsertExecution throws ValidateError on overwrite with invalid nullable keys', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = {
    arn: randomString(),
    status: 'running',
    collectionId: 'collection1',
  };
  await indexer.upsertExecution({
    esClient,
    updates: execution,
    index: esIndex,
  });

  await Promise.all(indexer.executionInvalidNullFields.map(async (field) => {
    const updateExecution = {
      ...execution,
    };
    updateExecution[field] = null;
    console.log(`Running ${field} test`);
    await t.throwsAsync(indexer.upsertExecution({
      esClient,
      updates: updateExecution,
      index: esIndex,
    }), { name: 'ValidationError' });
  }));
});

test.serial('upsertExecution updated "completed" record to "running" record if writeConstraints is false', async (t) => {
  const { esIndex, esClient, esExecutionsClient } = t.context;

  const updatedAt = Date.now();

  const testRecord = {
    arn: randomString(),
    updatedAt: updatedAt - 1000,
    status: 'completed',
    finalPayload: { final: 'payload' },
  };
  await indexer.upsertExecution({
    esClient,
    updates: testRecord,
    index: esIndex,
  });

  const record = await esExecutionsClient.get(testRecord.arn);
  t.is(record.status, 'completed');

  const updates = {
    ...testRecord,
    status: 'running',
    originalPayload: { original: 'payload' },
    finalPayload: null,
    updatedAt,
  };
  await indexer.upsertExecution({
    esClient,
    updates,
    index: esIndex,
  }, false);

  delete updates.finalPayload;
  const updatedRecord = await esExecutionsClient.get(testRecord.arn);
  t.like(updatedRecord, updates);
});

test.serial('upsertExecution updates record with expected nullified values if writeConstraints is false', async (t) => {
  const { esIndex, esClient, esExecutionsClient } = t.context;

  const updatedAt = Date.now();

  const testRecord = {
    arn: randomString(),
    updatedAt,
    status: 'completed',
    finalPayload: { final: 'payload' },
    originalPayload: { original: 'payload' },
    tasks: { task: 'fake_task' },
  };
  await indexer.upsertExecution({
    esClient,
    updates: testRecord,
    index: esIndex,
  }, false);

  const record = await esExecutionsClient.get(testRecord.arn);
  t.like(record, testRecord);

  const updates = {
    ...testRecord,
    status: 'running',
    originalPayload: null,
    finalPayload: null,
  };
  await indexer.upsertExecution({
    esClient,
    updates,
    index: esIndex,
  }, false);

  delete updates.finalPayload;
  delete updates.originalPayload;
  delete updates.tasks;
  const updatedRecord = await esExecutionsClient.get(testRecord.arn);
  t.like(updatedRecord, updates);
});
