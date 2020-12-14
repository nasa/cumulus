'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const sinon = require('sinon');

const {
  localStackConnectionEnv,
  getKnexClient,
  tableNames,
  doesRecordExist,
} = require('@cumulus/db');

const {
  generatePdrRecord,
  getPdrCumulusIdFromQueryResultOrLookup,
  writeRunningPdrViaTransaction,
  writePdrViaTransaction,
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

  t.context.knexAdmin = await getKnexClient({ env: localStackConnectionEnv });
  await t.context.knexAdmin.raw(`create database "${t.context.testDbName}";`);
  await t.context.knexAdmin.raw(`grant all privileges on database "${t.context.testDbName}" to "${localStackConnectionEnv.PG_USER}"`);

  t.context.knex = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      PG_DATABASE: t.context.testDbName,
      migrationDir,
    },
  });
  await t.context.knex.migrate.latest();
});

test.beforeEach(async (t) => {
  t.context.pdrName = cryptoRandomString({ length: 10 });
  t.context.pdr = {
    name: t.context.pdrName,
    PANSent: false,
    PANmessage: 'test',
  };

  t.context.collection = {
    name: cryptoRandomString({ length: 5 }),
    version: '0.0.0',
    sample_file_name: 'file.txt',
    granule_id_extraction_regex: 'fake-regex',
    granule_id_validation_regex: 'fake-regex',
    files: JSON.stringify([{
      regex: 'fake-regex',
      sampleFileName: 'file.txt',
    }]),
  };

  t.context.provider = {
    id: `provider${cryptoRandomString({ length: 5 })}`,
    host: 'test-bucket',
    protocol: 's3',
  };

  t.context.workflowStartTime = Date.now();

  const collectionResponse = await t.context.knex(tableNames.collections)
    .insert(t.context.collection)
    .returning('cumulus_id');
  t.context.collectionCumulusId = collectionResponse[0];

  const providerResponse = await t.context.knex(tableNames.providers)
    .insert({
      name: t.context.provider.id,
      host: t.context.provider.host,
      protocol: t.context.provider.protocol,
    })
    .returning('cumulus_id');
  t.context.providerCumulusId = providerResponse[0];

  const executionResponse = await t.context.knex(tableNames.executions)
    .insert({
      arn: cryptoRandomString({ length: 3 }),
      status: 'running',
    })
    .returning('cumulus_id');
  t.context.runningExecutionCumulusId = executionResponse[0];

  t.context.runningPdrRecord = {
    name: t.context.pdr.name,
    status: 'running',
    execution_cumulus_id: t.context.runningExecutionCumulusId,
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
      collection: t.context.collection,
      provider: t.context.provider,
    },
    payload: {
      pdr: t.context.pdr,
      running: t.context.runningPdrRecord.stats.running,
      completed: t.context.runningPdrRecord.stats.completed,
      failed: t.context.runningPdrRecord.stats.failed,
    },
  };
});

test.after.always(async (t) => {
  const {
    pdrModel,
  } = t.context;
  await pdrModel.deleteTable();
  await t.context.knex.destroy();
  await t.context.knexAdmin.raw(`drop database if exists "${t.context.testDbName}"`);
  await t.context.knexAdmin.destroy();
});

test('generatePdrRecord() generates correct PDR record', (t) => {
  const {
    cumulusMessage,
    pdr,
    workflowStartTime,
  } = t.context;
  const now = workflowStartTime + 3500;

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
      timestamp: new Date(now),
      duration: 3.5,
    }
  );
});

test('getPdrCumulusIdFromQueryResultOrLookup() returns cumulus ID from database if query result is empty', async (t) => {
  const {
    knex,
    runningPdrRecord,
  } = t.context;

  // eslint-disable-next-line camelcase
  const [cumulus_id] = await knex(tableNames.pdrs).insert(runningPdrRecord).returning('cumulus_id');
  const pdrCumulusId = await knex.transaction(
    (trx) =>
      getPdrCumulusIdFromQueryResultOrLookup({
        trx,
        queryResult: [],
        pdrRecord: runningPdrRecord,
      })
  );
  t.is(cumulus_id, pdrCumulusId);
});

test('writeRunningPdrViaTransaction() does not update record with same execution if progress is less than current', async (t) => {
  const {
    knex,
    runningPdrRecord,
  } = t.context;

  const runningPdrRecord1 = {
    ...runningPdrRecord,
    status: 'running',
    progress: 75,
  };
  const [insertResult] = await knex(tableNames.pdrs)
    .insert(runningPdrRecord1)
    .returning('*');
  t.is(insertResult.progress, 75);

  // Update PDR progress
  const runningPdrRecord2 = {
    ...runningPdrRecord,
    status: 'running',
    progress: 50,
  };

  const trxResult = await knex.transaction(
    (trx) =>
      writeRunningPdrViaTransaction({
        trx,
        pdrRecord: runningPdrRecord2,
      })
  );
  t.is(insertResult.cumulus_id, trxResult[0]);
  const updatedRecord = await knex(tableNames.pdrs)
    .where({ name: runningPdrRecord2.name })
    .first();
  t.is(updatedRecord.progress, 75);
});

test('writeRunningPdrViaTransaction() overwrites record with same execution if progress is greater than current', async (t) => {
  const {
    runningPdrRecord,
    knex,
  } = t.context;

  const [insertResult] = await knex(tableNames.pdrs)
    .insert(runningPdrRecord)
    .returning('*');
  t.is(insertResult.progress, 25);
  t.deepEqual(insertResult.stats, runningPdrRecord.stats);

  // Update PDR progress
  const updatedRunningPdrRecord = {
    ...runningPdrRecord,
    progress: 100,
    stats: {
      running: [],
      completed: ['arn1', 'arn2', 'arn3', 'arn4'],
    },
  };

  const trxResult = await knex.transaction(
    (trx) =>
      writeRunningPdrViaTransaction({
        trx,
        pdrRecord: updatedRunningPdrRecord,
      })
  );
  t.is(insertResult.cumulus_id, trxResult[0]);
  const updatedRecord = await knex(tableNames.pdrs)
    .where({ name: updatedRunningPdrRecord.name })
    .first();
  t.is(updatedRecord.progress, 100);
  t.deepEqual(updatedRecord.stats, updatedRunningPdrRecord.stats);
});

test('writePdrViaTransaction() updates a "completed" record to "running" if the execution is different', async (t) => {
  const {
    providerCumulusId,
    collectionCumulusId,
    runningExecutionCumulusId,
    cumulusMessage,
    pdr,
    knex,
  } = t.context;

  const completedExecution = await knex(tableNames.executions)
    .insert({
      arn: cryptoRandomString({ length: 3 }),
      status: 'completed',
    })
    .returning('cumulus_id');

  cumulusMessage.meta.status = 'completed';

  await knex.transaction(
    (trx) => writePdrViaTransaction({
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId,
      executionCumulusId: completedExecution[0],
      trx,
    })
  );
  const firstRecord = await knex(tableNames.pdrs)
    .where({ name: pdr.name })
    .first();
  t.is(firstRecord.status, 'completed');

  // update status to running
  cumulusMessage.meta.status = 'running';
  await knex.transaction(
    (trx) => writePdrViaTransaction({
      cumulusMessage,
      collectionCumulusId,
      providerCumulusId,
      executionCumulusId: runningExecutionCumulusId,
      trx,
    })
  );

  const updatedRecord = await knex(tableNames.pdrs)
    .where({ name: pdr.name })
    .first();
  t.is(updatedRecord.status, 'running');
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
    runningExecutionCumulusId,
    pdr,
  } = t.context;

  const pdrCumulusId = await writePdr({
    cumulusMessage,
    collectionCumulusId,
    providerCumulusId,
    executionCumulusId: runningExecutionCumulusId,
    knex,
  });

  t.true(await pdrModel.exists({ pdrName: pdr.name }));
  t.true(
    await doesRecordExist({
      cumulus_id: pdrCumulusId,
    }, knex, tableNames.pdrs)
  );
});

test.serial('writePdr() does not persist records Dynamo or RDS if Dynamo write fails', async (t) => {
  const {
    cumulusMessage,
    pdrModel,
    knex,
    collectionCumulusId,
    providerCumulusId,
    runningExecutionCumulusId,
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
      executionCumulusId: runningExecutionCumulusId,
      knex,
      pdrModel: fakePdrModel,
    }),
    { message: 'PDR dynamo error' }
  );

  t.false(await pdrModel.exists({ pdrName: pdr.name }));
  t.false(
    await doesRecordExist({
      name: pdr.name,
    }, knex, tableNames.pdrs)
  );
});

test.serial('writePdr() does not persist records Dynamo or RDS if RDS write fails', async (t) => {
  const {
    cumulusMessage,
    pdrModel,
    knex,
    collectionCumulusId,
    providerCumulusId,
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
  t.false(
    await doesRecordExist({
      name: pdr.name,
    }, knex, tableNames.pdrs)
  );
});
