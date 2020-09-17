'use strict';

const fs = require('fs-extra');
const path = require('path');
const test = require('ava');
const sinon = require('sinon');

const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const { constructCollectionId } = require('@cumulus/message/Collections');
const proxyquire = require('proxyquire');
const { randomString } = require('@cumulus/common/test-utils');
const { getKnexClient, localStackConnectionEnv } = require('@cumulus/db');
const Execution = require('../../models/executions');
const Granule = require('../../models/granules');
const Pdr = require('../../models/pdrs');
const {
  saveExecutionToDb,
  saveGranulesToDb,
  savePdrToDb,
} = require('../../lambdas/sf-event-sqs-to-db-records');
const { handler } = proxyquire('../../lambdas/sf-event-sqs-to-db-records', {
  '@cumulus/aws-client/SQS': {
    sendSQSMessage: async (queue, message) => [queue, message],
  },
  '@cumulus/db': {
    getKnexClient: () => getKnexClient({ env: localStackConnectionEnv }),
  },
});

const {
  fakeCollectionFactory,
  fakeFileFactory,
  fakeGranuleFactoryV2,
} = require('../../lib/testUtils');

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

  sinon.stub(StepFunctions, 'describeExecution')
    .callsFake(() => Promise.resolve({}));

  const collectionRecord = fakeCollectionFactory();

  collectionRecord.created_at = new Date(collectionRecord.createdAt);
  collectionRecord.updated_at = new Date(collectionRecord.updatedAt);
  collectionRecord.granuleIdValidationRegex = collectionRecord.granuleId;
  collectionRecord.granuleIdExtractionRegex = collectionRecord.granuleIdExtraction;

  delete collectionRecord.createdAt;
  delete collectionRecord.updatedAt;
  delete collectionRecord.granuleId;
  delete collectionRecord.granuleIdExtraction;

  t.context.db = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      KNEX_DEBUG: 'true',
      KNEX_ASYNC_STACK_TRACES: 'true',
    },
  });
  await t.context.db('collections').insert(collectionRecord);

  t.context.collectionName = collectionRecord.name;
  t.context.collectionVersion = collectionRecord.version;
});

test.beforeEach(async (t) => {
  t.context.cumulusMessage = {
    cumulus_meta: {
      workflow_start_time: Date.now(),
    },
    meta: {
      status: 'running',
      collection: {
        name: t.context.collectionName,
        version: t.context.collectionVersion,
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

test('saveExecutionToDb() creates an execution item in Dynamo', async (t) => {
  const {
    collectionName,
    collectionVersion,
    cumulusMessage,
    executionModel,
  } = t.context;

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
    t.is(fetchedExecution.collectionId, `${collectionName}___${collectionVersion}`);
    t.is(fetchedExecution.status, 'running');
    t.is(fetchedExecution.createdAt, cumulusMessage.cumulus_meta.workflow_start_time);
    t.deepEqual(fetchedExecution.originalPayload, { key: 'my-payload' });
  } catch (error) {
    t.fail('Failed to fetch execution');
  }
});

test.serial('saveExecutionToDb() throws an exception if storeExecutionFromCumulusMessage() throws an exception', async (t) => {
  const { cumulusMessage } = t.context;

  const saveExecutionStub = sinon.stub(Execution.prototype, 'storeExecutionFromCumulusMessage')
    .callsFake(() => {
      throw new Error('error');
    });

  try {
    await t.throwsAsync(saveExecutionToDb(cumulusMessage));
  } finally {
    saveExecutionStub.restore();
  }
});

test('saveGranulesToDb() saves a granule record to the database', async (t) => {
  const {
    collectionName,
    collectionVersion,
    cumulusMessage,
    db,
    granuleModel,
  } = t.context;

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

  await saveGranulesToDb({ cumulusMessage, db });

  const fetchedDynamoGranule = await granuleModel.get({ granuleId });

  t.deepEqual(
    fetchedDynamoGranule,
    {
      cmrLink: granule.cmrLink,
      collectionId: `${collectionName}___${collectionVersion}`,
      createdAt: cumulusMessage.cumulus_meta.workflow_start_time,
      duration: fetchedDynamoGranule.duration,
      error: {},
      execution: `https://console.aws.amazon.com/states/home?region=us-east-1#/executions/details/${executionArn}`,
      files,
      granuleId: granule.granuleId,
      productVolume: 250,
      provider: 'test-provider',
      published: granule.published,
      status: 'running',
      timestamp: fetchedDynamoGranule.timestamp,
      timeToArchive: 0,
      timeToPreprocess: 0,
      updatedAt: fetchedDynamoGranule.updatedAt,
    }
  );

  const fetchedDbGranule = await db.first()
    .from('granules')
    .where({ granuleId: granule.granuleId });

  const { cumulusId: collectionCumulusId } = await db('collections')
    .first('cumulusId')
    .where({
      name: collectionName,
      version: collectionVersion,
    });

  /* eslint-disable unicorn/no-null */
  t.deepEqual(
    fetchedDbGranule,
    {
      // files,
      beginningDateTime: null,
      cmrLink: granule.cmrLink,
      collectionCumulusId,
      created_at: new Date(cumulusMessage.cumulus_meta.workflow_start_time),
      cumulusId: fetchedDbGranule.cumulusId,
      duration: fetchedDynamoGranule.duration,
      endingDateTime: null,
      error: {},
      execution: `https://console.aws.amazon.com/states/home?region=us-east-1#/executions/details/${executionArn}`,
      granuleId: granule.granuleId,
      lastUpdateDateTime: null,
      pdrName: null,
      processingEndDateTime: null,
      processingStartDateTime: null,
      productionDateTime: null,
      productVolume: 250,
      provider: 'test-provider',
      published: granule.published,
      status: 'running',
      timestamp: new Date(fetchedDynamoGranule.timestamp),
      timeToArchive: 0,
      timeToPreprocess: 0,
      updated_at: new Date(fetchedDynamoGranule.updatedAt),
    }
  );
  /* eslint-enable unicorn/no-null */
});

test.serial('saveGranulesToDb() throws an exception if storeGranulesFromCumulusMessage() throws an exception', async (t) => {
  const { cumulusMessage, db } = t.context;

  const storeGranuleStub = sinon.stub(Granule.prototype, 'storeGranulesFromCumulusMessage')
    .callsFake(() => {
      throw new Error('error');
    });

  try {
    await t.throwsAsync(saveGranulesToDb({ cumulusMessage, db }));
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
