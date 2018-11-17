'use strict';

const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const { Manager, Execution } = require('../../models');

let manager;

function returnDoc(arn) {
  return {
    name: randomString(),
    arn: arn,
    execution: 'testExecution',
    collectionId: 'testCollectionId',
    parentArn: 'parentArn',
    error: { test: 'error' },
    type: 'testType',
    status: 'running',
    createdAt: 123456789,
    timestamp: 123456789,
    updatedAt: 123456789,
    originalPayload: { op: 'originalPayload' }
  };
}

test.before(async () => {
  process.env.ExecutionsTable = randomString();
  manager = new Manager({
    tableName: process.env.ExecutionsTable,
    tableHash: { name: 'arn', type: 'S' }
  });
  await manager.createTable();
});

test.after.always(async () => {
  await manager.deleteTable();
});

test('Creating an execution adds a record to the database', async (t) => {
  const arn = randomString();
  const executionModel = new Execution();
  executionModel.generateDocFromPayload = (_payload) => returnDoc(arn);
  await executionModel.createExecutionFromSns({});
  const recordExists = await executionModel.exists({ arn: arn });
  t.true(recordExists);
});

test('Updating an existing record updates the record ', async (t) => {
  const arn = randomString();
  const executionModel = new Execution();

  executionModel.generateDocFromPayload = (_payload) => returnDoc(arn);
  await executionModel.createExecutionFromSns({});
  await executionModel.get({ arn: arn });

  executionModel.generateDocFromPayload = (_payload) => {
    const doc = returnDoc(arn);
    return doc;
  };
  await executionModel.updateExecutionFromSns({ payload: { test: 'payloadValue' } });
  const updatedRecord = await executionModel.get({ arn: arn });
  t.deepEqual(updatedRecord.finalPayload, { test: 'payloadValue' });
});
