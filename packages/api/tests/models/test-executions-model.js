'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');

const Execution = require('../../models/executions');

test.before(async (t) => {
  process.env.ExecutionsTable = randomString();
  t.context.executionModel = new Execution();
  await t.context.executionModel.createTable();
});

test.beforeEach(async (t) => {
  t.context.cumulusMessage = {
    cumulus_meta: {
      state_machine: 'arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine',
      execution_name: 'my-execution-name',
      workflow_start_time: 123,
      workflow_stop_time: null
    },
    meta: {
      status: 'running',
      collection: {
        name: 'my-name',
        version: 'my-version'
      }
    },
    payload: 'my-payload'
  };

  t.context.executionArn = 'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name';
});

test.after.always(async (t) => {
  await t.context.executionModel.deleteTable();
});

test('generateRecord() returns the correct record in the basic case', (t) => {
  const { cumulusMessage, executionArn } = t.context;

  const actualRecord = Execution.generateRecord(cumulusMessage);

  const expectedRecord = {
    name: 'my-execution-name',
    arn: executionArn,
    execution: `https://console.aws.amazon.com/states/home?region=us-east-1#/executions/details/${executionArn}`,
    collectionId: 'my-name___my-version',
    error: {},
    status: 'running',
    createdAt: 123,
    timestamp: actualRecord.timestamp,
    updatedAt: actualRecord.updatedAt,
    originalPayload: 'my-payload',
    duration: 0
  };

  t.deepEqual(actualRecord, expectedRecord);
});

test('generateRecord() throws an exception if the execution ARN cannot be determined', (t) => {
  t.throws(
    () => Execution.generateRecord({
      cumulus_meta: {}
    })
  );
});

test('generateRecord() throws an exception if meta.status is not present', (t) => {
  const { cumulusMessage } = t.context;

  delete cumulusMessage.meta.status;

  t.throws(() => Execution.generateRecord(cumulusMessage));
});

test('generateRecord() returns a record with asyncOperationId when available', (t) => {
  const { cumulusMessage } = t.context;

  cumulusMessage.cumulus_meta.asyncOperationId = 'my-asyncOperationId';

  const record = Execution.generateRecord(cumulusMessage);

  t.is(record.asyncOperationId, 'my-asyncOperationId');
});

test('generateRecord() returns a record with parentArn when available', (t) => {
  const { cumulusMessage } = t.context;

  cumulusMessage.cumulus_meta.parentExecutionArn = 'my-parentArn';

  const record = Execution.generateRecord(cumulusMessage);

  t.is(record.parentArn, 'my-parentArn');
});

test('generateRecord() returns a record with tasks when available', (t) => {
  const { cumulusMessage } = t.context;

  cumulusMessage.meta.workflow_tasks = 'my-tasks';

  const record = Execution.generateRecord(cumulusMessage);

  t.is(record.tasks, 'my-tasks');
});

test('generateRecord() returns a record with type when available', (t) => {
  const { cumulusMessage } = t.context;

  cumulusMessage.meta.workflow_name = 'my-workflow-name';

  const record = Execution.generateRecord(cumulusMessage);

  t.is(record.type, 'my-workflow-name');
});

test('generateRecord() returns a record with correct payload for non-running messages', (t) => {
  const { cumulusMessage } = t.context;

  cumulusMessage.meta.status = 'completed';
  cumulusMessage.payload = 'my-payload';

  const record = Execution.generateRecord(cumulusMessage);

  t.is(record.finalPayload, 'my-payload');
  t.is(record.originalPayload, undefined);
});

test('generateRecord() returns a record with correct duration for non-running messages', (t) => {
  const { cumulusMessage } = t.context;

  cumulusMessage.meta.status = 'completed';

  const startTime = cumulusMessage.cumulus_meta.workflow_start_time;
  cumulusMessage.cumulus_meta.workflow_stop_time = startTime + 1000;

  const record = Execution.generateRecord(cumulusMessage);

  t.is(record.duration, 1);
});

test('buildDocClientUpdateParams() returns null for an empty item', (t) => {
  const { executionModel } = t.context;

  t.is(executionModel.buildDocClientUpdateParams({}), null);
});

test('buildDocClientUpdateParams() does not try to update the arn', (t) => {
  const { executionModel } = t.context;

  const item = {
    arn: 'abc-123',
    name: 'frank'
  };

  const actualParams = executionModel.buildDocClientUpdateParams(item);

  t.false(Object.keys(actualParams.ExpressionAttributeNames).includes('#arn'));
  t.false(Object.keys(actualParams.ExpressionAttributeValues).includes(':arn'));
  t.false(actualParams.UpdateExpression.includes('arn'));
});

test('buildDocClientUpdateParams() does not try to update a value to `undefined`', (t) => {
  const { executionModel } = t.context;

  const item = {
    arn: 'abc-123',
    name: 'frank',
    wrong: undefined
  };

  const actualParams = executionModel.buildDocClientUpdateParams(item);

  t.false(Object.keys(actualParams.ExpressionAttributeNames).includes('#wrong'));
  t.false(Object.keys(actualParams.ExpressionAttributeValues).includes(':wrong'));
  t.false(actualParams.UpdateExpression.includes('wrong'));
});

test('buildDocClientUpdateParams() returns the correct result for a running item', (t) => {
  const { executionModel } = t.context;

  const item = {
    arn: 'abc-123',
    status: 'running',
    createdAt: 123,
    updatedAt: 124,
    timestamp: 124,
    originalPayload: 'my-original-payload'
  };

  const actualParams = executionModel.buildDocClientUpdateParams(item);

  t.is(actualParams.TableName, process.env.ExecutionsTable);
  t.deepEqual(actualParams.Key, { arn: 'abc-123' });

  t.true(actualParams.UpdateExpression.startsWith('SET '));
  t.false(actualParams.UpdateExpression.includes('REMOVE '));
  t.false(actualParams.UpdateExpression.includes('ADD '));
  t.false(actualParams.UpdateExpression.includes('DELETE '));

  t.is(actualParams.ExpressionAttributeNames['#status'], 'status');
  t.is(actualParams.ExpressionAttributeValues[':status'], 'running');
  t.true(actualParams.UpdateExpression.includes('#status = if_not_exists(#status, :status)'));

  t.is(actualParams.ExpressionAttributeNames['#createdAt'], 'createdAt');
  t.is(actualParams.ExpressionAttributeValues[':createdAt'], 123);
  t.true(actualParams.UpdateExpression.includes('#createdAt = :createdAt'));

  t.is(actualParams.ExpressionAttributeNames['#updatedAt'], 'updatedAt');
  t.is(actualParams.ExpressionAttributeValues[':updatedAt'], 124);
  t.true(actualParams.UpdateExpression.includes('#updatedAt = :updatedAt'));

  t.is(actualParams.ExpressionAttributeNames['#timestamp'], 'timestamp');
  t.is(actualParams.ExpressionAttributeValues[':timestamp'], 124);
  t.true(actualParams.UpdateExpression.includes('#timestamp = :timestamp'));

  t.is(actualParams.ExpressionAttributeNames['#originalPayload'], 'originalPayload');
  t.is(actualParams.ExpressionAttributeValues[':originalPayload'], 'my-original-payload');
  t.true(actualParams.UpdateExpression.includes('#originalPayload = :originalPayload'));
});

test('buildDocClientUpdateParams() always updates values for a non-running item', (t) => {
  const { executionModel } = t.context;

  const item = {
    arn: 'abc-123',
    status: 'completed'
  };

  const actualParams = executionModel.buildDocClientUpdateParams(item);

  t.is(actualParams.ExpressionAttributeNames['#status'], 'status');
  t.is(actualParams.ExpressionAttributeValues[':status'], 'completed');
  t.true(actualParams.UpdateExpression.includes('#status = :status'));
});

test.serial('buildDocClientUpdateParams() output can be used to create a new running execution', async (t) => {
  const { executionModel } = t.context;

  const item = {
    arn: randomString(),
    status: 'running'
  };

  const params = executionModel.buildDocClientUpdateParams(item);

  await executionModel.dynamodbDocClient.update(params).promise();

  const fetchedItem = await executionModel.get({ arn: item.arn });

  t.is(fetchedItem.status, 'running');
});

test.serial('buildDocClientUpdateParams() output can be used to update a running execution', async (t) => {
  const { executionModel } = t.context;

  const originalItem = {
    arn: randomString(),
    status: 'running',
    updatedAt: 123,
    name: 'frank'
  };

  await executionModel.create(originalItem);

  const updatedItem = {
    ...originalItem,
    updatedAt: 321,
    name: 'joe'
  };

  const params = executionModel.buildDocClientUpdateParams(updatedItem);

  await executionModel.dynamodbDocClient.update(params).promise();

  const fetchedItem = await executionModel.get({ arn: originalItem.arn });

  t.is(fetchedItem.status, 'running');
  t.is(fetchedItem.updatedAt, 321);
  t.is(fetchedItem.name, 'frank');
});

test.serial('buildDocClientUpdateParams() output can be used to create a new completed execution', async (t) => {
  const { executionModel } = t.context;

  const item = {
    arn: randomString(),
    status: 'completed'
  };

  const params = executionModel.buildDocClientUpdateParams(item);

  await executionModel.dynamodbDocClient.update(params).promise();

  const fetchedItem = await executionModel.get({ arn: item.arn });

  t.is(fetchedItem.status, 'completed');
});

test.serial('buildDocClientUpdateParams() output can be used to update a completed execution', async (t) => {
  const { executionModel } = t.context;

  const originalItem = {
    arn: randomString(),
    status: 'running',
    updatedAt: 123,
    name: 'frank'
  };

  await executionModel.create(originalItem);

  const updatedItem = {
    ...originalItem,
    status: 'completed',
    updatedAt: 321,
    name: 'joe'
  };

  const params = executionModel.buildDocClientUpdateParams(updatedItem);

  await executionModel.dynamodbDocClient.update(params).promise();

  const fetchedItem = await executionModel.get({ arn: originalItem.arn });

  t.is(fetchedItem.status, 'completed');
  t.is(fetchedItem.updatedAt, 321);
  t.is(fetchedItem.name, 'joe');
});

test.serial('buildDocClientUpdateParams() output will not allow a running status to replace a completed status', async (t) => {
  const { executionModel } = t.context;

  const originalItem = {
    arn: randomString(),
    status: 'completed',
    name: 'frank'
  };

  await executionModel.create(originalItem);

  const updatedItem = {
    ...originalItem,
    status: 'running'
  };

  const params = executionModel.buildDocClientUpdateParams(updatedItem);

  await executionModel.dynamodbDocClient.update(params).promise();

  const fetchedItem = await executionModel.get({ arn: originalItem.arn });

  t.is(fetchedItem.status, 'completed');
});

test.serial('storeExecutionFromCumulusMessage() stores an execution record to the database from a Cumulus message', async (t) => {
  const { executionArn, cumulusMessage, executionModel } = t.context;

  await executionModel.storeExecutionFromCumulusMessage(cumulusMessage);

  const fetchedItem = await executionModel.get({ arn: executionArn });

  t.is(fetchedItem.status, 'running');
});
