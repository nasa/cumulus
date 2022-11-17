'use strict';

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

  t.context.esGranulesClient = new Search(
    {},
    'granule',
    t.context.esIndex
  );
});

test.after.always(async (t) => {
  await cleanupTestIndex(t.context);
});

test('upsertGranule removes deletedgranule record', async (t) => {
  const { esIndex, esClient } = t.context;

  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'running',
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  await indexer.deleteGranule({
    esClient,
    granuleId: granule.granuleId,
    collectionId: granule.collectionId,
    index: esIndex,
  });

  const deletedGranParams = {
    index: esIndex,
    type: 'deletedgranule',
    id: granule.granuleId,
    parent: granule.collectionId,
  };

  let deletedRecord = await esClient.get(deletedGranParams)
    .then((response) => response.body);
  t.like(deletedRecord._source, granule);

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  deletedRecord = await esClient.get(deletedGranParams, { ignore: [404] })
    .then((response) => response.body);
  t.false(deletedRecord.found);
});

test('upsertGranule creates new "running" record', async (t) => {
  const { esIndex, esClient } = t.context;

  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'running',
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);
});

test('upsertGranule creates new "completed" record', async (t) => {
  const { esIndex, esClient } = t.context;

  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'completed',
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);
});

test('upsertGranule creates new "failed" record', async (t) => {
  const { esIndex, esClient } = t.context;

  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'failed',
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);
});

test('upsertGranule updates "completed" record for same execution if writeConstraints is true', async (t) => {
  const { esIndex, esClient } = t.context;

  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'completed',
    execution: randomString(),
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    productVolume: '500',
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  }, true);
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(updatedEsRecord, updates);
});

test('upsertGranule updates "completed" record for same execution if writeConstraints is false', async (t) => {
  const { esIndex, esClient } = t.context;

  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'completed',
    execution: randomString(),
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    productVolume: '500',
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  }, false);
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(updatedEsRecord, updates);
});

test('upsertGranule updates "failed" record for same execution if writeConstraints is true', async (t) => {
  const { esIndex, esClient } = t.context;

  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'failed',
    execution: randomString(),
    error: { foo: 'bar' },
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    error: { cause: 'fail' },
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  }, true);
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.deepEqual(updatedEsRecord, {
    ...updates,
    _id: updatedEsRecord._id,
  });
});

test('upsertGranule updates "failed" record for same execution if writeConstraints is false', async (t) => {
  const { esIndex, esClient } = t.context;

  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'failed',
    execution: randomString(),
    error: { foo: 'bar' },
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    error: { cause: 'fail' },
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  }, false);
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.deepEqual(updatedEsRecord, {
    ...updates,
    _id: updatedEsRecord._id,
  });
});

test('upsertGranule does not update "completed" granule record to "running" status for the same execution if writeConstraints is true', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'completed',
    execution,
    createdAt,
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    status: 'running',
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  }, true);
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  // updates should NOT have been applied
  t.like(updatedEsRecord, granule);
});

test('upsertGranule does update "completed" granule record to "running" status for the same execution if writeConstraints is false', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'completed',
    execution,
    createdAt,
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    status: 'running',
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  }, false);
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(updatedEsRecord, updates);
});

test('upsertGranule does not update "failed" granule record to "running" status for the same execution if writeConstraints is true', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'failed',
    execution,
    createdAt,
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    status: 'running',
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  }, true);
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  // updates should NOT have been applied
  t.like(updatedEsRecord, granule);
});

test('upsertGranule does update "failed" granule record to "running" status for the same execution if writeConstraints is false', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'failed',
    execution,
    createdAt,
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    status: 'running',
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  }, false);
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(updatedEsRecord, updates);
});

test('upsertGranule does not update "running" granule to "failed" for same execution and older createdAt value if writeConstraints is true', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'running',
    execution,
    createdAt,
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    status: 'failed',
    createdAt: createdAt - 1,
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  }, true);
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  // updates should NOT have been applied
  t.like(updatedEsRecord, granule);
});

test('upsertGranule does update "running" granule to "failed" for same execution and older createdAt value if writeConstraints is false', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'running',
    execution,
    createdAt,
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    status: 'failed',
    createdAt: createdAt - 1,
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  }, false);
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(updatedEsRecord, updates);
});

test('upsertGranule does not update "running" granule to "failed" for different execution and older createdAt value if writeConstraints is true', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'running',
    execution,
    createdAt,
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    status: 'failed',
    createdAt: createdAt - 1,
    execution: randomString(),
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  }, true);
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  // updates should NOT have been applied
  t.like(updatedEsRecord, granule);
});

test('upsertGranule does update "running" granule to "failed" for different execution and older createdAt value if writeConstraints is false', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'running',
    execution,
    createdAt,
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    status: 'failed',
    createdAt: createdAt - 1,
    execution: randomString(),
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  }, false);
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(updatedEsRecord, updates);
});

test('upsertGranule does not update "completed" granule to "failed" for new execution and older createdAt value if writeConstraints is true', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'completed',
    execution,
    createdAt,
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    status: 'failed',
    execution: randomString(),
    createdAt: createdAt - 1,
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  }, true);
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  // updates should NOT have been applied
  t.like(updatedEsRecord, granule);
});

test('upsertGranule does update "completed" granule to "failed" for new execution and older createdAt value if writeConstraints is false', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'completed',
    execution,
    createdAt,
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    status: 'failed',
    execution: randomString(),
    createdAt: createdAt - 1,
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  }, false);
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(updatedEsRecord, updates);
});

test('upsertGranule does update "running" granule record to "completed" status for the same execution if writeConstraints is true', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'running',
    execution,
    createdAt,
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    status: 'completed',
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  }, true);
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(updatedEsRecord, updates);
});

test('upsertGranule does update "running" granule record to "completed" status for the same execution if writeConstraints is false', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'running',
    execution,
    createdAt,
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    status: 'completed',
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  }, false);
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(updatedEsRecord, updates);
});

test('upsertGranule does update "running" granule record to "failed" status for the same execution if writeConstraints is true', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'running',
    execution,
    createdAt,
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    status: 'failed',
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  }, true);
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(updatedEsRecord, updates);
});

test('upsertGranule does update "running" granule record to "failed" status for the same execution if writeConstraints is false', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'running',
    execution,
    createdAt,
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    status: 'failed',
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  }, false);
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(updatedEsRecord, updates);
});

test('upsertGranule does update "completed" granule record to "running" status for a different execution if writeConstraints is true', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'completed',
    execution,
    createdAt,
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    status: 'running',
    execution: randomString(),
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  }, true);
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(updatedEsRecord, updates);
});

test('upsertGranule does update "completed" granule record to "running" status for a different execution if writeConstraints is false', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'completed',
    execution,
    createdAt,
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  });

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    status: 'running',
    execution: randomString(),
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  }, false);
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(updatedEsRecord, updates);
});

test('upsertGranule does update "failed" granule record to "running" status for a different execution if writeConstraints is true', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'failed',
    execution,
    createdAt,
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  }, true);

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    status: 'running',
    execution: randomString(),
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  });
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(updatedEsRecord, updates);
});

test('upsertGranule does update "failed" granule record to "running" status for a different execution if writeConstraints is false', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'failed',
    execution,
    createdAt,
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  }, false);

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    status: 'running',
    execution: randomString(),
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  });
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(updatedEsRecord, updates);
});

test('upsertGranule does update "completed" granule to "failed" for new execution and newer createdAt value if writeConstraints is true', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'completed',
    execution,
    createdAt,
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  }, true);

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    status: 'failed',
    execution: randomString(),
    createdAt: createdAt + 1,
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  });
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  // updates should have been applied
  t.like(updatedEsRecord, updates);
});

test('upsertGranule does update "completed" granule to "failed" for new execution and newer createdAt value if writeConstraints is false', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'completed',
    execution,
    createdAt,
  };

  await indexer.upsertGranule({
    esClient,
    updates: granule,
    index: esIndex,
  }, false);

  const esRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(esRecord, granule);

  const updates = {
    ...granule,
    status: 'failed',
    execution: randomString(),
    createdAt: createdAt + 1,
  };
  await indexer.upsertGranule({
    esClient,
    updates,
    index: esIndex,
  });
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  // updates should have been applied
  t.like(updatedEsRecord, updates);
});

test('upsertGranule handles version conflicts on parallel updates', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const granule = {
    granuleId: randomString(),
    collectionId: randomString(),
    status: 'running',
    execution,
    createdAt,
  };

  const updates = {
    ...granule,
    status: 'completed',
    files: [{
      bucket: 'fake-bucket',
      key: 'fake-key',
    }],
  };

  await Promise.all([
    indexer.upsertGranule({
      esClient,
      updates: granule,
      index: esIndex,
      // disable automatic refresh to force version conflict
      refresh: false,
    }),
    indexer.upsertGranule({
      esClient,
      updates,
      index: esIndex,
      // disable automatic refresh to force version conflict
      refresh: false,
    }),
  ]);

  await esClient.indices.refresh({ index: esIndex });
  const updatedEsRecord = await t.context.esGranulesClient.get(granule.granuleId);
  t.like(updatedEsRecord, updates);
});
