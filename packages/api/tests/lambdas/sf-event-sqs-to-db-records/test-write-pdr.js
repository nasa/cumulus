'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const sinon = require('sinon');

const {
  generateLocalTestDb,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeProviderRecordFactory,
  CollectionPgModel,
  ExecutionPgModel,
  PdrPgModel,
  ProviderPgModel,
} = require('@cumulus/db');

const {
  generatePdrRecord,
  getPdrCumulusIdFromQueryResultOrLookup,
  writePdr,
} = require('../../../lambdas/sf-event-sqs-to-db-records/write-pdr');

const { migrationDir } = require('../../../../../lambdas/db-migration');
const Pdr = require('../../../models/pdrs');

test.before(async (t) => {
  process.env.PdrsTable = cryptoRandomString({ length: 10 });

  const pdrModel = new Pdr();
  await pdrModel.createTable();
  t.context.pdrModel = pdrModel;

  t.context.testDbName = `writePdr_${cryptoRandomString({ length: 10 })}`;

  const { knexAdmin, knex } = await generateLocalTestDb(
    t.context.testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;
});

test.beforeEach(async (t) => {
  t.context.pdrName = cryptoRandomString({ length: 10 });
  t.context.pdr = {
    name: t.context.pdrName,
    PANSent: false,
    PANmessage: 'test',
  };

  t.context.workflowStartTime = Date.now();

  const collection = fakeCollectionRecordFactory();
  const collectionPgModel = new CollectionPgModel();
  [t.context.collectionCumulusId] = await collectionPgModel.create(t.context.knex, collection);

  const provider = fakeProviderRecordFactory();
  const providerPgModel = new ProviderPgModel();
  [t.context.providerCumulusId] = await providerPgModel.create(t.context.knex, provider);

  const execution = fakeExecutionRecordFactory();
  const executionPgModel = new ExecutionPgModel();
  [t.context.executionCumulusId] = await executionPgModel.create(t.context.knex, execution);

  t.context.runningPdrRecord = {
    name: t.context.pdr.name,
    status: 'running',
    execution_cumulus_id: t.context.executionCumulusId,
    collection_cumulus_id: t.context.collectionCumulusId,
    provider_cumulus_id: t.context.providerCumulusId,
    progress: 25,
    pan_sent: true,
    pan_message: 'message',
    stats: {
      running: ['arn'],
      completed: ['arn1', 'arn2', 'arn3'],
      failed: [],
    },
    duration: 1,
    timestamp: new Date(),
    created_at: new Date(),
  };

  t.context.cumulusMessage = {
    cumulus_meta: {
      workflow_start_time: t.context.workflowStartTime,
    },
    meta: {
      status: 'running',
      collection,
      provider: {
        id: provider.name,
        host: provider.host,
        protocol: provider.protocol,
      },
    },
    payload: {
      pdr: t.context.pdr,
      running: t.context.runningPdrRecord.stats.running,
      completed: t.context.runningPdrRecord.stats.completed,
      failed: t.context.runningPdrRecord.stats.failed,
    },
  };

  t.context.pdrPgModel = new PdrPgModel();
});

test.after.always(async (t) => {
  const {
    pdrModel,
  } = t.context;
  await pdrModel.deleteTable();
  await destroyLocalTestDb({
    ...t.context,
  });
});

test('generatePdrRecord() generates correct PDR record', (t) => {
  const {
    cumulusMessage,
    pdr,
    workflowStartTime,
  } = t.context;
  const now = workflowStartTime + 3500;
  const updatedAt = Date.now();

  cumulusMessage.payload = {
    ...cumulusMessage.payload,
    running: ['arn3', 'arn4'],
    completed: ['arn1', 'arn2'],
    failed: [],
  };

  t.deepEqual(
    generatePdrRecord({
      cumulusMessage,
      collectionCumulusId: 1,
      providerCumulusId: 2,
      executionCumulusId: 3,
      now,
      updatedAt,
    }),
    {
      name: pdr.name,
      status: 'running',
      pan_sent: pdr.PANSent,
      pan_message: pdr.PANmessage,
      stats: {
        processing: 2,
        completed: 2,
        failed: 0,
        total: 4,
      },
      progress: 50,
      execution_cumulus_id: 3,
      collection_cumulus_id: 1,
      provider_cumulus_id: 2,
      created_at: new Date(workflowStartTime),
      updated_at: new Date(updatedAt),
      timestamp: new Date(now),
      duration: 3.5,
    }
  );
});

test('getPdrCumulusIdFromQueryResultOrLookup() returns cumulus ID from database if query result is empty', async (t) => {
  const { runningPdrRecord } = t.context;

  const fakePdrCumulusId = Math.floor(Math.random() * 1000);
  const fakePdrPgModel = {
    getRecordCumulusId: async (_, record) => {
      if (record.name === runningPdrRecord.name) {
        return fakePdrCumulusId;
      }
      return undefined;
    },
  };

  const pdrCumulusId = await getPdrCumulusIdFromQueryResultOrLookup({
    trx: {},
    queryResult: [],
    pdrRecord: runningPdrRecord,
    pdrPgModel: fakePdrPgModel,
  });
  t.is(fakePdrCumulusId, pdrCumulusId);
});

test('writePdr() returns true if there is no PDR on the message', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    providerCumulusId,
  } = t.context;

  delete cumulusMessage.payload.pdr;

  t.is(
    await writePdr({
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId,
      knex,
    }),
    undefined
  );
});

test('writePdr() throws an error if collection is not provided', async (t) => {
  const { cumulusMessage, knex, providerCumulusId } = t.context;
  await t.throwsAsync(
    writePdr({
      cumulusMessage,
      collectionCumulusId: undefined,
      providerCumulusId,
      knex,
    })
  );
});

test('writePdr() throws an error if provider is not provided', async (t) => {
  const { cumulusMessage, knex, collectionCumulusId } = t.context;
  await t.throwsAsync(
    writePdr({
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId: undefined,
      knex,
    })
  );
});

test('writePdr() saves a PDR record to Dynamo and RDS and returns cumulus_id if RDS write is enabled', async (t) => {
  const {
    cumulusMessage,
    pdrModel,
    knex,
    collectionCumulusId,
    providerCumulusId,
    executionCumulusId,
    pdr,
    pdrPgModel,
  } = t.context;

  await writePdr({
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    executionCumulusId: executionCumulusId,
    knex,
  });

  // t.true(await pdrModel.exists({ pdrName: pdr.name }));
  // t.true(await pdrPgModel.exists(knex, { name: pdr.name }));
  const dynamoRecord = await pdrModel.get({ pdrName: pdr.name });
  const pgRecord = await pdrPgModel.get(knex, { name: pdr.name });
  t.true(dynamoRecord !== undefined);
  t.true(pgRecord !== undefined);
  t.is(pgRecord.created_at.getTime(), dynamoRecord.createdAt);
  t.is(pgRecord.updated_at.getTime(), dynamoRecord.updatedAt);
});

test.serial('writePdr() does not persist records Dynamo or RDS if Dynamo write fails', async (t) => {
  const {
    cumulusMessage,
    pdrModel,
    knex,
    collectionCumulusId,
    providerCumulusId,
    executionCumulusId,
    pdrPgModel,
  } = t.context;

  const pdr = {
    name: cryptoRandomString({ length: 5 }),
    PANSent: false,
    PANmessage: 'test',
  };
  cumulusMessage.payload = {
    pdr,
  };

  const fakePdrModel = {
    storePdrFromCumulusMessage: () => {
      throw new Error('PDR dynamo error');
    },
  };

  await t.throwsAsync(
    writePdr({
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId,
      executionCumulusId: executionCumulusId,
      knex,
      pdrModel: fakePdrModel,
    }),
    { message: 'PDR dynamo error' }
  );

  t.false(await pdrModel.exists({ pdrName: pdr.name }));
  t.false(await pdrPgModel.exists(knex, { name: pdr.name }));
});

test.serial('writePdr() does not persist records Dynamo or RDS if RDS write fails', async (t) => {
  const {
    cumulusMessage,
    pdrModel,
    knex,
    collectionCumulusId,
    providerCumulusId,
    pdrPgModel,
  } = t.context;

  const pdr = {
    name: cryptoRandomString({ length: 5 }),
    PANSent: false,
    PANmessage: 'test',
  };
  cumulusMessage.payload = {
    pdr,
  };

  cumulusMessage.meta.status = 'completed';

  const fakeTrxCallback = (cb) => {
    const fakeTrx = sinon.stub().returns({
      insert: () => {
        throw new Error('PDR RDS error');
      },
    });
    return cb(fakeTrx);
  };
  const trxStub = sinon.stub(knex, 'transaction').callsFake(fakeTrxCallback);
  t.teardown(() => trxStub.restore());

  await t.throwsAsync(
    writePdr({
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId,
      knex,
    }),
    { message: 'PDR RDS error' }
  );

  t.false(await pdrModel.exists({ pdrName: pdr.name }));
  t.false(await pdrPgModel.exists(knex, { name: pdr.name }));
});
