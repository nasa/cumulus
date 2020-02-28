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
  numRunningExecutions = 0,
  createdAtTime = Date.now(),
  execution = randomId('execution'),
  providerId = 'prov1',
  stateMachine = randomId('stateMachine'),
  status = 'running'
} = {}) => ({
  cumulus_meta: {
    state_machine: stateMachine,
    execution_name: execution,
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

test('generatePdrRecord() returns null if message.payload.pdr is not set', (t) => {
  const pdrRecord = pdrsModel.generatePdrRecord({});

  t.is(pdrRecord, null);
});

test('generatePdrRecord() throws error if message.payload.pdr.name is not set', (t) => {
  t.throws(() => pdrsModel.generatePdrRecord({
    payload: {
      pdr: {}
    }
  }),
  'Could not find name on PDR object {}');
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

  const record = pdrsModel.generatePdrRecord(message);

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

  const record = pdrsModel.generatePdrRecord(message);

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

  const record = pdrsModel.generatePdrRecord(message);

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

  const record = pdrsModel.generatePdrRecord(message);

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

  const record = pdrsModel.generatePdrRecord(message);

  t.true(record.PANSent);
  t.is(record.PANmessage, PANmessage);
});

test('storePdrFromCumulusMessage returns null if there is no pdr on the message', async (t) => {
  const msg = createPdrMessage({});

  const output = await pdrsModel.storePdrFromCumulusMessage(msg);
  t.is(output, null);
});

test(
  'storePdrFromCumulusMessage updates the database if status is running and the execution is different',
  async (t) => {
    const pdrName = randomId('pdr');
    const stateMachine = randomId('parsePdr');

    const initialMsg = createPdrMessage({
      stateMachine,
      status: 'completed'
    });

    initialMsg.payload.pdr = {
      name: pdrName
    };

    await pdrsModel.storePdrFromCumulusMessage(initialMsg);
    t.true(
      (await pdrsModel.get({ pdrName })).execution.includes(initialMsg.cumulus_meta.execution_name)
    );

    const exec2 = randomId('exec2');
    const newMsg = createPdrMessage({
      execution: exec2,
      stateMachine,
      status: 'running'
    });

    newMsg.payload.pdr = {
      name: pdrName
    };

    await pdrsModel.storePdrFromCumulusMessage(newMsg);

    const record = await pdrsModel.get({ pdrName });
    t.is(record.status, 'running');
    t.true(record.execution.includes(exec2));
  }
);

test(
  'storePdrFromCumulusMessage does not update same-execution if progress is less than current',
  async (t) => {
    const pdrName = randomId('pdr');
    const stateMachine = randomId('parsePdr');
    const execution = randomId('exec');

    const initialMsg = createPdrMessage({
      execution,
      stateMachine,
      numCompletedExecutions: 3,
      status: 'completed'
    });

    initialMsg.payload.pdr = {
      name: pdrName
    };

    await pdrsModel.storePdrFromCumulusMessage(initialMsg);
    t.true(
      (await pdrsModel.get({ pdrName })).execution.includes(initialMsg.cumulus_meta.execution_name)
    );

    const newMsg = createPdrMessage({
      execution,
      stateMachine,
      numRunningExecutions: 3,
      status: 'running'
    });

    newMsg.payload.pdr = {
      name: pdrName
    };

    await pdrsModel.storePdrFromCumulusMessage(newMsg);

    const record = await pdrsModel.get({ pdrName });
    t.is(record.status, 'completed');
    t.is(record.stats.completed, 3);
  }
);

test('storePdrFromCumulusMessage overwrites a same-execution running status if progress was made',
  async (t) => {
    const pdrName = randomId('pdr');
    const stateMachine = randomId('parsePdr');
    const execution = randomId('exec');

    const initialMsg = createPdrMessage({
      execution,
      numRunningExecutions: 5,
      stateMachine,
      status: 'running'
    });

    initialMsg.payload.pdr = {
      name: pdrName
    };

    await pdrsModel.storePdrFromCumulusMessage(initialMsg);
    t.true(
      (await pdrsModel.get({ pdrName })).execution.includes(initialMsg.cumulus_meta.execution_name)
    );

    const newMsg = createPdrMessage({
      execution,
      numRunningExecutions: 1,
      numCompletedExecutions: 4,
      stateMachine,
      status: 'running'
    });

    newMsg.payload.pdr = {
      name: pdrName
    };

    await pdrsModel.storePdrFromCumulusMessage(newMsg);

    const record = await pdrsModel.get({ pdrName });
    t.is(record.stats.processing, 1);
    t.is(record.stats.completed, 4);
  });
