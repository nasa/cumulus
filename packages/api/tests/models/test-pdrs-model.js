'use strict';

const test = require('ava');

const { constructCollectionId } = require('@cumulus/common/collection-config-store');
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
  numRunningExecutions = 0,
  createdAtTime = Date.now(),
  providerId = 'prov1',
  status = 'running'
} = {}) => ({
  cumulus_meta: {
    state_machine: randomId('pdr'),
    execution_name: randomId('execution'),
    workflow_start_time: createdAtTime
  },
  meta: {
    collection: deconstructCollectionId(collectionId),
    provider: {
      id: providerId,
      protocol: 's3',
      host: 'random-bucket'
    },
    status
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

test('generatePdrRecord() sets correct progress value for running PDR', async (t) => {
  const pdrName = randomId('pdr');
  const message = createPdrMessage({
    numRunningExecutions: 3
  });

  const pdr = {
    name: pdrName
  };

  message.payload.pdr = pdr;

  const record = Pdr.generatePdrRecord(message);

  t.is(record.status, 'running');
  t.is(record.stats.processing, 3);
  t.is(record.stats.total, 3);
  t.is(record.progress, 0);
});

test('generatePdrRecord() sets correct progress value for partially complete PDR', async (t) => {
  const pdrName = randomId('pdr');
  const message = createPdrMessage({
    numCompletedExecutions: 1,
    numFailedExecutions: 2,
    numRunningExecutions: 3
  });
  const pdr = {
    name: pdrName
  };

  message.payload.pdr = pdr;

  const record = Pdr.generatePdrRecord(message);

  t.is(record.status, 'running');
  t.is(record.stats.processing, 3);
  t.is(record.stats.failed, 2);
  t.is(record.stats.completed, 1);
  t.is(record.stats.total, 6);
  t.is(record.progress, 50);
});

test('generatePdrRecord() generates a completed PDR record', async (t) => {
  const collectionId = `${randomId('MOD')}___${randomNumber()}`;
  const providerId = randomId('provider');
  const pdrName = randomId('pdr');
  const status = 'completed';
  const createdAtTime = Date.now();

  const message = createPdrMessage({
    numCompletedExecutions: 1,
    collectionId,
    createdAtTime,
    providerId,
    status
  });
  const pdr = {
    name: pdrName
  };

  message.payload.pdr = pdr;

  const record = Pdr.generatePdrRecord(message);

  t.is(record.status, status);
  t.is(record.collectionId, collectionId);
  t.is(record.createdAt, createdAtTime);
  t.is(record.provider, providerId);
  t.is(record.stats.failed, 0);
  t.is(record.stats.processing, 0);
  t.is(record.stats.completed, 1);
  t.is(record.stats.total, 1);
  t.is(record.progress, 100);
  t.is(typeof record.duration, 'number');
});

test('generatePdrRecord() generates a failed PDR record', async (t) => {
  const collectionId = `${randomId('MOD')}___${randomNumber()}`;
  const providerId = randomId('provider');
  const pdrName = randomId('pdr');
  const status = 'failed';
  const createdAtTime = Date.now();

  const message = createPdrMessage({
    numFailedExecutions: 1,
    collectionId,
    createdAtTime,
    providerId,
    status
  });

  const pdr = {
    name: pdrName
  };

  message.payload.pdr = pdr;

  const record = Pdr.generatePdrRecord(message);

  t.is(record.status, status);
  t.is(record.collectionId, collectionId);
  t.is(record.createdAt, createdAtTime);
  t.is(record.provider, providerId);
  const stats = record.stats;
  t.is(stats.total, 1);
  t.is(stats.failed, 1);
  t.is(stats.processing, 0);
  t.is(stats.completed, 0);
  t.is(record.progress, 100);
  t.is(typeof record.duration, 'number');
});

test('generatePdrRecord() sets PDR properties when included', async (t) => {
  const pdrName = randomId('pdr');
  const message = createPdrMessage();
  const PANmessage = 'test message';

  const pdr = {
    name: pdrName,
    PANSent: true,
    PANmessage
  };

  message.payload.pdr = pdr;

  const record = Pdr.generatePdrRecord(message);

  t.true(record.PANSent);
  t.is(record.PANmessage, PANmessage);
});

test('createPdrFromSns() returns undefined when no PDR name exists', async (t) => {
  const record = await pdrsModel.createPdrFromSns(createPdrMessage());
  t.is(record, undefined);
});

test('createPdrFromSns() creates a PDR record when payload.pdr is set', async (t) => {
  const pdrName = randomId('pdr');
  const createdAtTime = Date.now() - 1000;
  const message = createPdrMessage({
    createdAtTime
  });

  message.payload.pdr = {
    name: pdrName
  };

  await pdrsModel.createPdrFromSns(message);

  const { collection } = message.meta;
  const collectionId = constructCollectionId(collection.name, collection.version);

  const record = await pdrsModel.get({ pdrName });
  t.is(record.createdAt, createdAtTime);
  t.is(record.collectionId, collectionId);
});

test('createPdrFromSns() creates a PDR record when meta.pdr is set', async (t) => {
  const pdrName = randomId('pdr');
  const createdAtTime = Date.now() - 1000;
  const message = createPdrMessage({
    createdAtTime
  });

  message.meta.pdr = {
    name: pdrName
  };

  await pdrsModel.createPdrFromSns(message);

  const { collection } = message.meta;
  const collectionId = constructCollectionId(collection.name, collection.version);

  const record = await pdrsModel.get({ pdrName });
  t.is(record.createdAt, createdAtTime);
  t.is(record.collectionId, collectionId);
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
  const status = 'completed';
  const message = createPdrMessage({
    numCompletedExecutions: 1,
    status
  });

  message.payload.pdr = {
    name: pdrName
  };

  await pdrsModel.createPdrFromSns(message);

  const record = await pdrsModel.get({ pdrName });
  t.is(record.status, status);
  t.is(record.stats.completed, 1);
  t.is(record.stats.total, 1);
  t.is(record.progress, 100);
});

test('createPdrFromSns() creates a failed PDR record', async (t) => {
  const pdrName = randomId('pdr');
  const status = 'failed';
  const message = createPdrMessage({
    numFailedExecutions: 1,
    status
  });

  message.payload.pdr = {
    name: pdrName
  };

  await pdrsModel.createPdrFromSns(message);
  const record = await pdrsModel.get({ pdrName });

  t.is(record.status, status);
  const stats = record.stats;
  t.is(stats.total, 1);
  t.is(stats.failed, 1);
  t.is(stats.processing, 0);
  t.is(stats.completed, 0);
  t.is(record.progress, 100);
});

test('createPdrFromSns() sets PDR properties when included', async (t) => {
  const pdrName = randomId('pdr');
  const message = createPdrMessage();
  const PANmessage = 'test message';

  message.payload.pdr = {
    name: pdrName,
    PANSent: true,
    PANmessage
  };

  await pdrsModel.createPdrFromSns(message);

  const record = await pdrsModel.get({ pdrName });
  t.true(record.PANSent);
  t.is(record.PANmessage, PANmessage);
});
