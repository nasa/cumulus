'use strict';

const fs = require('fs-extra');
const path = require('path');
const test = require('ava');
const sinon = require('sinon');

const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const { constructCollectionId } = require('@cumulus/common/collection-config-store');
const { randomString } = require('@cumulus/common/test-utils');
const Execution = require('../../models/executions');
const Granule = require('../../models/granules');
const Pdr = require('../../models/pdrs');
const {
  handler,
  saveExecutionToDb,
  saveGranulesToDb,
  savePdrToDb
} = require('../../lambdas/sf-event-sqs-to-db-records');
const { fakeFileFactory, fakeGranuleFactoryV2 } = require('../../lib/testUtils');

const loadFixture = (filename) =>
  fs.readJson(
    path.join(
      __dirname,
      'fixtures',
      'sf-event-sqs-to-db-records',
      filename
    )
  );

test.before(async (t) => {
  process.env.ExecutionsTable = randomString();
  process.env.GranulesTable = randomString();
  process.env.PdrsTable = randomString();

  const executionModel = new Execution();
  await executionModel.createTable();
  t.context.executionModel = executionModel;

  const granuleModel = new Granule();
  await granuleModel.createTable();
  t.context.granuleModel = granuleModel;

  const pdrModel = new Pdr();
  await pdrModel.createTable();
  t.context.pdrModel = pdrModel;

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
        id: 'test-provider',
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
    provider: 'test-provider',
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

test.serial('savePdrToDb() saves a PDR record', async (t) => {
  const { cumulusMessage, pdrModel } = t.context;

  const stateMachineName = randomString();
  const stateMachineArn = `arn:aws:states:us-east-1:1234:stateMachine:${stateMachineName}`;
  cumulusMessage.cumulus_meta.state_machine = stateMachineArn;

  const executionName = randomString();
  cumulusMessage.cumulus_meta.execution_name = executionName;
  const executionArn = 'https://console.aws.amazon.com/states/home?region=us-east-1#/executions/'
    + `details/arn:aws:states:us-east-1:1234:execution:${stateMachineName}:${executionName}`;

  const pdr = {
    name: randomString(),
    PANSent: false,
    PANmessage: 'test'
  };
  cumulusMessage.payload = {
    pdr,
    completed: new Array(4).map(randomString),
    failed: new Array(2).map(randomString),
    running: new Array(6).map(randomString)
  };
  await savePdrToDb(cumulusMessage);

  const collectionId = (() => {
    const { name, version } = cumulusMessage.meta.collection;
    return constructCollectionId(name, version);
  })();

  const fetchedPdr = await pdrModel.get({ pdrName: pdr.name });
  const expectedPdr = {
    pdrName: pdr.name,
    collectionId,
    status: cumulusMessage.meta.status,
    provider: cumulusMessage.meta.provider.id,
    progress: 50,
    execution: executionArn,
    PANSent: false,
    PANmessage: 'test',
    stats: {
      processing: 6,
      completed: 4,
      failed: 2,
      total: 12
    },
    createdAt: cumulusMessage.cumulus_meta.workflow_start_time,
    duration: fetchedPdr.duration,
    timestamp: fetchedPdr.timestamp
  };
  t.deepEqual(fetchedPdr, expectedPdr);
});

test('The sf-event-sqs-to-db-records Lambda function creates execution, granule and pdr records', async (t) => {
  const {
    cumulusMessage,
    executionModel,
    granuleModel,
    pdrModel
  } = t.context;

  const fixture = await loadFixture('execution-running-event.json');

  const stateMachineName = randomString();
  const stateMachineArn = `arn:aws:states:${fixture.region}:${fixture.account}:stateMachine:${stateMachineName}`;
  cumulusMessage.cumulus_meta.state_machine = stateMachineArn;

  const executionName = randomString();
  cumulusMessage.cumulus_meta.execution_name = executionName;
  const executionArn = `arn:aws:states:${fixture.region}:${fixture.account}:execution:${stateMachineName}:${executionName}`;

  fixture.resources = [executionArn];
  fixture.detail.executionArn = executionArn;
  fixture.detail.stateMachineArn = stateMachineArn;
  fixture.detail.name = executionName;

  const granuleId = randomString();
  const files = [fakeFileFactory()];
  const granule = fakeGranuleFactoryV2({ files, granuleId });
  cumulusMessage.payload.granules = [granule];

  const pdrName = randomString();
  cumulusMessage.payload.pdr = {
    name: pdrName
  };

  fixture.detail.input = JSON.stringify(cumulusMessage);

  const sqsEvent = {
    Records: [{
      eventSource: 'aws:sqs',
      body: JSON.stringify(fixture)
    }]
  };
  await handler(sqsEvent);

  t.true(await executionModel.exists({ arn: executionArn }));
  t.true(await granuleModel.exists({ granuleId }));
  t.true(await pdrModel.exists({ pdrName }));
});
