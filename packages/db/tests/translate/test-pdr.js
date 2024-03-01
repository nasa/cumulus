'use strict';

const test = require('ava');

const { constructCollectionId } = require('@cumulus/message/Collections');
const { translateApiPdrToPostgresPdr, translatePostgresPdrToApiPdr } = require('../../dist/translate/pdr');

test('translatePostgresPdrToApiPdr translates postgres PDR record to API PDR record', async (t) => {
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
    execution_cumulus_id: '1',
    progress: 100,
    pan_sent: false,
    pan_message: 'N/A',
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
    collectionId: constructCollectionId(fakeCollection.name, fakeCollection.version),
    status: postgresPdr.status,
    createdAt: timestamp.getTime(),
    progress: postgresPdr.progress,
    execution: `https://console.aws.amazon.com/states/home?region=us-east-1#/executions/details/${fakeExecution.arn}`,
    PANSent: postgresPdr.pan_sent,
    PANmessage: 'N/A',
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
    fakeProviderPgModel,
    fakeExecutionPgModel
  );

  t.deepEqual(
    translatedPdrRecord,
    expectedPdr
  );
});

test('translatePostgresPdrToApiPdr handles optional fields', async (t) => {
  const fakeCollection = { name: 'abc', version: '123' };
  const fakeCollectionPgModel = {
    get: () => Promise.resolve(fakeCollection),
  };

  const fakeProvider = { name: 'ABCprov' };
  const fakeProviderPgModel = {
    get: () => Promise.resolve(fakeProvider),
  };

  const timestamp = new Date();

  const postgresPdrRecord = {
    status: 'completed',
    name: 'acbd1234.PDR',
    collection_cumulus_id: 1,
    provider_cumulus_id: 1,
    created_at: timestamp,
    updated_at: timestamp,
  };

  const expectedPdr = {
    pdrName: postgresPdrRecord.name,
    provider: fakeProvider.name,
    collectionId: constructCollectionId(fakeCollection.name, fakeCollection.version),
    status: postgresPdrRecord.status,
    createdAt: timestamp.getTime(),
    updatedAt: timestamp.getTime(),
  };

  const translatedPdrRecord = await translatePostgresPdrToApiPdr(
    postgresPdrRecord,
    {},
    fakeCollectionPgModel,
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
    PANSent: true,
    PANmessage: 'message',
    originalUrl: 'url',
    execution: 'execution',
    timestamp: Date.now(),
    duration: 10000,
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
    execution_cumulus_id: '2',
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
  const fakeProviderPgModel = {
    getRecordCumulusId: () => Promise.resolve(3),
  };

  const expectedPostgresPdr = {
    name: record.pdrName,
    status: record.status,
    collection_cumulus_id: 1,
    provider_cumulus_id: 3,
  };

  const result = await translateApiPdrToPostgresPdr(
    record,
    fakeKnex,
    fakeCollectionPgModel,
    fakeProviderPgModel
  );
  t.deepEqual(
    result,
    expectedPostgresPdr
  );
});
