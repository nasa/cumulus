'use strict';

const test = require('ava');
const { randomId, randomNumber, randomString } = require('@cumulus/common/test-utils');

const { deconstructCollectionId } = require('../../lib/utils');
const Pdr = require('../../models/pdrs');

let pdrsModel;

test.before(async () => {
  process.env.PdrsTable = randomString();
  pdrsModel = new Pdr();
  await pdrsModel.createTable();
});

test.after.always(async () => {
  await pdrsModel.deleteTable();
});

const createPdrMessage = ({
  collectionId = `${randomId('MOD')}___${randomNumber()}`,
  numCompletedExecutions = 0,
  numFailedExecutions = 0,
  numRunningExecutions = 0
} = {}) => ({
  cumulus_meta: {
    state_machine: randomId('pdr'),
    execution_name: randomId('execution'),
    workflow_start_time: Date.now()
  },
  meta: {
    collection: deconstructCollectionId(collectionId),
    provider: {
      id: 'prov1',
      protocol: 's3',
      host: 'random-bucket'
    },
    status: 'running'
  },
  payload: {
    completed: [
      ...new Array(numCompletedExecutions)
    ].map(() => randomId('execution')),
    failed: [
      ...new Array(numFailedExecutions)
    ].map(() => randomId('execution')),
    running: [
      ...new Array(numRunningExecutions)
    ].map(() => randomId('execution'))
  }
});

test('createPdrFromSns() returns undefined when no PDR name exists', async (t) => {
  const record = await pdrsModel.createPdrFromSns(createPdrMessage());
  t.is(record, undefined);
});

test('createPdrFromSns() throws error when meta.collection is missing', async (t) => {
  const message = createPdrMessage();

  delete message.meta.collection;
  message.payload.pdr = {
    name: randomId('pdr')
  };

  await t.throws(
    () => pdrsModel.createPdrFromSns(message),
    { instanceOf: TypeError }
  );
});

test('createPdrFromSns() creates a PDR record when payload.pdr is set', async (t) => {
  const pdrName = randomId('pdr');
  const message = createPdrMessage();

  message.payload.pdr = {
    name: pdrName
  };

  await pdrsModel.createPdrFromSns(message);

  t.true(await pdrsModel.exists({ pdrName }));
});

test('createPdrFromSns() creates a PDR record when meta.pdr is set', async (t) => {
  const pdrName = randomId('pdr');
  const message = createPdrMessage();

  message.meta.pdr = {
    name: pdrName
  };

  await pdrsModel.createPdrFromSns(message);

  t.true(await pdrsModel.exists({ pdrName }));
});

test('createPdrFromSns() sets correct progress value for running PDR', async (t) => {
  const pdrName = randomId('pdr');
  const message = createPdrMessage({
    numRunningExecutions: 3
  });

  message.payload.pdr = {
    name: pdrName
  };

  await pdrsModel.createPdrFromSns(message);

  const record = await pdrsModel.get({ pdrName });
  t.is(record.stats.processing, 3);
  t.is(record.stats.total, 3);
  t.is(record.progress, 0);
});

test('createPdrFromSns() sets correct progress value for partially complete PDR', async (t) => {
  const pdrName = randomId('pdr');
  const message = createPdrMessage({
    numCompletedExecutions: 1,
    numFailedExecutions: 2,
    numRunningExecutions: 3
  });

  message.payload.pdr = {
    name: pdrName
  };

  await pdrsModel.createPdrFromSns(message);

  const record = await pdrsModel.get({ pdrName });
  t.is(record.stats.processing, 3);
  t.is(record.stats.failed, 2);
  t.is(record.stats.completed, 1);
  t.is(record.stats.total, 6);
  t.is(record.progress, 50);
});

test('createPdrFromSns() sets correct progress value for completed PDR', async (t) => {
  const pdrName = randomId('pdr');
  const message = createPdrMessage({
    numCompletedExecutions: 1
  });

  message.payload.pdr = {
    name: pdrName
  };

  await pdrsModel.createPdrFromSns(message);

  const record = await pdrsModel.get({ pdrName });
  t.is(record.stats.completed, 1);
  t.is(record.stats.total, 1);
  t.is(record.progress, 100);
});
