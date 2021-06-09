'use strict';

const test = require('ava');

const { translatePostgresPdrToApiPdr } = require('../../dist/translate/pdrs');

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
