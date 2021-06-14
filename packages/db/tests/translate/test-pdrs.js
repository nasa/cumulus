'use strict';

const test = require('ava');

const { translateApiPdrToPostgresPdr, translatePostgresPdrToApiPdr } = require('../../dist/translate/pdrs');

test('translatePostgresPdrToApiPdr translates postgres record to PDR record', async (t) => {
  const fakeCollection = { name: 'abc', version: '123' };
  const fakeCollectionPgModel = {
    get: () => Promise.resolve(fakeCollection),
  };

  const fakeExecution = { arn: 'arn:aws:execution:1234abcd' };
  const fakeExecutionPgModel = {
    get: () => Promise.resolve(fakeExecution),
  };

  const fakeProvider = { name: 'ABCprov' };
  const fakeProviderPgModel = {
    get: () => Promise.resolve(fakeProvider),
  };

  const timestamp = new Date();

  const postgresPdr = {
    status: 'completed',
    name: 'acbd1234.PDR',
    collection_cumulus_id: 1,
    provider_cumulus_id: 1,
    execution_cumulus_id: 1,
    progress: 100,
    pan_sent: false,
    stats: {
      total: 2,
      completed: 1,
      failed: 1,
      processing: 0,
    },
    address: 'http://example.com/',
    original_url: 'http://original.example.com/',
    duration: 10000,
    timestamp,
    created_at: timestamp,
    updated_at: timestamp,
  };

  const expectedPdr = {
    pdrName: postgresPdr.name,
    provider: fakeProvider.name,
    collectionId: `${fakeCollection.name}___${fakeCollection.version}`,
    status: postgresPdr.status,
    createdAt: timestamp.getTime(),
    progress: postgresPdr.progress,
    execution: fakeExecution.arn,
    PANSent: postgresPdr.pan_sent,
    PANmessage: undefined,
    stats: postgresPdr.stats,
    address: postgresPdr.address,
    originalUrl: postgresPdr.original_url,
    timestamp: timestamp.getTime(),
    duration: postgresPdr.duration,
    updatedAt: timestamp.getTime(),
  };

  const translatedPdrRecord = await translatePostgresPdrToApiPdr(
    postgresPdr,
    {},
    fakeCollectionPgModel,
    fakeExecutionPgModel,
    fakeProviderPgModel
  );

  t.deepEqual(
    translatedPdrRecord,
    expectedPdr
  );
});

test('translateApiPdrToPostgresPdr converts API PDR to Postgres', async (t) => {
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
    getRecordCumulusId: () => Promise.resolve(1),
  };
  const fakeExecutionPgModel = {
    getRecordCumulusId: () => Promise.resolve(2),
  };
  const fakeProviderPgModel = {
    getRecordCumulusId: () => Promise.resolve(3),
  };

  const expectedPostgresPdr = {
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
    expectedPostgresPdr
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
    getRecordCumulusId: () => Promise.resolve(1),
  };
  const fakeExecutionPgModel = {
    getRecordCumulusId: () => Promise.resolve(2),
  };
  const fakeProviderPgModel = {
    getRecordCumulusId: () => Promise.resolve(3),
  };

  const expectedPostgresPdr = {
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
    expectedPostgresPdr
  );
});
