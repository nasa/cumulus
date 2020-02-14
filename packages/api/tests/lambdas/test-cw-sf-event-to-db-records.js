'use strict';

const fs = require('fs-extra');
const path = require('path');
const test = require('ava');
const sinon = require('sinon');

const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const { randomString } = require('@cumulus/common/test-utils');
const Execution = require('../../models/executions');
const Granule = require('../../models/granules');
const {
  handler,
  saveExecutionToDb,
  saveGranulesToDb
} = require('../../lambdas/cw-sf-event-to-db-records');
const { fakeFileFactory, fakeGranuleFactoryV2 } = require('../../lib/testUtils');

const loadFixture = (filename) =>
  fs.readJson(
    path.join(
      __dirname,
      'fixtures',
      'cw-sf-event-to-db-records',
      filename
    )
  );

test.before(async (t) => {
  process.env.ExecutionsTable = randomString();
  process.env.GranulesTable = randomString();

  const executionModel = new Execution();
  await executionModel.createTable();
  t.context.executionModel = executionModel;

  const granuleModel = new Granule();
  await granuleModel.createTable();
  t.context.granuleModel = granuleModel;

  sinon.stub(StepFunctions, 'describeExecution')
    .callsFake(() => Promise.resolve({}));
});

test.beforeEach(async (t) => {
  t.context.cumulusMessage = {
    cumulus_meta: {
      workflow_start_time: 122
    },
    meta: {
      status: 'running',
      collection: {
        name: 'my-collection',
        version: 5
      },
      provider: {
        host: 'test-bucket',
        protocol: 's3'
      }
    },
    payload: {
      key: 'my-payload'
    }
  };
});

test.after.always(async (t) => {
  const { executionModel } = t.context;
  await executionModel.deleteTable();
});

test('saveExecutionToDb() creates an execution item in Dynamo', async (t) => {
  const { cumulusMessage, executionModel } = t.context;

  const stateMachineName = randomString();
  const stateMachineArn = `arn:aws:states:us-east-1:1234:stateMachine:${stateMachineName}`;
  cumulusMessage.cumulus_meta.state_machine = stateMachineArn;

  const executionName = randomString();
  cumulusMessage.cumulus_meta.execution_name = executionName;
  const executionArn = `arn:aws:states:us-east-1:1234:execution:${stateMachineName}:${executionName}`;

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
  const { cumulusMessage } = t.context;

  // Because state_machine is missing, generating this execution record will fail
  delete cumulusMessage.cumulus_meta.state_machine;

  try {
    await saveExecutionToDb(cumulusMessage);
    t.pass();
  } catch (err) {
    t.fail(`Exception should not have been thrown, but caught: ${err}`);
  }
});

test('saveGranulesToDb() saves a granule record to the database', async (t) => {
  const { cumulusMessage, granuleModel } = t.context;

  const stateMachineName = randomString();
  const stateMachineArn = `arn:aws:states:us-east-1:1234:stateMachine:${stateMachineName}`;
  cumulusMessage.cumulus_meta.state_machine = stateMachineArn;

  const executionName = randomString();
  cumulusMessage.cumulus_meta.execution_name = executionName;
  const executionArn = `arn:aws:states:us-east-1:1234:execution:${stateMachineName}:${executionName}`;

  const granuleId = randomString();
  const files = [fakeFileFactory({ size: 250 })];
  const granule = fakeGranuleFactoryV2({
    files,
    granuleId
  });
  delete granule.version;
  delete granule.dataType;
  cumulusMessage.payload.granules = [granule];

  await saveGranulesToDb(cumulusMessage);

  const fetchedGranule = await granuleModel.get({ granuleId });
  const expectedGranule = {
    ...granule,
    collectionId: 'my-collection___5',
    execution: `https://console.aws.amazon.com/states/home?region=us-east-1#/executions/details/${executionArn}`,
    productVolume: 250,
    status: 'running',
    createdAt: 122,
    error: {},
    timeToArchive: 0,
    timeToPreprocess: 0,
    duration: fetchedGranule.duration,
    timestamp: fetchedGranule.timestamp,
    updatedAt: fetchedGranule.updatedAt
  };
  t.deepEqual(fetchedGranule, expectedGranule);
});

test.serial('saveGranulesToDb() does not throw an exception if storeGranulesFromCumulusMessage() throws an exception', async (t) => {
  const { cumulusMessage } = t.context;

  const storeGranuleStub = sinon.stub(Granule.prototype, 'storeGranulesFromCumulusMessage')
    .callsFake(() => {
      throw new Error('error');
    });

  try {
    await saveGranulesToDb(cumulusMessage);
    t.pass();
  } catch (err) {
    t.fail(`Exception should not have been thrown, but caught: ${err}`);
  } finally {
    storeGranuleStub.restore();
  }
});

test('The cw-sf-event-to-db-records Lambda function creates execution and granule records', async (t) => {
  const { cumulusMessage, executionModel, granuleModel } = t.context;

  const event = await loadFixture('execution-running-event.json');

  const stateMachineName = randomString();
  const stateMachineArn = `arn:aws:states:${event.region}:${event.account}:stateMachine:${stateMachineName}`;
  cumulusMessage.cumulus_meta.state_machine = stateMachineArn;

  const executionName = randomString();
  cumulusMessage.cumulus_meta.execution_name = executionName;
  const executionArn = `arn:aws:states:${event.region}:${event.account}:execution:${stateMachineName}:${executionName}`;

  event.resources = [executionArn];
  event.detail.executionArn = executionArn;
  event.detail.stateMachineArn = stateMachineArn;
  event.detail.name = executionName;

  const granuleId = randomString();
  const files = [fakeFileFactory()];
  const granule = fakeGranuleFactoryV2({ files, granuleId });
  cumulusMessage.payload.granules = [granule];

  event.detail.input = JSON.stringify(cumulusMessage);

  await handler(event);

  t.true(await executionModel.exists({ arn: executionArn }));
  t.true(await granuleModel.exists({ granuleId }));
});
