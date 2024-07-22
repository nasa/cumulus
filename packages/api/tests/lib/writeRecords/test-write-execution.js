'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const sinon = require('sinon');
const uuidv4 = require('uuid/v4');
const omit = require('lodash/omit');

const {
  ExecutionPgModel,
  generateLocalTestDb,
  destroyLocalTestDb,
  migrationDir,
  translatePostgresExecutionToApiExecution,
} = require('@cumulus/db');
const { createSnsTopic } = require('@cumulus/aws-client/SNS');
const { sns, sqs } = require('@cumulus/aws-client/services');
const {
  SubscribeCommand,
  DeleteTopicCommand,
} = require('@aws-sdk/client-sns');
const { generateExecutionApiRecordFromMessage } = require('@cumulus/message/Executions');

const {
  buildExecutionRecord,
  shouldWriteExecutionToPostgres,
  writeExecutionRecordFromMessage,
  writeExecutionRecordFromApi,
} = require('../../../lib/writeRecords/write-execution');

test.before(async (t) => {
  t.context.testDbName = `writeExecutions_${cryptoRandomString({ length: 10 })}`;

  const { knexAdmin, knex } = await generateLocalTestDb(
    t.context.testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.executionPgModel = new ExecutionPgModel();

  t.context.postRDSDeploymentVersion = '9.0.0';
});

test.beforeEach(async (t) => {
  const topicName = cryptoRandomString({ length: 10 });
  const { TopicArn } = await createSnsTopic(topicName);
  process.env.execution_sns_topic_arn = TopicArn;
  t.context.TopicArn = TopicArn;

  const QueueName = cryptoRandomString({ length: 10 });
  const { QueueUrl } = await sqs().createQueue({ QueueName });
  t.context.QueueUrl = QueueUrl;
  const getQueueAttributesResponse = await sqs().getQueueAttributes({
    QueueUrl,
    AttributeNames: ['QueueArn'],
  });
  const QueueArn = getQueueAttributesResponse.Attributes.QueueArn;

  const { SubscriptionArn } = await sns().send(new SubscribeCommand({
    TopicArn,
    Protocol: 'sqs',
    Endpoint: QueueArn,
  }));

  t.context.SubscriptionArn = SubscriptionArn;

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

test.afterEach(async (t) => {
  const { QueueUrl, TopicArn } = t.context;
  await sqs().deleteQueue({ QueueUrl });
  await sns().send(new DeleteTopicCommand({ TopicArn }));
});

test.after.always(async (t) => {
  await destroyLocalTestDb({
    ...t.context,
  });
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

test.serial('writeExecutionRecordFromMessage() saves execution to RDS', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionArn,
    executionPgModel,
  } = t.context;

  await writeExecutionRecordFromMessage({ cumulusMessage, knex });

  t.true(await executionPgModel.exists(knex, { arn: executionArn }));
});

test.serial('writeExecutionRecordFromMessage() properly sets originalPayload on initial write and finalPayload on subsequent write', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionArn,
    executionPgModel,
  } = t.context;

  cumulusMessage.meta.status = 'running';
  const originalPayload = {
    testId: cryptoRandomString({ length: 10 }),
  };
  cumulusMessage.payload = originalPayload;

  await writeExecutionRecordFromMessage({ cumulusMessage, knex });

  const pgRecord = await executionPgModel.get(knex, { arn: executionArn });

  t.deepEqual(pgRecord.original_payload, originalPayload);

  cumulusMessage.meta.status = 'completed';
  const finalPayload = {
    testId: cryptoRandomString({ length: 10 }),
  };
  cumulusMessage.payload = finalPayload;
  await writeExecutionRecordFromMessage({ cumulusMessage, knex });

  const updatedPgRecord = await executionPgModel.get(knex, { arn: executionArn });

  t.deepEqual(updatedPgRecord.original_payload, originalPayload);
  t.deepEqual(updatedPgRecord.final_payload, finalPayload);
});

test.serial('writeExecutionRecordFromMessage() properly handles out of order writes and correctly preserves originalPayload/finalPayload', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionArn,
    executionPgModel,
  } = t.context;

  cumulusMessage.meta.status = 'completed';
  const finalPayload = {
    key: cryptoRandomString({ length: 5 }),
  };
  cumulusMessage.payload = finalPayload;

  await writeExecutionRecordFromMessage({ cumulusMessage, knex });

  const pgRecord = await executionPgModel.get(knex, { arn: executionArn });

  t.like(pgRecord, {
    status: 'completed',
    final_payload: finalPayload,
  });

  cumulusMessage.meta.status = 'running';
  const originalPayload = {
    key: cryptoRandomString({ length: 5 }),
  };
  cumulusMessage.payload = originalPayload;
  await writeExecutionRecordFromMessage({ cumulusMessage, knex });

  const updatedPgRecord = await executionPgModel.get(knex, { arn: executionArn });

  t.like(updatedPgRecord, {
    status: 'completed',
    final_payload: finalPayload,
    original_payload: originalPayload,
  });
});

test.serial('writeExecutionRecordFromMessage() does not publish an SNS messagee if RDS write fails', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionArn,
    executionPgModel,
    QueueUrl,
  } = t.context;

  const knexStub = sinon.stub(knex, 'insert').returns({
    insert: () => {
      throw new Error('execution RDS error');
    },
  });

  t.teardown(() => knexStub.restore());

  await t.throwsAsync(
    writeExecutionRecordFromMessage({ cumulusMessage, knex: knexStub }),
    { message: 'execution RDS error' }
  );
  t.false(await executionPgModel.exists(knex, { arn: executionArn }));
  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 });

  t.is(Messages.length, 0);
});

test.serial('writeExecutionRecordFromMessage() correctly sets both original_payload and final_payload in postgres when execution records are run in sequence', async (t) => {
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
  await writeExecutionRecordFromMessage({ cumulusMessage, knex });

  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload = finalPayload;
  await writeExecutionRecordFromMessage({ cumulusMessage, knex });

  const pgRecord = await executionPgModel.get(knex, { arn: executionArn });
  t.deepEqual(pgRecord.original_payload, originalPayload);
  t.deepEqual(pgRecord.final_payload, finalPayload);
});

test.serial('writeExecutionRecordFromMessage() does not allow a running execution to replace a completed execution due to write constraints', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionArn,
    executionPgModel,
  } = t.context;

  const originalPayload = { original: 'payload' };
  const updatedOriginalPayload = { updatedOriginal: 'updatedPayload' };
  const finalPayload = { final: 'payload' };
  const tasks = { tasks: 'taskabc' };

  cumulusMessage.meta.status = 'running';
  cumulusMessage.meta.workflow_tasks = tasks;
  cumulusMessage.payload = originalPayload;
  await writeExecutionRecordFromMessage({ cumulusMessage, knex });

  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload = finalPayload;
  await writeExecutionRecordFromMessage({ cumulusMessage, knex });
  let pgRecord = await executionPgModel.get(knex, { arn: executionArn });
  t.deepEqual(pgRecord.original_payload, originalPayload);
  t.deepEqual(pgRecord.final_payload, finalPayload);
  t.deepEqual(pgRecord.tasks, tasks);

  // writeConstraints apply, status is not updated in data stores
  cumulusMessage.meta.status = 'running';
  cumulusMessage.payload = updatedOriginalPayload;
  cumulusMessage.meta.workflow_tasks = null;
  await writeExecutionRecordFromMessage({ cumulusMessage, knex });

  pgRecord = await executionPgModel.get(knex, { arn: executionArn });
  t.deepEqual(pgRecord.original_payload, updatedOriginalPayload);
  t.deepEqual(pgRecord.final_payload, finalPayload);
  t.deepEqual(pgRecord.tasks, tasks);
  t.is(pgRecord.status, 'completed');

  const translatedExecution = await translatePostgresExecutionToApiExecution(pgRecord, knex);
  t.is(translatedExecution.arn, executionArn);
  t.deepEqual(translatedExecution.status, 'completed');
  t.deepEqual(translatedExecution.originalPayload, updatedOriginalPayload);
  t.deepEqual(translatedExecution.finalPayload, finalPayload);
  t.deepEqual(translatedExecution.tasks, tasks);
});

test.serial('writeExecutionRecordFromMessage() on re-write saves execution with expected values nullified', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionArn,
    executionPgModel,
  } = t.context;

  const originalPayload = { original: 'payload' };
  const finalPayload = { final: 'payload' };
  const tasks = { tasks: 'taskabc' };

  cumulusMessage.meta.status = 'running';
  cumulusMessage.meta.workflow_tasks = tasks;
  cumulusMessage.payload = originalPayload;
  await writeExecutionRecordFromMessage({ cumulusMessage, knex });

  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload = finalPayload;
  await writeExecutionRecordFromMessage({ cumulusMessage, knex });
  let pgRecord = await executionPgModel.get(knex, { arn: executionArn });
  t.deepEqual(pgRecord.original_payload, originalPayload);
  t.deepEqual(pgRecord.final_payload, finalPayload);
  t.deepEqual(pgRecord.tasks, tasks);

  cumulusMessage.meta.status = 'failed';
  cumulusMessage.payload = null;
  cumulusMessage.meta.workflow_tasks = null;
  await writeExecutionRecordFromMessage({ cumulusMessage, knex });

  pgRecord = await executionPgModel.get(knex, { arn: executionArn });
  t.deepEqual(pgRecord.original_payload, originalPayload);
  t.is(pgRecord.status, 'failed');
  t.is(pgRecord.final_payload, null);
  t.is(pgRecord.tasks, null);

  const translatedExecution = await translatePostgresExecutionToApiExecution(pgRecord, knex);
  t.is(translatedExecution.arn, executionArn);
  t.deepEqual(translatedExecution.status, cumulusMessage.meta.status);
  t.deepEqual(translatedExecution.originalPayload, originalPayload);
  t.falsy(translatedExecution.finalPayload);
  t.falsy(translatedExecution.tasks);
});

test.serial('writeExecutionRecordFromApi() allows a running execution to replace a completed execution', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionArn,
    executionPgModel,
  } = t.context;

  const originalPayload = { original: 'payload' };
  const updatedOriginalPayload = { updatedOriginal: 'updatedPayload' };
  const finalPayload = { final: 'payload' };
  const tasks = { tasks: 'taskabc' };

  cumulusMessage.meta.status = 'running';
  cumulusMessage.meta.workflow_tasks = tasks;
  cumulusMessage.payload = originalPayload;
  let apiRecord = generateExecutionApiRecordFromMessage(cumulusMessage);
  await writeExecutionRecordFromApi({ record: apiRecord, knex });

  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload = finalPayload;
  apiRecord = generateExecutionApiRecordFromMessage(cumulusMessage);
  await writeExecutionRecordFromApi({ record: apiRecord, knex });
  let pgRecord = await executionPgModel.get(knex, { arn: executionArn });
  t.deepEqual(pgRecord.original_payload, originalPayload);
  t.deepEqual(pgRecord.final_payload, finalPayload);
  t.deepEqual(pgRecord.tasks, tasks);

  // writeConstraints do not apply, status is updated in data stores,
  // null fields are removed
  cumulusMessage.meta.status = 'running';
  cumulusMessage.payload = updatedOriginalPayload;
  cumulusMessage.meta.workflow_tasks = null;

  apiRecord = generateExecutionApiRecordFromMessage(cumulusMessage);
  await writeExecutionRecordFromApi({ record: apiRecord, knex });
  pgRecord = await executionPgModel.get(knex, { arn: executionArn });
  t.deepEqual(pgRecord.original_payload, updatedOriginalPayload);
  t.deepEqual(pgRecord.final_payload, finalPayload);
  t.deepEqual(pgRecord.tasks, null);
  t.is(pgRecord.status, cumulusMessage.meta.status);

  const translatedExecution = await translatePostgresExecutionToApiExecution(pgRecord, knex);
  t.is(translatedExecution.arn, executionArn);
  t.deepEqual(translatedExecution.status, cumulusMessage.meta.status);
  t.deepEqual(translatedExecution.originalPayload, updatedOriginalPayload);
  t.deepEqual(translatedExecution.finalPayload, finalPayload);
  t.falsy(translatedExecution.tasks);
});

test.serial('writeExecutionRecordFromApi() on re-write saves execution with expected values nullified', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionArn,
    executionPgModel,
  } = t.context;

  const originalPayload = { original: 'payload' };
  const finalPayload = { final: 'payload' };
  const tasks = { tasks: 'taskabc' };

  cumulusMessage.meta.status = 'running';
  cumulusMessage.meta.workflow_tasks = tasks;
  cumulusMessage.payload = originalPayload;
  let apiRecord = generateExecutionApiRecordFromMessage(cumulusMessage);
  await writeExecutionRecordFromApi({ record: apiRecord, knex });

  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload = finalPayload;
  apiRecord = generateExecutionApiRecordFromMessage(cumulusMessage);
  await writeExecutionRecordFromApi({ record: apiRecord, knex });
  let pgRecord = await executionPgModel.get(knex, { arn: executionArn });
  t.deepEqual(pgRecord.original_payload, originalPayload);
  t.deepEqual(pgRecord.final_payload, finalPayload);
  t.deepEqual(pgRecord.tasks, tasks);

  cumulusMessage.meta.status = 'failed';
  cumulusMessage.payload = null;
  cumulusMessage.meta.workflow_tasks = null;
  apiRecord = generateExecutionApiRecordFromMessage(cumulusMessage);
  await writeExecutionRecordFromApi({ record: apiRecord, knex });

  pgRecord = await executionPgModel.get(knex, { arn: executionArn });
  t.deepEqual(pgRecord.original_payload, originalPayload);
  t.is(pgRecord.status, 'failed');
  t.is(pgRecord.final_payload, null);
  t.is(pgRecord.tasks, null);

  const translatedExecution = await translatePostgresExecutionToApiExecution(pgRecord, knex);
  t.is(translatedExecution.arn, executionArn);
  t.deepEqual(translatedExecution.status, cumulusMessage.meta.status);
  t.deepEqual(translatedExecution.originalPayload, originalPayload);
  t.falsy(translatedExecution.finalPayload);
  t.falsy(translatedExecution.tasks);
});

test.serial('writeExecutionRecordFromMessage() successfully publishes an SNS message', async (t) => {
  const {
    cumulusMessage,
    executionArn,
    executionPgModel,
    knex,
    QueueUrl,
  } = t.context;

  await writeExecutionRecordFromMessage({ cumulusMessage, knex });

  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 });

  t.is(Messages.length, 1);

  const snsMessage = JSON.parse(Messages[0].Body);
  const executionRecord = JSON.parse(snsMessage.Message);
  const pgRecord = await executionPgModel.get(knex, { arn: executionArn });
  const translatedExecution = await translatePostgresExecutionToApiExecution(
    pgRecord,
    knex
  );

  t.is(executionRecord.arn, executionArn);
  t.is(executionRecord.status, cumulusMessage.meta.status);
  t.deepEqual(executionRecord, translatedExecution);
});

test.serial('writeExecutionRecordFromApi() successfully publishes an SNS message', async (t) => {
  const {
    cumulusMessage,
    executionArn,
    executionPgModel,
    knex,
    QueueUrl,
  } = t.context;

  const apiRecord = generateExecutionApiRecordFromMessage(cumulusMessage);
  await writeExecutionRecordFromApi({
    record: apiRecord,
    knex,
  });

  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 });

  t.is(Messages.length, 1);

  const snsMessage = JSON.parse(Messages[0].Body);
  const executionRecord = JSON.parse(snsMessage.Message);
  const pgRecord = await executionPgModel.get(knex, { arn: executionArn });
  const translatedExecution = await translatePostgresExecutionToApiExecution(
    pgRecord,
    knex
  );

  t.is(executionRecord.arn, executionArn);
  t.is(executionRecord.status, cumulusMessage.meta.status);
  t.deepEqual(executionRecord, translatedExecution);
});
