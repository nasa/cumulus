const test = require('ava');
const { translateApiPdrToPostgresPdr } = require('../../dist/translate/pdr');

test('translateApiPdrToPostgresPdr converts API rule to Postgres', async (t) => {
  const record = {
    pdrName: 'name',
    status: 'running',
    provider: 'fake-provider',
    collectionId: 'fake-collection___000',
    progress: 50,
    stats: {
      running: ['arn3', 'arn4'],
      completed: ['arn1', 'arn2'],
    },
    address: 'address',
    PANsent: true,
    PANmessage: 'message',
    originalUrl: 'url',
    execution: 'execution',
    timestamp: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const fakeKnex = {};
  const fakeCollectionPgModel = {
    getRecordCumulusId: async () => 1,
  };
  const fakeExecutionPgModel = {
    getRecordCumulusId: async () => 2,
  };
  const fakeProviderPgModel = {
    getRecordCumulusId: async () => 3,
  };

  const expectedPostgresRule = {
    name: record.pdrName,
    status: record.status,
    address: record.address,
    progress: record.progress,
    pan_sent: record.PANSent,
    pan_message: record.PANmessage,
    original_url: record.originalUrl,
    duration: record.duration,
    stats: record.stats,
    created_at: new Date(record.createdAt),
    updated_at: new Date(record.updatedAt),
    timestamp: new Date(record.timestamp),
    collection_cumulus_id: 1,
    execution_cumulus_id: 2,
    provider_cumulus_id: 3,
  };

  const result = await translateApiPdrToPostgresPdr(
    record,
    fakeKnex,
    fakeCollectionPgModel,
    fakeProviderPgModel,
    fakeExecutionPgModel
  );
  t.deepEqual(
    result,
    expectedPostgresRule
  );
});

test('translateApiPdrToPostgresPdr handles optional fields', async (t) => {
  const record = {
    pdrName: 'name',
    status: 'running',
    provider: 'fake-provider',
    collectionId: 'fake-collection___000',
  };

  const fakeKnex = {};
  const fakeCollectionPgModel = {
    getRecordCumulusId: async () => 1,
  };
  const fakeExecutionPgModel = {
    getRecordCumulusId: async () => 2,
  };
  const fakeProviderPgModel = {
    getRecordCumulusId: async () => 3,
  };

  const expectedPostgresRule = {
    name: record.pdrName,
    status: record.status,
    address: undefined,
    progress: undefined,
    pan_sent: undefined,
    pan_message: undefined,
    original_url: undefined,
    duration: undefined,
    stats: undefined,
    created_at: undefined,
    updated_at: undefined,
    timestamp: undefined,
    collection_cumulus_id: 1,
    execution_cumulus_id: undefined,
    provider_cumulus_id: 3,
  };

  const result = await translateApiPdrToPostgresPdr(
    record,
    fakeKnex,
    fakeCollectionPgModel,
    fakeProviderPgModel,
    fakeExecutionPgModel
  );
  t.deepEqual(
    result,
    expectedPostgresRule
  );
});
