'use strict';

const fs = require('fs-extra');
const path = require('path');
const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const Execution = require('../../models/executions');
const { handler } = require('../../lambdas/cw-sf-execution-event-to-db');

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
  const executionModel = new Execution();
  await executionModel.createTable();
  t.context = { executionModel };
});

test.after.always(async (t) => {
  const { executionModel } = t.context;
  await executionModel.deleteTable();
});

test('The cw-cf-execution-event-to-db Lambda function takes a Cloudwatch Step Function Execution event and creates an execution item in Dynamo', async (t) => {
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
      execution_name: executionName
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
  event.detail.input = JSON.stringify(cumulusMessage);

  await handler(event);

  try {
    const fetchedExecution = await executionModel.get({ arn: executionArn });

    t.is(fetchedExecution.name, executionName);
    t.is(fetchedExecution.arn, executionArn);
    t.is(fetchedExecution.execution, `https://console.aws.amazon.com/states/home?region=us-east-1#/executions/details/${executionArn}`);
    t.is(fetchedExecution.collectionId, 'my-collection___5');
    t.is(fetchedExecution.status, 'running');
    t.is(fetchedExecution.createdAt, event.detail.startDate);
    t.is(fetchedExecution.originalPayload, 'my-payload');
  } catch (err) {
    t.fail('Failed to fetch execution');
  }
});

test('The cw-cf-execution-event-to-db Lambda function does not throw an exception if storeExecutionFromCumulusMessage() throws an exception', async (t) => {
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
      // Because state_machine is missing, generating this execution record will fail
      execution_name: executionName,
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
  event.detail.input = JSON.stringify(cumulusMessage);

  try {
    await handler(event);
    t.pass();
  } catch (err) {
    t.fail(`Exception should not have been thrown, but caught: ${err}`);
  }
});
