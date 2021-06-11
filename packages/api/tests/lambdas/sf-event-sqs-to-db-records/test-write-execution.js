'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const sinon = require('sinon');
const uuidv4 = require('uuid/v4');

const {
  ExecutionPgModel,
  generateLocalTestDb,
  destroyLocalTestDb,
} = require('@cumulus/db');
const { Search } = require('@cumulus/es-client/search');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');

const { migrationDir } = require('../../../../../lambdas/db-migration');
const Execution = require('../../../models/executions');

const {
  buildExecutionRecord,
  shouldWriteExecutionToPostgres,
  writeExecution,
} = require('../../../lambdas/sf-event-sqs-to-db-records/write-execution');

test.before(async (t) => {
  process.env.ExecutionsTable = cryptoRandomString({ length: 10 });

  const executionModel = new Execution();
  await executionModel.createTable();
  t.context.executionModel = executionModel;

  t.context.testDbName = `writeExecutions_${cryptoRandomString({ length: 10 })}`;

  const { knexAdmin, knex } = await generateLocalTestDb(
    t.context.testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.executionPgModel = new ExecutionPgModel();

  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;
  t.context.esExecutionsClient = new Search(
    {},
    'execution',
    t.context.esIndex
  );
  t.context.postRDSDeploymentVersion = '9.0.0';
});

test.beforeEach((t) => {
  const stateMachineName = cryptoRandomString({ length: 5 });
  t.context.stateMachineArn = `arn:aws:states:us-east-1:12345:stateMachine:${stateMachineName}`;

  t.context.executionName = cryptoRandomString({ length: 5 });
  t.context.executionArn = `arn:aws:states:us-east-1:12345:execution:${stateMachineName}:${t.context.executionName}`;

  t.context.workflowStartTime = Date.now();
  t.context.workflowTasks = {
    task1: {
      key: 'value',
    },
  };
  t.context.workflowName = 'TestWorkflow';

  t.context.asyncOperationId = uuidv4();
  t.context.collectionNameVersion = {
    name: cryptoRandomString({ length: 5 }),
    version: '0.0.0',
  };
  t.context.parentExecutionArn = `arn${cryptoRandomString({ length: 5 })}`;

  t.context.cumulusMessage = {
    cumulus_meta: {
      workflow_start_time: t.context.workflowStartTime,
      cumulus_version: t.context.postRDSDeploymentVersion,
      state_machine: t.context.stateMachineArn,
      execution_name: t.context.executionName,
    },
    meta: {
      status: 'running',
      workflow_name: t.context.workflowName,
      workflow_tasks: t.context.workflowTasks,
    },
    payload: {
      foo: 'bar',
    },
  };
});

test.after.always(async (t) => {
  const {
    executionModel,
  } = t.context;
  await executionModel.deleteTable();
  await destroyLocalTestDb({
    ...t.context,
  });
  await cleanupTestIndex(t.context);
});

test('shouldWriteExecutionToPostgres() returns false if collection from message is not found in Postgres', async (t) => {
  const {
    collectionNameVersion,
  } = t.context;

  await t.false(
    shouldWriteExecutionToPostgres({
      messageCollectionNameVersion: collectionNameVersion,
      collectionCumulusId: undefined,
    })
  );
});

test('shouldWriteExecutionToPostgres() returns false if async operation from message is not found in Postgres', (t) => {
  const {
    asyncOperationId,
  } = t.context;

  t.false(
    shouldWriteExecutionToPostgres({
      messageAsyncOperationId: asyncOperationId,
      asyncOperationCumulusId: undefined,
    })
  );
});

test('shouldWriteExecutionToPostgres() returns false if parent execution from message is not found in Postgres', (t) => {
  const {
    parentExecutionArn,
  } = t.context;

  t.false(
    shouldWriteExecutionToPostgres({
      messageParentExecutionArn: parentExecutionArn,
      parentExecutionCumulusId: undefined,
    })
  );
});

test('buildExecutionRecord builds correct record for "running" execution', (t) => {
  const {
    cumulusMessage,
    executionArn,
    postRDSDeploymentVersion,
    workflowName,
    workflowTasks,
  } = t.context;

  const now = new Date();
  const updatedAt = Date.now();
  const record = buildExecutionRecord({
    cumulusMessage,
    now,
    updatedAt,
    asyncOperationCumulusId: 1,
    collectionCumulusId: 2,
    parentExecutionCumulusId: 3,
  });

  t.deepEqual(
    record,
    {
      arn: executionArn,
      cumulus_version: postRDSDeploymentVersion,
      duration: 0,
      original_payload: cumulusMessage.payload,
      status: 'running',
      tasks: workflowTasks,
      url: `https://console.aws.amazon.com/states/home?region=us-east-1#/executions/details/${executionArn}`,
      workflow_name: workflowName,
      error: {},
      async_operation_cumulus_id: 1,
      collection_cumulus_id: 2,
      parent_cumulus_id: 3,
      created_at: new Date(cumulusMessage.cumulus_meta.workflow_start_time),
      timestamp: now,
      updated_at: new Date(updatedAt),
    }
  );
});

test('buildExecutionRecord returns record with correct payload for non-running execution', (t) => {
  const {
    cumulusMessage,
  } = t.context;

  cumulusMessage.meta.status = 'completed';

  const record = buildExecutionRecord({
    cumulusMessage,
  });

  t.is(record.status, 'completed');
  t.is(record.original_payload, undefined);
  t.deepEqual(record.final_payload, cumulusMessage.payload);
});

test('buildExecutionRecord returns record with duration', (t) => {
  const {
    cumulusMessage,
    workflowStartTime,
  } = t.context;

  cumulusMessage.meta.status = 'completed';
  cumulusMessage.cumulus_meta.workflow_stop_time = workflowStartTime + 5000;

  const record = buildExecutionRecord({
    cumulusMessage,
  });

  t.is(record.duration, 5);
});

test('buildExecutionRecord returns record with error', (t) => {
  const {
    cumulusMessage,
  } = t.context;

  cumulusMessage.meta.status = 'failed';
  const exception = {
    Error: new Error('fake error'),
    Cause: 'an error occurred',
  };
  cumulusMessage.exception = exception;

  const record = buildExecutionRecord({
    cumulusMessage,
  });

  t.deepEqual(record.error, exception);
});

test('writeExecution() saves execution to Dynamo/RDS/Elasticsearch if write to RDS is enabled', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionModel,
    executionArn,
    executionPgModel,
  } = t.context;

  await writeExecution({ cumulusMessage, knex });

  t.true(await executionModel.exists({ arn: executionArn }));
  t.true(await executionPgModel.exists(knex, { arn: executionArn }));
  t.true(await t.context.esExecutionsClient.exists(executionArn));
});

test('writeExecution() saves execution to Dynamo/RDS/Elasticsearch with same timestamps', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionModel,
    executionArn,
    executionPgModel,
  } = t.context;

  await writeExecution({ cumulusMessage, knex });

  const dynamoRecord = await executionModel.get({ arn: executionArn });
  const pgRecord = await executionPgModel.get(knex, { arn: executionArn });
  const esRecord = await t.context.esExecutionsClient.get(executionArn);

  t.is(pgRecord.created_at.getTime(), dynamoRecord.createdAt);
  t.is(pgRecord.updated_at.getTime(), dynamoRecord.updatedAt);
  t.is(pgRecord.created_at.getTime(), esRecord.createdAt);
  t.is(pgRecord.updated_at.getTime(), esRecord.updatedAt);
});

test.serial('writeExecution() does not persist records to Dynamo/RDS/Elasticsearch if Dynamo write fails', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionModel,
    executionArn,
    executionPgModel,
  } = t.context;

  const fakeExecutionModel = {
    storeExecution: () => {
      throw new Error('execution Dynamo error');
    },
    delete: () => Promise.resolve(true),
  };

  await t.throwsAsync(
    writeExecution({
      cumulusMessage,
      knex,
      executionModel: fakeExecutionModel,
    }),
    { message: 'execution Dynamo error' }
  );
  t.false(await executionModel.exists({ arn: executionArn }));
  t.false(await executionPgModel.exists(knex, { arn: executionArn }));
  t.false(await t.context.esExecutionsClient.exists(executionArn));
});

test.serial('writeExecution() does not persist records to Dynamo/RDS/Elasticsearch if RDS write fails', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionModel,
    executionArn,
    executionPgModel,
  } = t.context;

  const fakeTrxCallback = (cb) => {
    const fakeTrx = sinon.stub().returns({
      insert: () => {
        throw new Error('execution RDS error');
      },
    });
    return cb(fakeTrx);
  };
  const trxStub = sinon.stub(knex, 'transaction').callsFake(fakeTrxCallback);
  t.teardown(() => trxStub.restore());

  await t.throwsAsync(
    writeExecution({ cumulusMessage, knex }),
    { message: 'execution RDS error' }
  );
  t.false(await executionModel.exists({ arn: executionArn }));
  t.false(await executionPgModel.exists(knex, { arn: executionArn }));
  t.false(await t.context.esExecutionsClient.exists(executionArn));
});

test.serial('writeExecution() does not persist records to Dynamo/RDS/Elasticsearch if Elasticsearch write fails', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionModel,
    executionArn,
    executionPgModel,
  } = t.context;

  const fakeEsClient = {
    index: () => {
      throw new Error('ES error');
    },
  };

  await t.throwsAsync(
    writeExecution({
      cumulusMessage,
      knex,
      esClient: fakeEsClient,
    }),
    { message: 'ES error' }
  );
  t.false(await executionModel.exists({ arn: executionArn }));
  t.false(await executionPgModel.exists(knex, { arn: executionArn }));
  t.false(await t.context.esExecutionsClient.exists(executionArn));
});

test.serial('writeExecution() correctly sets both original_payload and final_payload in postgres when execution records are run in sequence', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionArn,
    executionPgModel,
  } = t.context;

  const originalPayload = { original: 'payload' };
  const finalPayload = { final: 'payload' };

  cumulusMessage.meta.status = 'running';
  cumulusMessage.payload = originalPayload;
  await writeExecution({ cumulusMessage, knex });

  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload = finalPayload;
  await writeExecution({ cumulusMessage, knex });

  const pgRecord = await executionPgModel.get(knex, { arn: executionArn });
  t.deepEqual(pgRecord.original_payload, originalPayload);
  t.deepEqual(pgRecord.final_payload, finalPayload);
});
