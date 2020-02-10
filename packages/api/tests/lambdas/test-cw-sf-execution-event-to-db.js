'use strict';

const fs = require('fs-extra');
const path = require('path');
const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const Execution = require('../../models/executions');
const {
  handler,
  saveExecutionToDb
} = require('../../lambdas/cw-sf-execution-event-to-db');

const loadFixture = (filename) =>
  fs.readJson(
    path.join(
      __dirname,
      'fixtures',
      'cw-sf-execution-event-to-db',
      filename
    )
  );

test.before(async (t) => {
  process.env.ExecutionsTable = randomString();
  process.env.GranulesTable = randomString();
  const executionModel = new Execution();
  await executionModel.createTable();
  t.context = { executionModel };
});

test.after.always(async (t) => {
  const { executionModel } = t.context;
  await executionModel.deleteTable();
});

test('saveExecutionToDb() creates an execution item in Dynamo', async (t) => {
  const { executionModel } = t.context;

  const event = await loadFixture('execution-running-event.json');

  const stateMachineName = randomString();
  const stateMachineArn = `arn:aws:states:${event.region}:${event.account}:stateMachine:${stateMachineName}`;

  const executionName = randomString();
  const executionArn = `arn:aws:states:${event.region}:${event.account}:execution:${stateMachineName}:${executionName}`;

  const cumulusMessage = {
    cumulus_meta: {
      state_machine: stateMachineArn,
      execution_name: executionName,
      workflow_start_time: 122
    },
    meta: {
      status: 'running',
      collection: {
        name: 'my-collection',
        version: 5
      }
    },
    payload: {
      key: 'my-payload'
    }
  };

  await saveExecutionToDb(cumulusMessage);

  try {
    const fetchedExecution = await executionModel.get({ arn: executionArn });

    t.is(fetchedExecution.name, executionName);
    t.is(fetchedExecution.arn, executionArn);
    t.is(fetchedExecution.execution, `https://console.aws.amazon.com/states/home?region=us-east-1#/executions/details/${executionArn}`);
    t.is(fetchedExecution.collectionId, 'my-collection___5');
    t.is(fetchedExecution.status, 'running');
    t.is(fetchedExecution.createdAt, 122);
    t.deepEqual(fetchedExecution.originalPayload, { key: 'my-payload' });
  } catch (err) {
    t.fail('Failed to fetch execution');
  }
});

test('saveExecutionToDb() does not throw an exception if storeExecutionFromCumulusMessage() throws an exception', async (t) => {
  const cumulusMessage = {
    cumulus_meta: {
      // Because state_machine is missing, generating this execution record will fail
      execution_name: randomString(),
      workflow_start_time: Date.now()
    },
    meta: {
      status: 'running',
      collection: {
        name: 'my-collection',
        version: 5
      }
    },
    payload: 'my-payload'
  };

  try {
    await saveExecutionToDb(cumulusMessage);
    t.pass();
  } catch (err) {
    t.fail(`Exception should not have been thrown, but caught: ${err}`);
  }
});

test('The cw-sf-execution-event-to-db Lambda function creates execution, granule, and PDR records', async (t) => {
  const { executionModel } = t.context;

  const event = await loadFixture('execution-running-event.json');

  const stateMachineName = randomString();
  const stateMachineArn = `arn:aws:states:${event.region}:${event.account}:stateMachine:${stateMachineName}`;

  const executionName = randomString();
  const executionArn = `arn:aws:states:${event.region}:${event.account}:execution:${stateMachineName}:${executionName}`;

  event.resources = [executionArn];
  event.detail.executionArn = executionArn;
  event.detail.stateMachineArn = stateMachineArn;
  event.detail.name = executionName;

  const cumulusMessage = {
    cumulus_meta: {
      state_machine: stateMachineArn,
      execution_name: executionName,
      workflow_start_time: 122
    },
    meta: {
      status: 'running',
      collection: {
        name: 'my-collection',
        version: 5
      }
    },
    payload: {
      key: 'my-payload'
    }
  };
  event.detail.input = JSON.stringify(cumulusMessage);

  await handler(event);

  t.true(await executionModel.exists({ arn: executionArn }));
});
