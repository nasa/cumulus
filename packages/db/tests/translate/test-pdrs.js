const test = require('ava');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const { constructCollectionId } = require('@cumulus/message/Collections');

const { translateApiPdrToPostgresPdr } = require('../../dist/translate/pdr');

test('translateApiPdrToPostgresPdr translates an API PDR to Postgres', async (t) => {
  const collectionCumulusId = 1;
  const providerCumulusId = 2;
  const executionCumulusId = 1;

  const fakeDbClient = {};
  const fakeCollectionPgModel = {
    getRecordCumulusId: () => Promise.resolve(collectionCumulusId),
  };
  const fakeProviderPgModel = {
    getRecordCumulusId: () => Promise.resolve(providerCumulusId),
  };
  const fakeExecutionPgModel = {
    getRecordCumulusId: () => Promise.resolve(executionCumulusId),
  };

  const apiPdr = {
    pdrName: randomId('pdr'),
    collectionId: constructCollectionId('fakeCollection', 'v1'),
    provider: 'fakeProvider',
    execution: 'fakeExecution',
    status: 'completed',
    createdAt: Date.now() - 200 * 1000,
    updatedAt: Date.now(),
    progress: 0,
    PANSent: false,
    PANmessage: randomString(),
    stats: {
      total: 4,
      completed: 2,
      failed: 1,
      processing: 1,
    },
    address: 'some-address',
    originalUrl: randomString(),
    timestamp: 123,
    duration: 40,
  };

  const expectedPostgresPdr = {
    status: apiPdr.status,
    name: apiPdr.pdrName,
    collection_cumulus_id: collectionCumulusId,
    provider_cumulus_id: providerCumulusId,
    execution_cumulus_id: executionCumulusId,
    progress: apiPdr.progress,
    pan_sent: apiPdr.PANSent,
    pan_message: apiPdr.PANmessage,
    stats: apiPdr.stats,
    address: apiPdr.address,
    original_url: apiPdr.originalUrl,
    duration: apiPdr.duration,
    timestamp: new Date(apiPdr.timestamp),
    created_at: new Date(apiPdr.createdAt),
    updated_at: new Date(apiPdr.updatedAt),
  };

  const result = await translateApiPdrToPostgresPdr(
    apiPdr,
    fakeDbClient,
    fakeCollectionPgModel,
    fakeProviderPgModel,
    fakeExecutionPgModel
  );

  t.deepEqual(
    result,
    expectedPostgresPdr
  );
});
