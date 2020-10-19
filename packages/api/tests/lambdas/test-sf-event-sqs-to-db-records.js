'use strict';

const fs = require('fs-extra');
const path = require('path');
const test = require('ava');
const sinon = require('sinon');

const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const { localStackConnectionEnv, getKnexClient } = require('@cumulus/db');
const { constructCollectionId } = require('@cumulus/message/Collections');
const proxyquire = require('proxyquire');
const { randomString } = require('@cumulus/common/test-utils');
const Execution = require('../../models/executions');
const Granule = require('../../models/granules');
const Pdr = require('../../models/pdrs');
const {
  getInitialExecutionMessage,
  isPostRDSDeploymentExecution,
  saveExecutions,
  saveExecutionToDynamoDb,
  saveGranulesToDb,
  savePdrToDb,
} = require('../../lambdas/sf-event-sqs-to-db-records');
const { handler } = proxyquire('../../lambdas/sf-event-sqs-to-db-records', {
  '@cumulus/aws-client/SQS': {
    sendSQSMessage: async (queue, message) => [queue, message],
  },
});

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

const runHandler = async (cumulusMessage = {}) => {
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
    name: pdrName,
  };

  fixture.detail.input = JSON.stringify(cumulusMessage);

  const sqsEvent = {
    Records: [{
      eventSource: 'aws:sqs',
      body: JSON.stringify(fixture),
    }],
    env: localStackConnectionEnv,
  };
  const handlerResponse = await handler(sqsEvent);
  return { executionArn, granuleId, pdrName, handlerResponse, sqsEvent };
};

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

  t.context.describeExecutionStub = sinon.stub(StepFunctions, 'describeExecution')
    .callsFake(() => Promise.resolve({}));

  t.context.knex = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      // PG_DATABASE: testDbName,
      // migrationDir,
    },
  });
});

test.beforeEach(async (t) => {
  t.context.cumulusMessage = {
    cumulus_meta: {
      workflow_start_time: 122,
    },
    meta: {
      status: 'running',
      collection: {
        name: 'my-collection',
        version: 5,
      },
      provider: {
        id: 'test-provider',
        host: 'test-bucket',
        protocol: 's3',
      },
    },
    payload: {
      key: 'my-payload',
    },
  };
});

test.after.always(async (t) => {
  const { executionModel } = t.context;
  await executionModel.deleteTable();
});

test('isPostRDSDeploymentExecution correctly returns true if Cumulus version is >= 3.0.0', (t) => {
  t.true(isPostRDSDeploymentExecution({
    cumulus_meta: {
      cumulus_version: '3.0.0',
    },
  }));
});

test('isPostRDSDeploymentExecution correctly returns false if Cumulus version is < 3.0.0 or missing', (t) => {
  t.false(isPostRDSDeploymentExecution({
    cumulus_meta: {
      cumulus_version: '2.0.0',
    },
  }));
  t.false(isPostRDSDeploymentExecution({}));
});

test('getInitialExecutionMessage returns cumulus message input if there is no parent execution', async (t) => {
  const cumulusMessage = {
    foo: 'bar',
    cumulus_meta: {},
  };
  t.deepEqual(
    await getInitialExecutionMessage(cumulusMessage),
    cumulusMessage
  );
});

test.serial('getInitialExecutionMessage returns initial parent execution message', async (t) => {
  const { describeExecutionStub } = t.context;

  describeExecutionStub.restore();
  const stub = sinon.stub(StepFunctions, 'describeExecution');
  t.teardown(() => stub.restore());

  stub.withArgs({
    executionArn: 'machine1:execution1',
  }).resolves({
    input: JSON.stringify({
      cumulus_meta: {
        state_machine: 'machine2',
        execution_name: 'execution2',
        parentExecutionArn: 'parent2',
      },
    }),
  });
  const initialExecutionMessage = {
    cumulus_meta: {
      state_machine: 'machine3',
      execution_name: 'execution3',
      cumulus_version: 'x.x.x',
    },
  };
  stub.withArgs({
    executionArn: 'machine2:execution2',
  }).resolves({
    input: JSON.stringify(initialExecutionMessage),
  });

  const cumulusMessage = {
    cumulus_meta: {
      state_machine: 'machine1',
      execution_name: 'execution1',
      parentExecutionArn: 'parent1',
    },
  };
  t.deepEqual(
    await getInitialExecutionMessage(cumulusMessage),
    initialExecutionMessage
  );
});

test('saveExecutionToDynamoDb() creates an execution item in Dynamo', async (t) => {
  const { cumulusMessage, executionModel } = t.context;

  const stateMachineName = randomString();
  const stateMachineArn = `arn:aws:states:us-east-1:1234:stateMachine:${stateMachineName}`;
  cumulusMessage.cumulus_meta.state_machine = stateMachineArn;

  const executionName = randomString();
  cumulusMessage.cumulus_meta.execution_name = executionName;
  const executionArn = `arn:aws:states:us-east-1:1234:execution:${stateMachineName}:${executionName}`;

  await saveExecutionToDynamoDb(cumulusMessage, executionModel);

  try {
    const fetchedExecution = await executionModel.get({ arn: executionArn });

    t.is(fetchedExecution.name, executionName);
    t.is(fetchedExecution.arn, executionArn);
    t.is(fetchedExecution.execution, `https://console.aws.amazon.com/states/home?region=us-east-1#/executions/details/${executionArn}`);
    t.is(fetchedExecution.collectionId, 'my-collection___5');
    t.is(fetchedExecution.status, 'running');
    t.is(fetchedExecution.createdAt, 122);
    t.deepEqual(fetchedExecution.originalPayload, { key: 'my-payload' });
  } catch (error) {
    t.fail('Failed to fetch execution');
  }
});

test.serial('saveExecutionToDynamoDb() throws an exception if storeExecutionFromCumulusMessage() throws an exception', async (t) => {
  const { cumulusMessage, executionModel } = t.context;

  const stateMachineName = randomString();
  const stateMachineArn = `arn:aws:states:us-east-1:1234:stateMachine:${stateMachineName}`;
  cumulusMessage.cumulus_meta.state_machine = stateMachineArn;

  const executionName = randomString();
  cumulusMessage.cumulus_meta.execution_name = executionName;

  const saveExecutionStub = sinon.stub(Execution.prototype, 'storeExecutionFromCumulusMessage')
    .callsFake(() => {
      throw new Error('fake error');
    });
  t.teardown(() => saveExecutionStub.restore());

  await t.throwsAsync(
    saveExecutionToDynamoDb(cumulusMessage, executionModel),
    { message: 'fake error' }
  );
});

test.todo('saveExecutionToRDS saves correct execution record to RDS');

test('saveExecutions() saves execution to Dynamo and RDS', async (t) => {
  const { cumulusMessage, executionModel, knex } = t.context;

  const stateMachineName = randomString();
  const stateMachineArn = `arn:aws:states:us-east-1:1234:stateMachine:${stateMachineName}`;
  cumulusMessage.cumulus_meta.state_machine = stateMachineArn;

  const executionName = randomString();
  cumulusMessage.cumulus_meta.execution_name = executionName;

  const executionArn = `arn:aws:states:us-east-1:1234:execution:${stateMachineName}:${executionName}`;

  await saveExecutions(cumulusMessage, knex);
  t.true(await executionModel.exists({ arn: executionArn }));
  t.truthy(
    await knex('executions')
      .where('arn', executionArn)
      .first()
  );
});

test.serial('saveExecutions() removes record from Dynamo and RDS if Dynamo write fails', async (t) => {
  const { cumulusMessage, executionModel, knex } = t.context;

  const stateMachineName = randomString();
  const stateMachineArn = `arn:aws:states:us-east-1:1234:stateMachine:${stateMachineName}`;
  cumulusMessage.cumulus_meta.state_machine = stateMachineArn;

  const executionName = randomString();
  cumulusMessage.cumulus_meta.execution_name = executionName;

  const executionArn = `arn:aws:states:us-east-1:1234:execution:${stateMachineName}:${executionName}`;

  const saveExecutionStub = sinon.stub(Execution.prototype, 'storeExecutionFromCumulusMessage')
    .callsFake(() => {
      throw new Error('fake error');
    });
  t.teardown(() => saveExecutionStub.restore());

  await saveExecutions(cumulusMessage, knex);
  t.false(await executionModel.exists({ arn: executionArn }));
  t.falsy(
    await knex('executions')
      .where('arn', executionArn)
      .first()
  );
});

test.serial('saveExecutions() removes record from Dynamo and RDS if RDS write fails', async (t) => {
  const { cumulusMessage, executionModel, knex } = t.context;

  const stateMachineName = randomString();
  const stateMachineArn = `arn:aws:states:us-east-1:1234:stateMachine:${stateMachineName}`;
  cumulusMessage.cumulus_meta.state_machine = stateMachineArn;

  const executionName = randomString();
  cumulusMessage.cumulus_meta.execution_name = executionName;

  const executionArn = `arn:aws:states:us-east-1:1234:execution:${stateMachineName}:${executionName}`;

  const fakeKnex = sinon.stub().returns({
    insert: () => {
      throw new Error('bad insert');
    },
    where: () => ({
      delete: () => Promise.resolve(),
    }),
  });

  await saveExecutions(cumulusMessage, fakeKnex);
  t.false(await executionModel.exists({ arn: executionArn }));
  t.falsy(
    await knex('executions')
      .where('arn', executionArn)
      .first()
  );
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
    granuleId,
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
    updatedAt: fetchedGranule.updatedAt,
  };
  t.deepEqual(fetchedGranule, expectedGranule);
});

test.serial('saveGranulesToDb() throws an exception if storeGranulesFromCumulusMessage() throws an exception', async (t) => {
  const { cumulusMessage } = t.context;

  const storeGranuleStub = sinon.stub(Granule.prototype, 'storeGranulesFromCumulusMessage')
    .callsFake(() => {
      throw new Error('error');
    });

  try {
    await t.throwsAsync(saveGranulesToDb(cumulusMessage));
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
    PANmessage: 'test',
  };
  cumulusMessage.payload = {
    pdr,
    completed: new Array(4).map(randomString),
    failed: new Array(2).map(randomString),
    running: new Array(6).map(randomString),
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
      total: 12,
    },
    createdAt: cumulusMessage.cumulus_meta.workflow_start_time,
    duration: fetchedPdr.duration,
    timestamp: fetchedPdr.timestamp,
  };
  t.deepEqual(fetchedPdr, expectedPdr);
});

test.serial('savePdrsToDb() throws an exception if storePdrFromCumulusMessage() throws an exception', async (t) => {
  const { cumulusMessage } = t.context;

  const storeGranuleStub = sinon.stub(Pdr.prototype, 'storePdrFromCumulusMessage')
    .callsFake(() => {
      throw new Error('error');
    });
  try {
    await t.throwsAsync(savePdrToDb(cumulusMessage));
  } finally {
    storeGranuleStub.restore();
  }
});

test('sf-event-sqs-to-db-records handler sends message to DLQ when granule and pdr fail to write to database', async (t) => {
  const {
    cumulusMessage,
    executionModel,
    granuleModel,
    pdrModel,
  } = t.context;

  delete cumulusMessage.meta.collection;
  const {
    executionArn,
    granuleId,
    pdrName,
    handlerResponse,
    sqsEvent,
  } = await runHandler(cumulusMessage);

  t.true(await executionModel.exists({ arn: executionArn }));
  t.false(await granuleModel.exists({ granuleId }));
  t.false(await pdrModel.exists({ pdrName }));
  t.is(handlerResponse[0][1].body, sqsEvent.Records[0].body);
});

test('The sf-event-sqs-to-db-records Lambda adds records to the granule, execution and pdr tables', async (t) => {
  const {
    cumulusMessage,
    executionModel,
    granuleModel,
    pdrModel,
  } = t.context;

  const { executionArn, granuleId, pdrName } = await runHandler(cumulusMessage);

  t.true(await executionModel.exists({ arn: executionArn }));
  t.true(await granuleModel.exists({ granuleId }));
  t.true(await pdrModel.exists({ pdrName }));
});

test.skip('Lambda writes records to Dynamo and not RDS if cumulus version < 3.0.0', async (t) => {
  const {
    cumulusMessage,
    executionModel,
    granuleModel,
    pdrModel,
  } = t.context;

  cumulusMessage.cumulus_meta.cumulus_version = '2.0.1';

  const { executionArn, granuleId, pdrName } = await runHandler(cumulusMessage);

  t.true(await executionModel.exists({ arn: executionArn }));
  t.true(await granuleModel.exists({ granuleId }));
  t.true(await pdrModel.exists({ pdrName }));
});
